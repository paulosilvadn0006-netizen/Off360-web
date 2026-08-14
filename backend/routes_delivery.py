"""Modalidade Entrega/Retirada OFF360 (v1 enxuta).
Reaproveita: auth/roles, establishments, snapshot de desconto e o sistema de
validação (código single-use + token + expiry + idempotência) já usado em transactions.
Sem cardápio/carrinho/pagamento online. Pagamento é direto no estabelecimento.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import timedelta
from pymongo import ReturnDocument

from core import (db, require_role, new_id, now_iso, now_utc, strip_id, gen_code,
                  create_notification, get_settings, log_activity, public_user)
import random


def _pin():
    return f"{random.randint(0, 9999):04d}"

router = APIRouter(prefix="/api", tags=["delivery"])
consumer_only = require_role("consumer")
merchant_only = require_role("merchant")
deliverer_only = require_role("deliverer")

# Estados com bolinha: preparing 🟡, ready 🟠, on_the_way 🟢, arrived 🔴, delivered ⚫
ACTIVE_STATUSES = ["new", "preparing", "ready", "on_the_way", "arrived"]


def _order_public(o, viewer_role=None):
    o = strip_id(dict(o))
    return o


async def _est_of_owner(user, eid):
    e = await db.establishments.find_one({"id": eid, "owner_id": user["id"]})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    return e


async def _finalize_order(order, gross_amount, validator_role):
    """Conclui a MESMA transação uma única vez (atômico/idempotente).
    Cria um transactions confirmado (reuso das métricas de consumidor/empresário)
    e registra métricas do entregador no próprio pedido."""
    if gross_amount is None or gross_amount <= 0:
        raise HTTPException(status_code=400, detail="Valor do pedido inválido para validação.")
    need = "ready" if order["mode"] == "pickup" else "arrived"
    # trava atômica: só o primeiro finaliza
    updated = await db.orders.find_one_and_update(
        {"id": order["id"], "status": need},
        {"$set": {"status": "delivered", "delivered_at": now_iso(),
                  "validation_token": None, "validation_used": True,
                  "order_amount": gross_amount, "updated_at": now_iso()},
         "$push": {"status_history": {"status": "delivered", "at": now_iso(), "by": validator_role}}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        cur = await db.orders.find_one({"id": order["id"]})
        if cur and cur.get("status") == "delivered":
            return strip_id(cur)  # idempotente
        raise HTTPException(status_code=400, detail="Pedido não está na etapa de validação.")

    # desconto a partir do snapshot
    pct = updated.get("discount_percent") or 0
    discount = round(gross_amount * pct / 100, 2)
    cap = updated.get("discount_max_cap")
    if cap is not None and discount > cap:
        discount = round(cap, 2)
    final = round(gross_amount - discount, 2)
    confirmed_at = now_iso()
    tx = {
        "id": new_id(), "consumer_id": updated["consumer_id"], "consumer_name": updated.get("consumer_name"),
        "establishment_id": updated["establishment_id"], "establishment_name": updated.get("establishment_name"),
        "merchant_owner_id": updated.get("merchant_owner_id"),
        "discount_percent": pct, "discount_min_purchase": updated.get("discount_min_purchase"),
        "discount_max_cap": cap,
        "gross_amount": gross_amount, "discount_amount": discount, "saved_amount": discount, "final_amount": final,
        "status": "confirmed", "confirmed_by": None, "confirmed_at": confirmed_at, "created_at": confirmed_at,
        "validation_token": None, "origin": updated["mode"], "order_id": updated["id"],
    }
    await db.orders.update_one({"id": updated["id"]}, {"$set": {"transaction_id": tx["id"],
                                                                "gross_amount": gross_amount,
                                                                "discount_amount": discount,
                                                                "saved_amount": discount,
                                                                "final_amount": final}})
    await db.transactions.insert_one(dict(tx))
    await db.users.update_one({"id": updated["consumer_id"]},
                              {"$inc": {"total_saved": discount, "total_spent": final}})
    # notificações (uma vez)
    await create_notification(updated["consumer_id"], "consumer", "order_delivered",
                              "Pedido OFF360 concluído",
                              f"Você economizou R$ {discount:.2f} na {updated.get('establishment_name')}", "/economy")
    await create_notification(updated.get("merchant_owner_id"), "merchant", "order_delivered",
                              "Venda OFF360 registrada",
                              f"{updated.get('consumer_name')} • R$ {final:.2f} • desconto R$ {discount:.2f}",
                              "/merchant/orders")
    if updated.get("deliverer_id"):
        await create_notification(updated["deliverer_id"], "deliverer", "delivery_done",
                                  "Entrega concluída", f"+1 entrega • ganho R$ {float(updated.get('deliverer_earning') or 0):.2f}",
                                  "/deliverer")
    return strip_id(await db.orders.find_one({"id": updated["id"]}))


# ==================== CONSUMIDOR ====================
class WhatsAppInput(BaseModel):
    establishment_id: str


@router.post("/consumer/whatsapp-order")
async def whatsapp_order(payload: WhatsAppInput, user=Depends(consumer_only)):
    e = await db.establishments.find_one({"id": payload.establishment_id})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    pct = e.get("discount_percent")
    if pct:
        msg = "Olá! Encontrei vocês pelo OFF360 e quero aproveitar a oferta disponível."
    else:
        msg = "Olá! Encontrei vocês pelo OFF360."
    phone = "".join(ch for ch in (e.get("whatsapp") or "") if ch.isdigit())
    # registra apenas o evento de interesse (NÃO é venda)
    await log_activity(user, "whatsapp_order", "delivery")
    await db.order_events.insert_one({"id": new_id(), "type": "whatsapp_click", "consumer_id": user["id"],
                                      "establishment_id": e["id"], "created_at": now_iso()})
    link = f"https://wa.me/55{phone}?text={msg}" if phone else None
    return {"phone": phone, "message": msg, "wa_link": link}


class NewOrderInput(BaseModel):
    establishment_id: str
    mode: str  # delivery | pickup
    payment_method: Optional[str] = None  # pix | card | cash
    needs_change: Optional[bool] = False
    change_for: Optional[float] = None
    note: Optional[str] = None


@router.post("/consumer/orders")
async def create_order(payload: NewOrderInput, user=Depends(consumer_only)):
    e = await db.establishments.find_one({"id": payload.establishment_id})
    if not e or e.get("approval_status") != "approved":
        raise HTTPException(status_code=404, detail="Estabelecimento indisponível")
    if payload.mode not in ("delivery", "pickup"):
        raise HTTPException(status_code=400, detail="Modalidade inválida")
    if payload.mode == "delivery" and not e.get("offers_delivery"):
        raise HTTPException(status_code=400, detail="Este estabelecimento não oferece entrega.")
    if payload.mode == "pickup" and not e.get("offers_pickup"):
        raise HTTPException(status_code=400, detail="Este estabelecimento não oferece retirada.")
    if payload.payment_method and payload.payment_method not in ("pix", "card", "cash"):
        raise HTTPException(status_code=400, detail="Forma de pagamento inválida")
    order = {
        "id": new_id(), "code": gen_code("ODR"), "number": _pin(),
        "consumer_id": user["id"], "consumer_name": user.get("name"), "consumer_photo": user.get("photo_url"),
        "establishment_id": e["id"], "establishment_name": e.get("fantasy_name"),
        "merchant_owner_id": e.get("owner_id"),
        "mode": payload.mode, "status": "new",
        "payment_method": payload.payment_method,
        "needs_change": bool(payload.needs_change) if payload.payment_method == "cash" else False,
        "change_for": payload.change_for if (payload.payment_method == "cash" and payload.needs_change) else None,
        "note": payload.note,
        # snapshot de desconto (nunca recalculado se o estab. mudar depois)
        "discount_percent": e.get("discount_percent"), "discount_min_purchase": e.get("discount_min_purchase"),
        "discount_max_cap": e.get("discount_max_cap"),
        # validação single-use (código de 4 dígitos)
        "validation_code": _pin(), "validation_token": new_id(),
        "token_expires_at": (now_utc() + timedelta(hours=6)).isoformat(), "validation_used": False,
        # métricas entregador
        "deliverer_id": None, "deliverer_name": None, "deliverer_earning": None, "order_amount": None,
        "transaction_id": None, "cancel_reason": None,
        "status_history": [{"status": "new", "at": now_iso(), "by": "consumer"}],
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.orders.insert_one(dict(order))
    await create_notification(e.get("owner_id"), "merchant", "order_new", "Novo pedido OFF360",
                              f"{user.get('name')} • {'Entrega' if payload.mode=='delivery' else 'Retirada'}",
                              "/merchant/orders")
    return strip_id(order)


@router.get("/consumer/orders")
async def consumer_orders(user=Depends(consumer_only)):
    items = await db.orders.find({"consumer_id": user["id"]}).sort("created_at", -1).to_list(100)
    return [strip_id(o) for o in items]


@router.get("/consumer/orders/{oid}")
async def consumer_order(oid: str, user=Depends(consumer_only)):
    o = await db.orders.find_one({"id": oid, "consumer_id": user["id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    return strip_id(o)


class ConfirmQRInput(BaseModel):
    validation_token: str


@router.post("/consumer/orders/{oid}/confirm-qr")
async def consumer_confirm_qr(oid: str, payload: ConfirmQRInput, user=Depends(consumer_only)):
    """Consumidor confirma a PRÓPRIA entrega/retirada lendo o QR (token do pedido)."""
    o = await db.orders.find_one({"id": oid, "consumer_id": user["id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if o.get("status") == "delivered":
        return strip_id(o)
    if o.get("validation_used") or o.get("validation_token") != payload.validation_token:
        raise HTTPException(status_code=400, detail="Validação inválida ou já utilizada.")
    if o.get("token_expires_at", "") < now_iso():
        raise HTTPException(status_code=400, detail="Validação expirada.")
    return strip_id(await _finalize_order(o, o.get("order_amount"), "consumer"))


# ==================== EMPRESÁRIO ====================
@router.get("/merchant/orders")
async def merchant_orders(establishment_id: Optional[str] = None, user=Depends(merchant_only)):
    ests = await db.establishments.find({"owner_id": user["id"]}).to_list(50)
    ids = [e["id"] for e in ests]
    if establishment_id and establishment_id != "all":
        ids = [establishment_id] if establishment_id in ids else []
    items = await db.orders.find({"establishment_id": {"$in": ids}}).sort("created_at", -1).to_list(300) if ids else []
    return [strip_id(o) for o in items]


class MerchantNewOrderInput(BaseModel):
    establishment_id: str
    consumer_identifier: str  # e-mail ou WhatsApp do consumidor
    order_amount: float
    mode: str  # delivery | pickup


@router.post("/merchant/orders")
async def merchant_create_order(payload: MerchantNewOrderInput, user=Depends(merchant_only)):
    """'+ Nova entrega OFF360' — empresário cria o pedido após fechar no WhatsApp.
    Entrega -> entra como 'ready' (aparece em Nova entrega dos entregadores).
    Retirada -> segue o fluxo próprio (preparing -> ready -> validação), sem fila de entregadores."""
    e = await db.establishments.find_one({"id": payload.establishment_id, "owner_id": user["id"]})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    if payload.mode not in ("delivery", "pickup"):
        raise HTTPException(status_code=400, detail="Modalidade inválida")
    if payload.mode == "delivery" and not e.get("offers_delivery"):
        raise HTTPException(status_code=400, detail="Ative 'Entrega' na configuração do estabelecimento.")
    if payload.mode == "pickup" and not e.get("offers_pickup"):
        raise HTTPException(status_code=400, detail="Ative 'Retirada' na configuração do estabelecimento.")
    if not payload.order_amount or payload.order_amount <= 0:
        raise HTTPException(status_code=400, detail="Informe o valor do pedido.")
    ident = (payload.consumer_identifier or "").strip().lower()
    digits = "".join(ch for ch in ident if ch.isdigit())
    ors = [{"email": ident}]
    if digits:
        ors.append({"phone": {"$regex": digits + "$"}})
    cons = await db.users.find_one({"role": "consumer", "$or": ors})
    if not cons:
        raise HTTPException(status_code=404, detail="Consumidor não encontrado no OFF360 (verifique o e-mail/WhatsApp cadastrado).")
    status = "ready" if payload.mode == "delivery" else "preparing"
    order = {
        "id": new_id(), "code": gen_code("ODR"), "number": _pin(),
        "consumer_id": cons["id"], "consumer_name": cons.get("name"), "consumer_photo": cons.get("photo_url"),
        "establishment_id": e["id"], "establishment_name": e.get("fantasy_name"), "merchant_owner_id": e.get("owner_id"),
        "mode": payload.mode, "status": status, "payment_method": None, "needs_change": False, "change_for": None, "note": None,
        "discount_percent": e.get("discount_percent"), "discount_min_purchase": e.get("discount_min_purchase"),
        "discount_max_cap": e.get("discount_max_cap"),
        "validation_code": _pin(), "validation_token": new_id(),
        "token_expires_at": (now_utc() + timedelta(hours=6)).isoformat(), "validation_used": False,
        "deliverer_id": None, "deliverer_name": None, "deliverer_earning": None, "order_amount": payload.order_amount,
        "transaction_id": None, "cancel_reason": None, "created_by": "merchant",
        "status_history": [{"status": status, "at": now_iso(), "by": "merchant"}],
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.orders.insert_one(dict(order))
    await create_notification(cons["id"], "consumer", "order_new", "Pedido OFF360 criado",
                              f"{e.get('fantasy_name')} • {'Entrega a caminho da fila' if payload.mode=='delivery' else 'Retirada'} • guarde seu código", f"/order/{order['id']}")
    return strip_id(order)


async def _order_of_owner(user, oid):
    o = await db.orders.find_one({"id": oid})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    e = await db.establishments.find_one({"id": o["establishment_id"], "owner_id": user["id"]})
    if not e:
        raise HTTPException(status_code=403, detail="Sem permissão sobre este pedido.")
    return strip_id(o)


async def _advance(oid, from_statuses, to_status, by, extra=None):
    upd = {"status": to_status, "updated_at": now_iso()}
    if extra:
        upd.update(extra)
    updated = await db.orders.find_one_and_update(
        {"id": oid, "status": {"$in": from_statuses}},
        {"$set": upd, "$push": {"status_history": {"status": to_status, "at": now_iso(), "by": by}}},
        return_document=ReturnDocument.AFTER)
    if not updated:
        raise HTTPException(status_code=400, detail="Transição de status inválida.")
    return strip_id(updated)


class AmountInput(BaseModel):
    order_amount: Optional[float] = None


@router.post("/merchant/orders/{oid}/start-prep")
async def start_prep(oid: str, user=Depends(merchant_only)):
    o = await _order_of_owner(user, oid)
    updated = await _advance(oid, ["new"], "preparing", "merchant")
    await create_notification(o["consumer_id"], "consumer", "order_preparing", "Pedido em preparo",
                              "Seu pedido OFF360 está sendo preparado", f"/order/{oid}")
    return strip_id(updated)


@router.post("/merchant/orders/{oid}/ready")
async def order_ready(oid: str, payload: AmountInput, user=Depends(merchant_only)):
    o = await _order_of_owner(user, oid)
    extra = {"order_amount": payload.order_amount} if payload.order_amount else None
    updated = await _advance(oid, ["preparing"], "ready", "merchant", extra)
    await create_notification(o["consumer_id"], "consumer", "order_ready", "Pedido pronto",
                              "Seu pedido OFF360 está pronto" + (" para retirada" if o["mode"] == "pickup" else ""),
                              f"/order/{oid}")
    return strip_id(updated)


@router.post("/merchant/orders/{oid}/on-the-way")
async def merchant_on_the_way(oid: str, user=Depends(merchant_only)):
    o = await _order_of_owner(user, oid)
    if o["mode"] != "delivery":
        raise HTTPException(status_code=400, detail="Somente pedidos de entrega.")
    updated = await _advance(oid, ["ready"], "on_the_way", "merchant")
    await create_notification(o["consumer_id"], "consumer", "order_on_the_way", "Pedido a caminho",
                              "Seu pedido OFF360 está a caminho", f"/order/{oid}")
    return strip_id(updated)


class CancelInput(BaseModel):
    reason: str


@router.post("/merchant/orders/{oid}/cancel")
async def cancel_order(oid: str, payload: CancelInput, user=Depends(merchant_only)):
    o = await _order_of_owner(user, oid)
    if o.get("status") == "delivered":
        raise HTTPException(status_code=400, detail="Pedido já concluído não pode ser cancelado.")
    if o.get("status") == "cancelled":
        return strip_id(o)
    updated = await _advance(oid, ACTIVE_STATUSES, "cancelled", "merchant",
                             {"cancel_reason": (payload.reason or "").strip() or "Não informado"})
    await create_notification(o["consumer_id"], "consumer", "order_cancelled", "Pedido cancelado",
                              f"Seu pedido em {o.get('establishment_name')} foi cancelado.", f"/order/{oid}")
    if o.get("deliverer_id"):
        await create_notification(o["deliverer_id"], "deliverer", "order_cancelled", "Entrega cancelada",
                                  "O estabelecimento cancelou este pedido.", "/deliverer")
    return strip_id(updated)


class MerchantValidateInput(BaseModel):
    code: str
    order_amount: Optional[float] = None


@router.post("/merchant/orders/{oid}/validate-code")
async def merchant_validate(oid: str, payload: MerchantValidateInput, user=Depends(merchant_only)):
    """Retirada: consumidor informa o código e o empresário valida (define o valor)."""
    o = await _order_of_owner(user, oid)
    if o["mode"] != "pickup":
        raise HTTPException(status_code=400, detail="Validação por retirada é apenas para pedidos de retirada.")
    if o.get("status") == "delivered":
        return strip_id(o)
    if o.get("validation_used") or (payload.code or "").strip().upper() != (o.get("validation_code") or "").upper():
        raise HTTPException(status_code=400, detail="Código inválido ou já utilizado.")
    if o.get("token_expires_at", "") < now_iso():
        raise HTTPException(status_code=400, detail="Código expirado.")
    gross = payload.order_amount if payload.order_amount is not None else o.get("order_amount")
    return strip_id(await _finalize_order(o, gross, "merchant"))


# ==================== ENTREGADOR ====================
@router.get("/deliverer/profile")
async def deliverer_profile(user=Depends(deliverer_only)):
    return public_user(user) | {"vehicle": user.get("vehicle"), "city": user.get("city"),
                                "works_fixed": user.get("works_fixed"),
                                "fixed_establishment_id": user.get("fixed_establishment_id")}


@router.get("/deliverer/orders/available")
async def available_orders(user=Depends(deliverer_only)):
    """Nova entrega: pedidos de entrega prontos e sem entregador."""
    q = {"mode": "delivery", "status": "ready", "deliverer_id": None}
    if user.get("works_fixed") and user.get("fixed_establishment_id"):
        q["establishment_id"] = user["fixed_establishment_id"]
    items = await db.orders.find(q).sort("created_at", 1).to_list(100)
    return [strip_id(o) for o in items]


@router.get("/deliverer/orders")
async def deliverer_orders(scope: Optional[str] = None, user=Depends(deliverer_only)):
    q = {"deliverer_id": user["id"]}
    if scope == "active":
        q["status"] = {"$in": ["on_the_way", "arrived"]}
    elif scope == "history":
        q["status"] = {"$in": ["delivered", "cancelled"]}
    items = await db.orders.find(q).sort("created_at", -1).to_list(300)
    return [strip_id(o) for o in items]


class StartDeliveryInput(BaseModel):
    order_amount: float
    earning: float


@router.post("/deliverer/orders/{oid}/start")
async def start_delivery(oid: str, payload: StartDeliveryInput, user=Depends(deliverer_only)):
    o = await db.orders.find_one({"id": oid})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if o.get("consumer_id") == user["id"]:
        raise HTTPException(status_code=403, detail="Você não pode entregar seu próprio pedido.")
    if o["mode"] != "delivery":
        raise HTTPException(status_code=400, detail="Pedido não é de entrega.")
    if payload.order_amount <= 0 or payload.earning < 0:
        raise HTTPException(status_code=400, detail="Valores inválidos.")
    updated = await db.orders.find_one_and_update(
        {"id": oid, "status": "ready", "deliverer_id": None},
        {"$set": {"status": "on_the_way", "deliverer_id": user["id"], "deliverer_name": user.get("name"),
                  "order_amount": payload.order_amount, "deliverer_earning": round(payload.earning, 2),
                  "updated_at": now_iso()},
         "$push": {"status_history": {"status": "on_the_way", "at": now_iso(), "by": "deliverer"}}},
        return_document=ReturnDocument.AFTER)
    if not updated:
        raise HTTPException(status_code=400, detail="Pedido não está disponível para coleta.")
    await create_notification(o["consumer_id"], "consumer", "order_on_the_way", "Pedido a caminho",
                              "Seu pedido OFF360 está a caminho", f"/order/{oid}")
    return strip_id(updated)


@router.post("/deliverer/orders/{oid}/arrived")
async def arrived(oid: str, user=Depends(deliverer_only)):
    o = await db.orders.find_one({"id": oid, "deliverer_id": user["id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    updated = await _advance(oid, ["on_the_way"], "arrived", "deliverer")
    await create_notification(o["consumer_id"], "consumer", "order_arrived", "Sua entrega OFF360 chegou!",
                              "Confirme o recebimento por QR Code ou código.", f"/order/{oid}")
    return strip_id(updated)


class DelivererValidateInput(BaseModel):
    code: str


@router.post("/deliverer/orders/{oid}/validate-code")
async def deliverer_validate(oid: str, payload: DelivererValidateInput, user=Depends(deliverer_only)):
    """Sem celular do consumidor: entregador digita o código informado pelo consumidor."""
    o = await db.orders.find_one({"id": oid, "deliverer_id": user["id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if o.get("consumer_id") == user["id"]:
        raise HTTPException(status_code=403, detail="Você não pode validar seu próprio pedido.")
    if o.get("status") == "delivered":
        return strip_id(o)
    if o.get("validation_used") or (payload.code or "").strip().upper() != (o.get("validation_code") or "").upper():
        raise HTTPException(status_code=400, detail="Código inválido ou já utilizado.")
    if o.get("token_expires_at", "") < now_iso():
        raise HTTPException(status_code=400, detail="Código expirado.")
    return strip_id(await _finalize_order(o, o.get("order_amount"), "deliverer"))


@router.get("/deliverer/metrics")
async def deliverer_metrics(user=Depends(deliverer_only)):
    from datetime import datetime, timezone
    now = now_utc()
    start_day = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    start_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    done = await db.orders.find({"deliverer_id": user["id"], "status": "delivered"}).to_list(2000)

    def agg(items):
        return {"count": len(items),
                "earnings": round(sum(float(o.get("deliverer_earning") or 0) for o in items), 2),
                "orders_total": round(sum(float(o.get("order_amount") or 0) for o in items), 2)}
    today = [o for o in done if (o.get("delivered_at") or "") >= start_day]
    month = [o for o in done if (o.get("delivered_at") or "") >= start_month]
    return {"today": agg(today), "month": agg(month), "all": agg(done)}
