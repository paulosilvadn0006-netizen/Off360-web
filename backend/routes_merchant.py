from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from typing import Optional, List
from datetime import timedelta

from core import (db, require_role, new_id, now_iso, now_utc, strip_id,
                  create_notification, create_audit, get_settings,
                  purge_merchant_account, clear_auth_cookies)
import fitz
import geo
from routes_requests import validate_buttons


MERCHANT_PLAN_PRICE = 89.90  # cobrança mensal fixa por CNPJ/estabelecimento


def valid_cnpj(cnpj):
    d = "".join(ch for ch in (cnpj or "") if ch.isdigit())
    if len(d) != 14 or d == d[0] * 14:
        return False

    def _dv(nums):
        s, w = 0, 2
        for n in reversed(nums):
            s += int(n) * w
            w = w + 1 if w < 9 else 2
        r = s % 11
        return 0 if r < 2 else 11 - r

    return _dv(d[:12]) == int(d[12]) and _dv(d[:13]) == int(d[13])


async def notify_favorites(establishment_id, est_name, title, message, link, ntype, dedup_hours=6):
    """Notifica consumidores que favoritaram o estabelecimento (anti-spam por tipo/estab)."""
    cutoff = (now_utc() - timedelta(hours=dedup_hours)).isoformat()
    fans = await db.users.find({"role": "consumer", "favorites": establishment_id,
                                "notify_favorites": {"$ne": False}}).to_list(5000)
    for u in fans:
        recent = await db.notifications.find_one({"recipient_id": u["id"], "type": ntype,
                                                  "establishment_id": establishment_id,
                                                  "created_at": {"$gt": cutoff}})
        if recent:
            continue
        await create_notification(u["id"], "consumer", ntype, title, message, link,
                                  establishment_id=establishment_id)

router = APIRouter(prefix="/api/merchant", tags=["merchant"])
merchant_only = require_role("merchant")
admin_only = require_role("admin")

MAX_ESTABLISHMENTS = 10


async def _owned(user):
    return await db.establishments.find({"owner_id": user["id"]}).sort("created_at", 1).to_list(50)


@router.get("/admin/segments")
async def admin_segments(user=Depends(admin_only)):
    """Análise administrativa: quantos empresários por categoria e por segmento (categoria Outros)."""
    ests = await db.establishments.find({}).to_list(10000)
    by_cat, by_seg = {}, {}
    for e in ests:
        c = e.get("category_name") or "Sem categoria"
        by_cat[c] = by_cat.get(c, 0) + 1
        if (c or "").strip().lower() in OUTROS_CATEGORY_NAMES:
            s = (e.get("segment") or "").strip() or "Não informado"
            by_seg[s] = by_seg.get(s, 0) + 1
    return {
        "total": len(ests),
        "by_category": [{"category": k, "count": v} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
        "outros_segments": [{"segment": k, "count": v} for k, v in sorted(by_seg.items(), key=lambda x: -x[1])],
    }


async def _get_est(user, eid):
    e = await db.establishments.find_one({"id": eid, "owner_id": user["id"]})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    return strip_id(e)


async def _resolve(user, establishment_id):
    ests = await _owned(user)
    if not ests:
        raise HTTPException(status_code=404, detail="Nenhum estabelecimento cadastrado")
    if establishment_id and establishment_id != "all":
        e = next((x for x in ests if x["id"] == establishment_id), None)
        if not e:
            raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
        return strip_id(e)
    return strip_id(ests[0])


def _is_complete(e):
    return bool(e.get("discount_configured") and e.get("category_id") and (e.get("address") or e.get("street") or "").strip())


def _est_summary(e, txs):
    conf = [t for t in txs if t.get("establishment_id") == e["id"] and t.get("status") == "confirmed"]
    return {
        "id": e["id"], "fantasy_name": e.get("fantasy_name"), "category_name": e.get("category_name"),
        "segment": e.get("segment") or "", "specialized_module": _specialized_module_for(e.get("category_name")),
        "food_eligible": _specialized_module_for(e.get("category_name")) == "food",
        "approval_status": e.get("approval_status"), "subscription_status": e.get("subscription_status"),
        "payment_required": bool(e.get("payment_required")),
        "discount_percent": e.get("discount_percent"), "discount_configured": bool(e.get("discount_configured")),
        "registration_complete": _is_complete(e),
        "next_due": e.get("next_due"), "neighborhood": e.get("neighborhood"), "city": e.get("city"),
        "logo_url": e.get("logo_url"),
        "modules": e.get("modules") or {"online": True, "presencial": False},
        "revenue": round(sum(t.get("final_amount", 0) for t in conf), 2),
        "customers": len(set(t.get("consumer_id") for t in conf)),
        "transactions": len(conf),
    }


@router.get("/establishments")
async def list_establishments(user=Depends(merchant_only)):
    ests = await _owned(user)
    ids = [e["id"] for e in ests]
    txs = await db.transactions.find({"establishment_id": {"$in": ids}}).to_list(5000) if ids else []
    settings = await get_settings()
    return {
        "count": len(ests), "limit": MAX_ESTABLISHMENTS,
        "merchant_plan_price": settings.get("merchant_plan_price"),
        "establishments": [_est_summary(strip_id(e), txs) for e in ests],
    }


class NewEstablishment(BaseModel):
    fantasy_name: str
    razao_social: Optional[str] = ""
    cnpj: Optional[str] = None
    uf: Optional[str] = ""
    category_id: Optional[str] = None
    segment: Optional[str] = ""  # segmento livre (obrigatório quando a categoria é "Outros")
    description: Optional[str] = ""
    address: Optional[str] = ""
    street: Optional[str] = ""
    number: Optional[str] = ""
    complement: Optional[str] = ""
    neighborhood: Optional[str] = ""
    city: Optional[str] = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    whatsapp: Optional[str] = ""
    instagram: Optional[str] = ""
    hours: Optional[str] = ""
    logo_url: Optional[str] = None
    cover_url: Optional[str] = None
    discount_percent: Optional[float] = None
    discount_rules: Optional[str] = ""
    delivery_fee: Optional[float] = None
    avg_prep_minutes: Optional[int] = None
    first_purchase_enabled: Optional[bool] = None
    first_purchase_percent: Optional[float] = None
    modules: Optional[dict] = None


DEFAULT_MODULES = {"online": True, "presencial": False}

# ===== Arquitetura de módulos OFF360 (Core + especializados + universais) =====
# Categorias que habilitam o módulo ESPECIALIZADO de Alimentação/Restaurante (Operação Presencial).
FOOD_CATEGORY_NAMES = {"alimentação", "alimentacao", "alimentação/restaurante", "restaurante", "bares e baladas", "bar", "lanchonete", "cafeteria"}
OUTROS_CATEGORY_NAMES = {"outros", "outro"}
# Recursos do núcleo (sempre disponíveis a qualquer segmento).
CORE_MODULES = ["perfil", "clientes", "catalogo", "comunicacao", "avaliacoes", "promocoes", "localizacao"]
# Recursos universais ativáveis conforme categoria/segmento (nunca ativados todos automaticamente).
UNIVERSAL_MODULES = ["produtos", "servicos", "orcamentos", "agenda", "pedidos", "qrcode", "nfc", "entrega", "retirada", "estoque", "financeiro", "equipe", "relatorios", "whatsapp"]


def _specialized_module_for(category_name):
    """Retorna o módulo especializado da categoria (hoje: 'food') ou None (core genérico)."""
    if category_name and category_name.strip().lower() in FOOD_CATEGORY_NAMES:
        return "food"
    return None


def _module_profile(e):
    """Perfil de módulos do estabelecimento: especializado + universais disponíveis.
    A estrutura é definida pela categoria/segmento — não liga tudo automaticamente."""
    spec = _specialized_module_for(e.get("category_name"))
    return {
        "specialized_module": spec,
        "core_modules": CORE_MODULES,
        "universal_modules": UNIVERSAL_MODULES,
        # 'food' = elegível à Operação Presencial (cardápio, mesas, garçom, cozinha, comanda).
        "food_eligible": spec == "food",
    }


def _ensure_modules(e):
    if not e.get("modules"):
        e["modules"] = dict(DEFAULT_MODULES)
    return e


@router.post("/establishments")
async def create_establishment(payload: NewEstablishment, user=Depends(merchant_only)):
    ests = await _owned(user)
    if len(ests) >= MAX_ESTABLISHMENTS:
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_ESTABLISHMENTS} estabelecimentos atingido")
    cat_name = None
    if payload.category_id:
        cat = await db.categories.find_one({"id": payload.category_id})
        cat_name = cat["name"] if cat else None
    segment = (payload.segment or "").strip()
    if cat_name and cat_name.strip().lower() in OUTROS_CATEGORY_NAMES and not segment:
        raise HTTPException(status_code=400, detail="Informe o segmento do seu negócio (campo obrigatório para a categoria Outros).")
    cnpj_digits = "".join(ch for ch in (payload.cnpj or "") if ch.isdigit())
    if not valid_cnpj(cnpj_digits):
        raise HTTPException(status_code=400, detail="CNPJ inválido. Verifique os 14 dígitos.")
    pct = payload.discount_percent
    if pct is not None and (pct < 1 or pct > 100):
        raise HTTPException(status_code=400, detail="O percentual deve ser entre 1% e 100%")
    configured = pct is not None and 1 <= pct <= 100
    eid = new_id()
    est = {
        "id": eid, "owner_id": user["id"], "responsible_name": user.get("name"),
        "phone": user.get("phone"), "email": user.get("email"), "fantasy_name": payload.fantasy_name,
        "category_id": payload.category_id, "category_name": cat_name, "segment": segment,
        "razao_social": (payload.razao_social or "").strip(), "cnpj": cnpj_digits, "uf": (payload.uf or "").strip().upper()[:2],
        "specialized_module": _specialized_module_for(cat_name),
        "description": payload.description or "",
        "logo_url": payload.logo_url, "cover_url": payload.cover_url, "gallery": [],
        "address": payload.address or "", "neighborhood": payload.neighborhood or "", "city": payload.city or "",
        "street": payload.street or "", "number": payload.number or "", "complement": payload.complement or "",
        "lat": payload.lat, "lng": payload.lng, "hours": payload.hours or "",
        "whatsapp": payload.whatsapp or user.get("phone"), "instagram": payload.instagram or "",
        "discount_percent": pct if configured else None, "discount_configured": configured,
        "discount_rules": payload.discount_rules or "",
        "discount_min_purchase": None, "discount_max_cap": None, "discount_participating": "",
        "discount_excluded": "", "discount_valid_days": "", "discount_valid_hours": "",
        "discount_start_date": None, "discount_end_date": None, "discount_cumulative": False,
        "discount_observations": "",
        "delivery_fee": payload.delivery_fee or 0, "avg_prep_minutes": payload.avg_prep_minutes,
        "first_purchase_enabled": bool(payload.first_purchase_enabled), "first_purchase_percent": payload.first_purchase_percent or 0,
        "validation_mode": "controlled",
        "modules": payload.modules or dict(DEFAULT_MODULES),
        "action_buttons": [],
        "qr_token": new_id(), "approval_status": "pending", "subscription_status": "pending",
        "payment_required": True, "activated": False, "plan_price": MERCHANT_PLAN_PRICE,
        "subscription_start": None, "next_due": None,
        "payment_method": None, "auto_renew": True,
        "cancel_date": None, "created_at": now_iso(), "last_access": now_iso(), "last_activity": now_iso(),
    }
    await db.establishments.insert_one(dict(est))
    admins = await db.users.find({"role": "admin"}).to_list(50)
    for a in admins:
        await create_notification(a["id"], "admin", "new_establishment",
                                  "Novo estabelecimento cadastrado", f"{payload.fantasy_name} foi cadastrado e aguarda o pagamento da ativação.", "/admin/establishments")
    await create_notification(user["id"], "merchant", "establishment_status", "Conclua o pagamento",
                              f"{payload.fantasy_name} foi cadastrado! Conclua o pagamento de R$ 89,90/mês para ativar todas as funcionalidades.",
                              "/merchant/activate")
    await create_audit(user, "create_establishment", eid, {}, {"payment_required": True})
    return strip_id(est)


@router.get("/consumers-count")
async def consumers_count(user=Depends(merchant_only)):
    n = await db.users.count_documents({"role": "consumer"})
    return {"count": n}


@router.get("/dashboard")
async def dashboard(establishment_id: Optional[str] = "all", user=Depends(merchant_only)):
    ests = await _owned(user)
    ids = [e["id"] for e in ests]
    all_txs = await db.transactions.find({"establishment_id": {"$in": ids}}).to_list(10000) if ids else []
    settings = await get_settings()
    mprice = settings.get("merchant_plan_price")

    if establishment_id and establishment_id != "all":
        e = await _resolve(user, establishment_id)
        scope = [e]
        selected = e
    else:
        scope = [strip_id(x) for x in ests]
        selected = None

    scope_ids = [e["id"] for e in scope]
    txs = [t for t in all_txs if t.get("establishment_id") in scope_ids]
    confirmed = [t for t in txs if t.get("status") == "confirmed"]

    start_month = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    start_day = now_utc().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    from collections import Counter
    counts = Counter(t.get("consumer_id") for t in confirmed)

    stories = await db.stories.find({"establishment_id": {"$in": scope_ids}, "status": "active", "expires_at": {"$gt": now_iso()}}).to_list(200) if scope_ids else []

    chart = []
    for i in range(6, -1, -1):
        day = (now_utc() - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day + timedelta(days=1)
        val = sum(t.get("final_amount", 0) for t in confirmed if day.isoformat() <= t.get("confirmed_at", "") < day_end.isoformat())
        chart.append({"day": day.strftime("%d/%m"), "value": round(val, 2)})

    active_est = [e for e in scope if e.get("subscription_status") == "active"]
    pending_est = [e for e in scope if e.get("subscription_status") in ("pending", "suspended", "expired", "inactive")]

    return {
        "view": "single" if selected else "all",
        "selected": _est_summary(selected, txs) if selected else None,
        "totals": {
            "establishments": len(scope), "active": len(active_est), "pending": len(pending_est),
            "monthly_value": None if mprice is None else round(len(active_est) * mprice, 2),
            "prices_configured": mprice is not None,
        },
        "revenue": round(sum(t.get("final_amount", 0) for t in confirmed), 2),
        "discounts": round(sum(t.get("discount_amount", 0) for t in confirmed), 2),
        "net": round(sum(t.get("final_amount", 0) for t in confirmed), 2),
        "total_customers": len(set(t.get("consumer_id") for t in confirmed)),
        "new_customers": len(set(t.get("consumer_id") for t in confirmed)),
        "recurring_customers": sum(1 for c, n in counts.items() if n > 1),
        "day_transactions": len([t for t in confirmed if t.get("confirmed_at", "") >= start_day]),
        "month_transactions": len([t for t in confirmed if t.get("confirmed_at", "") >= start_month]),
        "active_stories": len(stories),
        "story_views": sum(s.get("views", 0) for s in stories),
        "chart": chart,
        "per_establishment": [_est_summary(e, all_txs) for e in scope],
        "recent": [strip_id(t) for t in sorted(confirmed, key=lambda x: x.get("confirmed_at") or "", reverse=True)[:8]],
    }


@router.get("/pending")
async def pending(establishment_id: Optional[str] = None, user=Depends(merchant_only)):
    ests = await _owned(user)
    ids = [e["id"] for e in ests]
    if establishment_id and establishment_id != "all":
        ids = [establishment_id] if establishment_id in ids else []
    items = await db.transactions.find({"establishment_id": {"$in": ids}, "status": "pending_validation",
                                        "validation_mode": {"$ne": "fast"}}).sort("created_at", -1).to_list(100) if ids else []
    return [strip_id(t) for t in items]


@router.get("/pending-count")
async def pending_count(user=Depends(merchant_only)):
    ests = await _owned(user)
    ids = [e["id"] for e in ests]
    n = await db.transactions.count_documents({"establishment_id": {"$in": ids}, "status": "pending_validation",
                                               "validation_mode": {"$ne": "fast"}}) if ids else 0
    return {"count": n}


@router.get("/transactions")
async def transactions(establishment_id: Optional[str] = None, status: Optional[str] = None, user=Depends(merchant_only)):
    ests = await _owned(user)
    ids = [e["id"] for e in ests]
    if establishment_id and establishment_id != "all":
        ids = [establishment_id] if establishment_id in ids else []
    q = {"establishment_id": {"$in": ids}}
    if status:
        q["status"] = status
    items = await db.transactions.find(q).sort("created_at", -1).to_list(2000) if ids else []
    out = []
    for t in items:
        t = strip_id(t)
        name = t.get("consumer_name") or ""
        t["consumer_first_name"] = name.split(" ")[0] if name else ""
        t.pop("consumer_name", None)
        out.append(t)
    return out


async def _tx_of_owner(user, tx_id):
    ests = await _owned(user)
    ids = [e["id"] for e in ests]
    tx = await db.transactions.find_one({"id": tx_id, "establishment_id": {"$in": ids}})
    if not tx:
        raise HTTPException(status_code=404, detail="Transação não encontrada")
    return tx


class ConfirmInput(BaseModel):
    gross_amount: float


@router.post("/transactions/{tx_id}/confirm")
async def confirm(tx_id: str, payload: ConfirmInput, user=Depends(merchant_only)):
    tx = await _tx_of_owner(user, tx_id)
    if tx.get("status") != "pending_validation":
        raise HTTPException(status_code=400, detail="Transação já processada")
    if tx.get("token_expires_at", "") < now_iso():
        raise HTTPException(status_code=400, detail="Sessão de validação expirada. Peça ao cliente para escanear novamente.")
    gross = payload.gross_amount
    if gross is None or gross <= 0:
        raise HTTPException(status_code=400, detail="Informe um valor de compra válido")
    minp = tx.get("discount_min_purchase") or 0
    if gross < minp:
        raise HTTPException(status_code=400, detail=f"O desconto é válido para compras a partir de R$ {minp:.2f}.")
    pct = tx.get("discount_percent") or 0
    discount = round(gross * pct / 100, 2)
    cap = tx.get("discount_max_cap")
    if cap is not None and discount > cap:
        discount = round(cap, 2)
    final = round(gross - discount, 2)
    confirmed_at = now_iso()
    await db.transactions.update_one({"id": tx_id}, {"$set": {
        "gross_amount": gross, "discount_amount": discount, "saved_amount": discount, "final_amount": final,
        "status": "confirmed", "confirmed_by": user["id"], "confirmed_at": confirmed_at, "validation_token": None,
    }})
    await db.users.update_one({"id": tx["consumer_id"]}, {"$inc": {"total_saved": discount, "total_spent": final}})
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
        await db.tickets.insert_one({"id": new_id(), "consumer_id": tx["consumer_id"], "transaction_id": tx_id,
                                     "campaign": raffle.get("name") if raffle else "Sorteio", "number": f"{new_id()[:8].upper()}",
                                     "created_at": now_iso(), "status": "valid"})
    if tickets_to_add:
        await db.users.update_one({"id": tx["consumer_id"]}, {"$inc": {"ticket_count": tickets_to_add}})
    await create_notification(tx["consumer_id"], "consumer", "purchase_confirmed", "Transação confirmada",
                              f"Você economizou R$ {discount:.2f} na {tx.get('establishment_name')}", "/economy")
    if tickets_to_add:
        await create_notification(tx["consumer_id"], "consumer", "new_ticket", "Novo bilhete!", f"Você ganhou {tickets_to_add} bilhete(s)", "/raffles")
    updated = await db.transactions.find_one({"id": tx_id})
    return strip_id(updated)


@router.post("/transactions/{tx_id}/reject")
async def reject(tx_id: str, user=Depends(merchant_only)):
    tx = await _tx_of_owner(user, tx_id)
    if tx.get("status") != "pending_validation":
        raise HTTPException(status_code=400, detail="Transação inválida")
    await db.transactions.update_one({"id": tx_id}, {"$set": {"status": "cancelled", "confirmed_by": user["id"]}})
    await create_notification(tx["consumer_id"], "consumer", "purchase_cancelled", "Validação recusada",
                              f"A validação em {tx.get('establishment_name')} foi recusada", "/economy")
    return {"ok": True}


@router.get("/qr")
async def my_qr(establishment_id: Optional[str] = None, user=Depends(merchant_only)):
    e = await _resolve(user, establishment_id)
    return {"qr_token": e.get("qr_token"), "fantasy_name": e.get("fantasy_name"),
            "discount_percent": e.get("discount_percent"), "discount_configured": bool(e.get("discount_configured")),
            "discount_min_purchase": e.get("discount_min_purchase"),
            "registration_complete": _is_complete(e),
            "validation_mode": e.get("validation_mode") or "controlled",
            "payment_required": bool(e.get("payment_required")),
            "subscription_status": e.get("subscription_status"), "approval_status": e.get("approval_status")}


class RotateQR(BaseModel):
    establishment_id: str


@router.post("/qr/rotate")
async def rotate_qr(payload: RotateQR, user=Depends(merchant_only)):
    e = await _get_est(user, payload.establishment_id)
    token = new_id()
    await db.establishments.update_one({"id": e["id"]}, {"$set": {"qr_token": token}})
    await create_audit(user, "rotate_qr", e["id"], {"qr_token": e.get("qr_token")}, {"qr_token": token})
    return {"qr_token": token}


@router.get("/geocode")
async def merchant_geocode(q: str, lat: Optional[float] = None, lng: Optional[float] = None, user=Depends(merchant_only)):
    return geo.geocode(q, lat=lat, lng=lng)


@router.get("/place-details")
async def merchant_place_details(place_id: str, user=Depends(merchant_only)):
    d = geo.place_details(place_id)
    if not d:
        raise HTTPException(status_code=404, detail="Local não encontrado")
    return d


def _fmt_cnpj(d):
    d = "".join(ch for ch in (d or "") if ch.isdigit())
    if len(d) != 14:
        return d or "—"
    return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"


def _fmt_date_br(iso):
    if not iso:
        return "—"
    try:
        from datetime import datetime
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%d/%m/%Y")
    except Exception:
        return "—"


def _receipt_pdf(est, owner):
    doc = fitz.open()
    page = doc.new_page(width=420, height=560)
    orange, dark, gray = (1, 0.478, 0), (0.03, 0.08, 0.16), (0.4, 0.43, 0.47)
    page.draw_rect(fitz.Rect(0, 0, 420, 72), color=orange, fill=orange)
    page.insert_text((28, 40), "OFF360", fontsize=22, color=(1, 1, 1), fontname="hebo")
    page.insert_text((28, 60), "Comprovante de Ativacao", fontsize=11, color=(1, 1, 1), fontname="helv")
    page.insert_text((28, 104), est.get("fantasy_name") or "Estabelecimento", fontsize=15, color=dark, fontname="hebo")
    y = [138]

    def line(label, value, bold=False):
        page.insert_text((28, y[0]), label, fontsize=10, color=gray, fontname="helv")
        page.insert_text((205, y[0]), str(value or "—"), fontsize=11, color=dark, fontname=("hebo" if bold else "helv"))
        y[0] += 27

    line("Razao social", est.get("razao_social"))
    line("CNPJ", _fmt_cnpj(est.get("cnpj")))
    line("Responsavel", owner.get("name"))
    line("Plano mensal", "R$ 89,90", bold=True)
    line("Forma de pagamento", "Pix" if est.get("payment_method") == "pix" else "Cartao de credito")
    line("Ativado em", _fmt_date_br(est.get("subscription_start")))
    line("Proxima renovacao", _fmt_date_br(est.get("next_due")))
    y[0] += 8
    page.draw_line(fitz.Point(28, y[0]), fitz.Point(392, y[0]), color=(0.85, 0.85, 0.85))
    y[0] += 24
    page.insert_text((28, y[0]), "Status: ATIVO - renovacao automatica a cada 30 dias.", fontsize=10, color=(0.1, 0.6, 0.3), fontname="hebo")
    page.insert_text((28, 540), "OFF360 - Documento gerado automaticamente. Nao e documento fiscal.", fontsize=7.5, color=gray, fontname="helv")
    pdf = doc.tobytes()
    doc.close()
    return pdf


@router.get("/receipt")
async def merchant_receipt(establishment_id: str, user=Depends(merchant_only)):
    e = await _resolve(user, establishment_id)
    if e.get("payment_required") or not e.get("subscription_start"):
        raise HTTPException(status_code=400, detail="Comprovante disponível somente após a ativação do pagamento.")
    pdf = _receipt_pdf(e, user)
    fname = ("comprovante-off360-" + (e.get("fantasy_name") or "estabelecimento")).replace(" ", "-").lower()
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}.pdf"'})


@router.get("/establishment")
async def get_establishment(establishment_id: Optional[str] = None, user=Depends(merchant_only)):
    e = await _resolve(user, establishment_id)
    e["registration_complete"] = _is_complete(e)
    _ensure_modules(e)
    return e


class EstUpdate(BaseModel):
    fantasy_name: Optional[str] = None
    description: Optional[str] = None
    category_id: Optional[str] = None
    segment: Optional[str] = None
    address: Optional[str] = None
    street: Optional[str] = None
    number: Optional[str] = None
    complement: Optional[str] = None
    neighborhood: Optional[str] = None
    city: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    hours: Optional[str] = None
    whatsapp: Optional[str] = None
    instagram: Optional[str] = None
    discount_rules: Optional[str] = None
    logo_url: Optional[str] = None
    cover_url: Optional[str] = None
    gallery: Optional[List[str]] = None
    discount_percent: Optional[float] = None
    # structured discount conditions
    discount_min_purchase: Optional[float] = None
    discount_max_cap: Optional[float] = None
    discount_participating: Optional[str] = None
    discount_excluded: Optional[str] = None
    discount_valid_days: Optional[str] = None
    discount_valid_hours: Optional[str] = None
    discount_start_date: Optional[str] = None
    discount_end_date: Optional[str] = None
    discount_cumulative: Optional[bool] = None
    discount_observations: Optional[str] = None
    validation_mode: Optional[str] = None
    modules: Optional[dict] = None
    action_buttons: Optional[List[dict]] = None
    # Entrega/Retirada OFF360
    offers_delivery: Optional[bool] = None
    offers_pickup: Optional[bool] = None
    delivery_areas: Optional[str] = None
    delivery_fee: Optional[float] = None
    delivery_fee_text: Optional[str] = None
    delivery_eta: Optional[str] = None
    avg_prep_minutes: Optional[int] = None
    first_purchase_enabled: Optional[bool] = None
    first_purchase_percent: Optional[float] = None
    pay_pix: Optional[bool] = None
    pay_card: Optional[bool] = None
    pay_cash: Optional[bool] = None


@router.put("/establishment/{eid}")
async def update_establishment(eid: str, payload: EstUpdate, user=Depends(merchant_only)):
    e = await _get_est(user, eid)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    msg = None
    if "action_buttons" in updates:
        updates["action_buttons"] = validate_buttons(updates["action_buttons"])
    if "discount_percent" in updates:
        pct = updates["discount_percent"]
        if pct < 1 or pct > 100:
            raise HTTPException(status_code=400, detail="O percentual deve ser entre 1% e 100%")
        if pct != e.get("discount_percent"):
            await create_audit(user, "update_discount", eid, {"discount_percent": e.get("discount_percent")}, {"discount_percent": pct})
        updates["discount_configured"] = True
        msg = "Percentual de desconto configurado."
    if "category_id" in updates:
        cat = await db.categories.find_one({"id": updates["category_id"]})
        if cat:
            updates["category_name"] = cat["name"]
            updates["specialized_module"] = _specialized_module_for(cat["name"])
            if cat["name"].strip().lower() in OUTROS_CATEGORY_NAMES:
                seg = (updates.get("segment") or e.get("segment") or "").strip()
                if not seg:
                    raise HTTPException(status_code=400, detail="Informe o segmento do seu negócio (obrigatório para a categoria Outros).")
    updates["last_activity"] = now_iso()
    await db.establishments.update_one({"id": eid}, {"$set": updates})
    updated = await db.establishments.find_one({"id": eid})
    return {"establishment": strip_id(updated), "message": msg}


@router.delete("/account")
async def delete_my_account(response: Response, user=Depends(merchant_only)):
    """O empresário encerra e apaga a própria conta (e todos os estabelecimentos)."""
    await create_audit(user, "self_delete_merchant", user["id"],
                        {"email": user.get("email"), "name": user.get("name")}, {})
    await purge_merchant_account(user["id"])
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/stories")
async def list_stories(establishment_id: Optional[str] = None, user=Depends(merchant_only)):
    e = await _resolve(user, establishment_id)
    items = await db.stories.find({"establishment_id": e["id"]}).sort("created_at", -1).to_list(100)
    return [strip_id(s) for s in items]


class StoryInput(BaseModel):
    establishment_id: str
    category: str
    title: str
    text: Optional[str] = ""
    media_url: Optional[str] = None
    media_type: Optional[str] = "image"
    whatsapp_link: Optional[str] = None


@router.post("/stories")
async def create_story(payload: StoryInput, user=Depends(merchant_only)):
    e = await _get_est(user, payload.establishment_id)
    story = {"id": new_id(), "establishment_id": e["id"], "establishment_name": e.get("fantasy_name"),
             "category": payload.category, "title": payload.title, "text": payload.text,
             "media_url": payload.media_url, "media_type": payload.media_type, "whatsapp_link": payload.whatsapp_link,
             "created_at": now_iso(), "expires_at": (now_utc() + timedelta(hours=24)).isoformat(), "status": "active", "views": 0}
    await db.stories.insert_one(dict(story))
    # Notificação inteligente p/ favoritos — só conteúdo relevante (oferta/evento/novidade)
    if payload.category in ("offer", "event"):
        titulo = "Novidade de um favorito ❤️" if payload.category == "offer" else "Evento de um favorito 🔥"
        await notify_favorites(e["id"], e.get("fantasy_name"), titulo,
                               f"{e.get('fantasy_name')}: {payload.title}", "/home", "favorite_update")
    return strip_id(story)


@router.delete("/stories/{sid}")
async def delete_story(sid: str, user=Depends(merchant_only)):
    ests = await _owned(user)
    ids = [e["id"] for e in ests]
    await db.stories.update_one({"id": sid, "establishment_id": {"$in": ids}}, {"$set": {"status": "removed"}})
    return {"ok": True}


@router.get("/subscription")
async def subscription(user=Depends(merchant_only)):
    ests = await _owned(user)
    settings = await get_settings()
    mprice = settings.get("merchant_plan_price")
    active = [e for e in ests if e.get("subscription_status") == "active"]
    return {
        "price_per_establishment": mprice,
        "count": len(ests), "active_count": len(active),
        "monthly_total": None if mprice is None else round(len(active) * mprice, 2),
        "prices_configured": mprice is not None,
        "establishments": [{"id": e["id"], "fantasy_name": e.get("fantasy_name"),
                            "subscription_status": e.get("subscription_status"), "next_due": e.get("next_due"),
                            "payment_method": e.get("payment_method"), "subscription_start": e.get("subscription_start"),
                            "payment_required": bool(e.get("payment_required")), "activated": bool(e.get("subscription_start")),
                            "value": mprice} for e in [strip_id(x) for x in ests]],
    }


# ==================== CATÁLOGO (vitrine de produtos/serviços) ====================
class CatalogItemInput(BaseModel):
    establishment_id: str
    name: str
    description: Optional[str] = ""
    price: float
    discount_percent: Optional[float] = 0
    promo_price: Optional[float] = None
    category: Optional[str] = ""
    addons: Optional[List[dict]] = None
    observations_enabled: Optional[bool] = True
    available: Optional[bool] = True
    featured: Optional[bool] = False
    best_seller: Optional[bool] = False
    photo_url: Optional[str] = None
    active: Optional[bool] = True


def _catalog_fields(p: CatalogItemInput):
    return {
        "name": p.name, "description": p.description or "", "price": round(p.price, 2),
        "discount_percent": max(0, min(100, p.discount_percent or 0)),
        "promo_price": round(p.promo_price, 2) if p.promo_price else None,
        "category": (p.category or "").strip(),
        "addons": [a for a in (p.addons or []) if a.get("name")],
        "observations_enabled": bool(p.observations_enabled),
        "available": bool(p.available),
        "featured": bool(p.featured),
        "best_seller": bool(p.best_seller),
        "photo_url": p.photo_url, "active": bool(p.active),
    }


@router.get("/catalog")
async def list_catalog(establishment_id: str, user=Depends(merchant_only)):
    e = await db.establishments.find_one({"id": establishment_id, "owner_id": user["id"]})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    items = await db.catalog_items.find({"establishment_id": establishment_id}).sort("sort_order", 1).to_list(50)
    return [strip_id(i) for i in items]


@router.post("/catalog")
async def create_catalog(payload: CatalogItemInput, user=Depends(merchant_only)):
    e = await db.establishments.find_one({"id": payload.establishment_id, "owner_id": user["id"]})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    count = await db.catalog_items.count_documents({"establishment_id": payload.establishment_id})
    item = {"id": new_id(), "establishment_id": payload.establishment_id, "owner_id": user["id"],
            **_catalog_fields(payload), "sort_order": count, "created_at": now_iso()}
    await db.catalog_items.insert_one(dict(item))
    return strip_id(item)


@router.put("/catalog/{item_id}")
async def update_catalog(item_id: str, payload: CatalogItemInput, user=Depends(merchant_only)):
    it = await db.catalog_items.find_one({"id": item_id, "owner_id": user["id"]})
    if not it:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    upd = _catalog_fields(payload)
    await db.catalog_items.update_one({"id": item_id}, {"$set": upd})
    return strip_id(await db.catalog_items.find_one({"id": item_id}))


@router.delete("/catalog/{item_id}")
async def delete_catalog(item_id: str, user=Depends(merchant_only)):
    r = await db.catalog_items.delete_one({"id": item_id, "owner_id": user["id"]})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    return {"ok": True}

