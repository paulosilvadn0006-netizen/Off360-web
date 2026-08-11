"""Botões personalizados por estabelecimento + Solicitações internas da OFF 360 (Fase A)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import timedelta, timezone, datetime

from core import (db, require_role, new_id, now_iso, now_utc, strip_id, gen_code,
                  public_user, create_notification, create_audit, get_settings)

router = APIRouter(prefix="/api", tags=["requests"])
consumer_only = require_role("consumer")
merchant_only = require_role("merchant")

# ---------------- Botões personalizados ----------------
SERVICE_TYPES = {"agendamento", "reserva", "orcamento", "entrega", "retirada", "encomenda", "contato"}
DESTINATIONS = {"internal", "whatsapp", "external"}
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_LABEL = {"mon": "seg", "tue": "ter", "wed": "qua", "thu": "qui", "fri": "sex", "sat": "sáb", "sun": "dom"}
MAX_BUTTONS = 3


def _now_br():
    return now_utc().astimezone(timezone(timedelta(hours=-3)))


def validate_buttons(raw):
    """Normaliza e valida a lista de botões. Máximo 3. Regras estritas só quando o botão está ativo."""
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="Configuração de botões inválida.")
    if len(raw) > MAX_BUTTONS:
        raise HTTPException(status_code=400, detail=f"Você pode configurar no máximo {MAX_BUTTONS} botões.")
    out = []
    for i, b in enumerate(raw):
        if not isinstance(b, dict):
            raise HTTPException(status_code=400, detail="Configuração de botões inválida.")
        enabled = bool(b.get("enabled"))
        label = (b.get("label") or "").strip()
        service_type = b.get("service_type") or "contato"
        destination = b.get("destination") or "internal"
        if service_type not in SERVICE_TYPES:
            raise HTTPException(status_code=400, detail="Tipo de atendimento inválido.")
        if destination not in DESTINATIONS:
            raise HTTPException(status_code=400, detail="Destino do botão inválido.")
        external_url = (b.get("external_url") or "").strip()
        if enabled:
            if not label:
                raise HTTPException(status_code=400, detail="Informe o nome de cada botão ativo.")
            if destination == "external":
                if not (external_url.startswith("https://") or external_url.startswith("http://")):
                    raise HTTPException(status_code=400, detail="Informe um link externo válido (começando com https://).")
        vd = b.get("valid_days") or []
        vd = [d for d in vd if d in DAY_KEYS] if isinstance(vd, list) else []
        out.append({
            "id": b.get("id") or new_id(),
            "enabled": enabled,
            "order": int(b.get("order") if b.get("order") is not None else i),
            "label": label,
            "service_type": service_type,
            "destination": destination,
            "whatsapp_message": (b.get("whatsapp_message") or "").strip(),
            "external_url": external_url,
            "valid_days": vd,
            "hours_start": (b.get("hours_start") or "").strip(),
            "hours_end": (b.get("hours_end") or "").strip(),
            "response_time": (b.get("response_time") or "").strip(),
            "observations": (b.get("observations") or "").strip(),
            "discount_valid": bool(b.get("discount_valid", True)),
            "requires_prepayment": bool(b.get("requires_prepayment")),
            "delivery_fee": b.get("delivery_fee"),
            "areas": (b.get("areas") or "").strip(),
            "deadline": (b.get("deadline") or "").strip(),
        })
    out.sort(key=lambda x: x["order"])
    for i, b in enumerate(out):
        b["order"] = i
    return out


def _button_available(btn):
    """Retorna (disponível, mensagem_amigável). Só limita quando há dias/horários configurados."""
    days = btn.get("valid_days") or []
    hs = btn.get("hours_start") or ""
    he = btn.get("hours_end") or ""
    if not days and not (hs and he):
        return True, None
    now = _now_br()
    cur_day = DAY_KEYS[now.weekday()]
    ok_day = (not days) or (cur_day in days)
    ok_hour = True
    if hs and he:
        cur = now.strftime("%H:%M")
        ok_hour = hs <= cur <= he
    available = ok_day and ok_hour
    # mensagem
    if days:
        dtxt = "de " + " a ".join([DAY_LABEL[days[0]], DAY_LABEL[days[-1]]]) if len(days) > 1 else DAY_LABEL[days[0]]
    else:
        dtxt = "todos os dias"
    htxt = f", das {hs} às {he}" if (hs and he) else ""
    msg = None if available else f"Este estabelecimento recebe solicitações {dtxt}{htxt}."
    return available, msg


def _button_complete(btn, est):
    if not btn.get("enabled"):
        return False
    if not btn.get("label") or btn.get("service_type") not in SERVICE_TYPES:
        return False
    dest = btn.get("destination")
    if dest == "external" and not btn.get("external_url"):
        return False
    if dest == "whatsapp" and not (est.get("whatsapp") or "").strip():
        return False
    return True


def public_buttons(est):
    """Botões visíveis ao consumidor: ativos + completos, com disponibilidade calculada."""
    out = []
    for b in sorted(est.get("action_buttons") or [], key=lambda x: x.get("order", 0)):
        if not _button_complete(b, est):
            continue
        available, msg = _button_available(b)
        out.append({
            "id": b["id"], "label": b["label"], "service_type": b["service_type"], "destination": b["destination"],
            "whatsapp_message": b.get("whatsapp_message") or "", "external_url": b.get("external_url") or "",
            "response_time": b.get("response_time") or "", "observations": b.get("observations") or "",
            "discount_valid": bool(b.get("discount_valid", True)), "requires_prepayment": bool(b.get("requires_prepayment")),
            "delivery_fee": b.get("delivery_fee"), "areas": b.get("areas") or "", "deadline": b.get("deadline") or "",
            "available": available, "unavailable_message": msg,
        })
    return out


# ---------------- Solicitações ----------------
STATUSES = ["awaiting", "accepted", "in_preparation", "scheduled", "ready_pickup",
            "out_for_delivery", "completed", "rejected", "cancelled", "expired"]
STATUS_TITLE = {
    "awaiting": "Solicitação enviada", "accepted": "Solicitação aceita", "rejected": "Solicitação recusada",
    "scheduled": "Agendamento confirmado", "in_preparation": "Pedido em preparação",
    "ready_pickup": "Pedido pronto para retirada", "out_for_delivery": "Pedido saiu para entrega",
    "completed": "Solicitação concluída", "cancelled": "Solicitação cancelada", "expired": "Solicitação expirada",
}
MERCHANT_STATUS_STEPS = {"accepted", "in_preparation", "scheduled", "ready_pickup", "out_for_delivery"}


def _req_public(r):
    r = strip_id(r)
    return r


async def _find_button(est, button_id):
    for b in est.get("action_buttons") or []:
        if b.get("id") == button_id:
            return b
    return None


class CreateRequest(BaseModel):
    establishment_id: str
    button_id: str
    product_service: Optional[str] = ""
    desired_date: Optional[str] = None
    desired_time: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    message: Optional[str] = ""
    story_id: Optional[str] = None


@router.post("/consumer/requests")
async def create_request(payload: CreateRequest, user=Depends(consumer_only)):
    e = await db.establishments.find_one({"id": payload.establishment_id})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado.")
    if e.get("approval_status") != "approved" or e.get("subscription_status") != "active":
        raise HTTPException(status_code=400, detail="Este estabelecimento não está disponível no momento.")
    if user.get("subscription_status") != "active":
        raise HTTPException(status_code=403, detail="Sua assinatura não está ativa. Regularize para enviar solicitações.")
    btn = await _find_button(e, payload.button_id)
    if not btn or not _button_complete(btn, e):
        raise HTTPException(status_code=400, detail="Esta forma de atendimento não está disponível.")
    available, msg = _button_available(btn)
    if not available:
        raise HTTPException(status_code=400, detail=msg or "Fora do horário de atendimento.")

    discount_applies = bool(btn.get("discount_valid", True)) and bool(e.get("discount_configured")) and bool(e.get("discount_percent"))
    code = gen_code("SOL")
    rid = new_id()
    req = {
        "id": rid, "code": code,
        "consumer_id": user["id"], "consumer_name": user.get("name"), "consumer_photo": user.get("photo_url"),
        "merchant_owner_id": e.get("owner_id"),
        "establishment_id": e["id"], "establishment_name": e.get("fantasy_name"),
        "button_id": btn["id"], "button_label": btn.get("label"),
        "request_type": btn.get("service_type"), "destination": btn.get("destination"),
        "product_service": payload.product_service or "", "desired_date": payload.desired_date,
        "desired_time": payload.desired_time, "address": payload.address,
        "phone": payload.phone or user.get("phone"), "message": payload.message or "",
        "story_id": payload.story_id,
        # snapshot do desconto — garantido para esta solicitação mesmo que a promoção mude/expirar depois
        "discount_applies": discount_applies,
        "discount_percent": e.get("discount_percent") if discount_applies else None,
        "discount_min_purchase": e.get("discount_min_purchase"),
        "discount_max_cap": e.get("discount_max_cap"),
        "discount_rules": e.get("discount_rules"),
        "discount_valid_until": btn.get("deadline") or None,
        "requires_prepayment": bool(btn.get("requires_prepayment")),
        "delivery_fee": btn.get("delivery_fee"),
        "status": "awaiting",
        "status_history": [{"status": "awaiting", "at": now_iso(), "by": "consumer", "note": None}],
        "merchant_response": None,
        "transaction_id": None,
        "gross_amount": None, "discount_amount": None, "saved_amount": None, "final_amount": None,
        "external_clicks": 0, "whatsapp_clicks": 0,
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.requests.insert_one(dict(req))
    await create_notification(e.get("owner_id"), "merchant", "new_request",
                              f"Nova solicitação: {STATUS_TITLE['awaiting']}",
                              f"{user.get('name')} • {btn.get('label')} • {code}", "/merchant/requests")
    await create_notification(user["id"], "consumer", "request", STATUS_TITLE["awaiting"],
                              f"{e.get('fantasy_name')} • {btn.get('label')} • {code}", "/economy")
    await create_audit(user, "create_request", rid, {}, {"establishment_id": e["id"], "type": btn.get("service_type")})

    result = _req_public(req)
    # deep-link do WhatsApp (montado no backend, sem expor tokens)
    if btn.get("destination") == "whatsapp":
        result["whatsapp_url"] = _build_whatsapp_url(e, btn, req, user)
    if btn.get("destination") == "external":
        result["external_url"] = btn.get("external_url")
    return result


def _build_whatsapp_url(e, btn, req, user):
    import urllib.parse
    phone = (e.get("whatsapp") or "").replace("+", "").replace(" ", "").replace("-", "")
    phone = "".join(c for c in phone if c.isdigit())
    lines = [
        f"Olá! Sou {user.get('name')} (assinante OFF 360).",
        f"Estabelecimento: {e.get('fantasy_name')}",
        f"Solicitação: {btn.get('label')}",
    ]
    if req.get("product_service"):
        lines.append(f"Produto/Serviço: {req.get('product_service')}")
    if req.get("discount_applies"):
        lines.append(f"Desconto OFF 360: {e.get('discount_percent')}%")
    lines.append(f"Código: {req.get('code')}")
    if req.get("message"):
        lines.append(f"Mensagem: {req.get('message')}")
    text = urllib.parse.quote("\n".join(lines))
    return f"https://wa.me/{phone}?text={text}"


@router.get("/consumer/requests")
async def list_consumer_requests(user=Depends(consumer_only), status: Optional[str] = None):
    q = {"consumer_id": user["id"]}
    if status:
        q["status"] = status
    items = await db.requests.find(q).sort("created_at", -1).to_list(500)
    return [_req_public(r) for r in items]


@router.get("/consumer/requests/{rid}")
async def get_consumer_request(rid: str, user=Depends(consumer_only)):
    r = await db.requests.find_one({"id": rid, "consumer_id": user["id"]})
    if not r:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return _req_public(r)


class ClickInput(BaseModel):
    kind: str  # whatsapp | external


@router.post("/consumer/requests/{rid}/track-click")
async def track_click(rid: str, payload: ClickInput, user=Depends(consumer_only)):
    field = "whatsapp_clicks" if payload.kind == "whatsapp" else "external_clicks"
    await db.requests.update_one({"id": rid, "consumer_id": user["id"]}, {"$inc": {field: 1}})
    return {"ok": True}


@router.post("/consumer/requests/{rid}/cancel")
async def consumer_cancel(rid: str, user=Depends(consumer_only)):
    r = await db.requests.find_one({"id": rid, "consumer_id": user["id"]})
    if not r:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    if r.get("status") in ("completed", "cancelled", "rejected", "expired"):
        raise HTTPException(status_code=400, detail="Esta solicitação não pode mais ser cancelada.")
    await _set_status(r, "cancelled", by="consumer", note="Cancelada pelo consumidor")
    await create_notification(r.get("merchant_owner_id"), "merchant", "request", "Solicitação cancelada",
                              f"{r.get('consumer_name')} cancelou • {r.get('code')}", "/merchant/requests")
    updated = await db.requests.find_one({"id": rid})
    return _req_public(updated)


async def _set_status(r, status, by, note=None):
    entry = {"status": status, "at": now_iso(), "by": by, "note": note}
    await db.requests.update_one({"id": r["id"]}, {
        "$set": {"status": status, "updated_at": now_iso()},
        "$push": {"status_history": entry},
    })


# ---------------- Merchant ----------------
async def _owned_ids(user):
    ests = await db.establishments.find({"owner_id": user["id"]}).to_list(50)
    return [e["id"] for e in ests]


async def _req_of_owner(user, rid):
    r = await db.requests.find_one({"id": rid, "merchant_owner_id": user["id"]})
    if not r:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return r


@router.get("/merchant/requests")
async def merchant_requests(user=Depends(merchant_only), establishment_id: Optional[str] = None,
                            status: Optional[str] = None, type: Optional[str] = None, q: Optional[str] = None):
    ids = await _owned_ids(user)
    if establishment_id and establishment_id != "all":
        ids = [establishment_id] if establishment_id in ids else []
    query = {"establishment_id": {"$in": ids}}
    if status:
        query["status"] = status
    if type:
        query["request_type"] = type
    items = await db.requests.find(query).sort("created_at", -1).to_list(1000) if ids else []
    if q:
        ql = q.lower()
        items = [r for r in items if ql in (r.get("consumer_name") or "").lower() or ql in (r.get("code") or "").lower()]
    return [_req_public(r) for r in items]


@router.post("/merchant/requests/{rid}/accept")
async def merchant_accept(rid: str, user=Depends(merchant_only)):
    r = await _req_of_owner(user, rid)
    if r.get("status") != "awaiting":
        raise HTTPException(status_code=400, detail="Esta solicitação não está aguardando resposta.")
    await _set_status(r, "accepted", by="merchant")
    await create_notification(r["consumer_id"], "consumer", "request", STATUS_TITLE["accepted"],
                              f"{r.get('establishment_name')} • {r.get('code')}", "/economy")
    await create_audit(user, "accept_request", rid, {"status": "awaiting"}, {"status": "accepted"})
    return _req_public(await db.requests.find_one({"id": rid}))


@router.post("/merchant/requests/{rid}/reject")
async def merchant_reject(rid: str, user=Depends(merchant_only)):
    r = await _req_of_owner(user, rid)
    if r.get("status") in ("completed", "cancelled", "rejected", "expired"):
        raise HTTPException(status_code=400, detail="Esta solicitação já foi finalizada.")
    await _set_status(r, "rejected", by="merchant")
    await create_notification(r["consumer_id"], "consumer", "request", STATUS_TITLE["rejected"],
                              f"{r.get('establishment_name')} • {r.get('code')}", "/economy")
    await create_audit(user, "reject_request", rid, {"status": r.get("status")}, {"status": "rejected"})
    return _req_public(await db.requests.find_one({"id": rid}))


class StatusInput(BaseModel):
    status: str


@router.post("/merchant/requests/{rid}/status")
async def merchant_status(rid: str, payload: StatusInput, user=Depends(merchant_only)):
    r = await _req_of_owner(user, rid)
    if payload.status not in MERCHANT_STATUS_STEPS:
        raise HTTPException(status_code=400, detail="Status inválido.")
    if r.get("status") in ("completed", "cancelled", "rejected", "expired"):
        raise HTTPException(status_code=400, detail="Esta solicitação já foi finalizada.")
    await _set_status(r, payload.status, by="merchant")
    await create_notification(r["consumer_id"], "consumer", "request", STATUS_TITLE.get(payload.status, "Atualização"),
                              f"{r.get('establishment_name')} • {r.get('code')}", "/economy")
    await create_audit(user, "update_request_status", rid, {"status": r.get("status")}, {"status": payload.status})
    return _req_public(await db.requests.find_one({"id": rid}))


class RespondInput(BaseModel):
    message: str


@router.post("/merchant/requests/{rid}/respond")
async def merchant_respond(rid: str, payload: RespondInput, user=Depends(merchant_only)):
    r = await _req_of_owner(user, rid)
    await db.requests.update_one({"id": rid}, {"$set": {"merchant_response": payload.message, "updated_at": now_iso()}})
    await create_notification(r["consumer_id"], "consumer", "request", "Resposta do estabelecimento",
                              f"{r.get('establishment_name')} respondeu sua solicitação • {r.get('code')}", "/economy")
    return _req_public(await db.requests.find_one({"id": rid}))


class ConfirmInput(BaseModel):
    gross_amount: Optional[float] = None


@router.post("/merchant/requests/{rid}/confirm")
async def merchant_confirm(rid: str, payload: ConfirmInput, user=Depends(merchant_only)):
    """Confirmação final (atendimento/retirada/entrega/concluído): usa o desconto UMA vez, idempotente."""
    # transição atômica: só confirma se ainda não foi concluída
    r = await _req_of_owner(user, rid)
    if r.get("status") == "completed" and r.get("transaction_id"):
        return _req_public(r)  # idempotente
    if r.get("status") in ("cancelled", "rejected", "expired"):
        raise HTTPException(status_code=400, detail="Esta solicitação não pode ser concluída.")

    gross = payload.gross_amount
    discount = 0.0
    final = 0.0
    tx_id = None
    if r.get("discount_applies"):
        if gross is None or gross <= 0:
            raise HTTPException(status_code=400, detail="Informe o valor total da compra para registrar o desconto.")
        minp = r.get("discount_min_purchase") or 0
        if gross < minp:
            raise HTTPException(status_code=400, detail=f"O desconto é válido para compras a partir de R$ {minp:.2f}.")
        pct = r.get("discount_percent") or 0
        discount = round(gross * pct / 100, 2)
        cap = r.get("discount_max_cap")
        if cap is not None and discount > cap:
            discount = round(cap, 2)
        final = round(gross - discount, 2)
    else:
        gross = gross or 0
        final = round(gross, 2)

    # marca concluída de forma idempotente (impede reuso do código)
    lock = await db.requests.find_one_and_update(
        {"id": rid, "status": {"$ne": "completed"}},
        {"$set": {"status": "completed", "updated_at": now_iso(),
                  "gross_amount": gross, "discount_amount": discount, "saved_amount": discount, "final_amount": final},
         "$push": {"status_history": {"status": "completed", "at": now_iso(), "by": "merchant", "note": "Confirmada"}}})
    if lock is None:
        current = await db.requests.find_one({"id": rid})
        return _req_public(current)

    confirmed_at = now_iso()
    tx = {
        "id": new_id(), "consumer_id": r["consumer_id"], "consumer_name": r.get("consumer_name"),
        "consumer_photo": r.get("consumer_photo"),
        "establishment_id": r["establishment_id"], "establishment_name": r.get("establishment_name"),
        "merchant_owner_id": r.get("merchant_owner_id"),
        "discount_percent": r.get("discount_percent"), "discount_min_purchase": r.get("discount_min_purchase"),
        "discount_max_cap": r.get("discount_max_cap"), "discount_rules": r.get("discount_rules"),
        "gross_amount": gross, "discount_amount": discount, "saved_amount": discount, "final_amount": final,
        "created_at": r.get("created_at"), "status": "confirmed",
        "confirmed_by": user["id"], "confirmed_at": confirmed_at,
        "transaction_code": r.get("code"), "validation_token": None,
        "device": "remote", "validation_mode": "remote", "origin": "remote_request", "request_id": rid,
    }
    await db.transactions.insert_one(dict(tx))
    tx_id = tx["id"]
    await db.requests.update_one({"id": rid}, {"$set": {"transaction_id": tx_id}})
    if discount > 0:
        await db.users.update_one({"id": r["consumer_id"]}, {"$inc": {"total_saved": discount, "total_spent": final}})
    else:
        await db.users.update_one({"id": r["consumer_id"]}, {"$inc": {"total_spent": final}})

    settings = await get_settings()
    rule = settings.get("ticket_rule_type")
    tickets_to_add = 0
    if rule == "per_confirmed_purchase":
        tickets_to_add = int(settings.get("ticket_rule_value") or 1)
    elif rule == "per_amount":
        step = float(settings.get("ticket_rule_value") or 50)
        tickets_to_add = int(final // step) if step > 0 else 0
    raffle = await db.raffles.find_one({"status": "active"})
    for _ in range(tickets_to_add):
        await db.tickets.insert_one({"id": new_id(), "consumer_id": r["consumer_id"], "transaction_id": tx_id,
                                     "campaign": raffle.get("name") if raffle else "Sorteio",
                                     "number": f"{new_id()[:8].upper()}", "created_at": now_iso(), "status": "valid"})
    if tickets_to_add:
        await db.users.update_one({"id": r["consumer_id"]}, {"$inc": {"ticket_count": tickets_to_add}})

    await create_notification(r["consumer_id"], "consumer", "request", STATUS_TITLE["completed"],
                              (f"Você economizou R$ {discount:.2f} em {r.get('establishment_name')}" if discount > 0
                               else f"Solicitação concluída em {r.get('establishment_name')}") + f" • {r.get('code')}",
                              "/economy")
    await create_audit(user, "confirm_request", rid, {"status": r.get("status")},
                       {"status": "completed", "transaction_id": tx_id, "discount": discount})
    return _req_public(await db.requests.find_one({"id": rid}))
