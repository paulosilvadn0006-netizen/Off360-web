from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import timedelta
from math import radians, sin, cos, asin, sqrt


async def log_interest(user_id, kind, weight=1, category_id=None, establishment_id=None):
    """Registra um sinal de interesse (Fase 1 — base para o feed 'Para Você')."""
    await db.interest_events.insert_one({
        "id": new_id(), "user_id": user_id, "kind": kind, "weight": weight,
        "category_id": category_id, "establishment_id": establishment_id, "at": now_iso(),
    })


def _haversine(lat1, lng1, lat2, lng2):
    try:
        lat1, lng1, lat2, lng2 = map(radians, [float(lat1), float(lng1), float(lat2), float(lng2)])
    except (TypeError, ValueError):
        return None
    dlat, dlng = lat2 - lat1, lng2 - lng1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
    return round(6371 * 2 * asin(sqrt(a)), 2)  # km

from core import (db, require_role, new_id, now_iso, now_utc, strip_id, gen_code,
                  public_user, log_activity, create_notification, get_settings)
from routes_requests import public_buttons
from routes_boosts import sponsored_story_ids, register_view, bump_metric, happening_status

router = APIRouter(prefix="/api/consumer", tags=["consumer"])
consumer_only = require_role("consumer")


def _est_public(e):
    e = strip_id(e)
    return {
        "id": e["id"], "fantasy_name": e.get("fantasy_name"), "category_name": e.get("category_name"),
        "category_id": e.get("category_id"), "description": e.get("description"),
        "logo_url": e.get("logo_url"), "cover_url": e.get("cover_url"), "gallery": e.get("gallery", []),
        "address": e.get("address"), "neighborhood": e.get("neighborhood"), "city": e.get("city"),
        "lat": e.get("lat"), "lng": e.get("lng"), "hours": e.get("hours"),
        "whatsapp": e.get("whatsapp"), "instagram": e.get("instagram"),
        "discount_percent": e.get("discount_percent"), "discount_rules": e.get("discount_rules"),
        "fav_count": e.get("fav_count", 0),
        "rating_avg": round(e.get("rating_sum", 0) / e["rating_count"], 1) if e.get("rating_count") else None,
        "rating_count": e.get("rating_count", 0),
        "action_buttons": public_buttons(e),
    }


async def _active_stories(est_id=None):
    q = {"status": "active", "expires_at": {"$gt": now_iso()}}
    if est_id:
        q["establishment_id"] = est_id
    return await db.stories.find(q).sort("created_at", -1).to_list(200)


@router.get("/home")
async def home(user=Depends(consumer_only)):
    await log_activity(user, "view", "home")
    ests = await db.establishments.find({"approval_status": "approved"}).to_list(200)
    # Feed "Para Você": ordena os orgânicos pelos sinais de interesse já registrados (Fase 1)
    ev = await db.interest_events.aggregate([
        {"$match": {"user_id": user["id"]}},
        {"$group": {"_id": {"e": "$establishment_id", "c": "$category_id"}, "w": {"$sum": "$weight"}}},
    ]).to_list(3000)
    est_score, cat_score = {}, {}
    for r in ev:
        eid, cid = (r["_id"] or {}).get("e"), (r["_id"] or {}).get("c")
        if eid:
            est_score[eid] = est_score.get(eid, 0) + r["w"]
        if cid:
            cat_score[cid] = cat_score.get(cid, 0) + r["w"]

    def _rel(e):
        return est_score.get(e["id"], 0) + cat_score.get(e.get("category_id"), 0)
    personalized = sorted(ests, key=lambda e: (_rel(e), e.get("fav_count", 0), e.get("discount_percent") or 0), reverse=True)
    featured = [_est_public(e) for e in personalized[:6]]
    for_you = bool(ev)
    new_partners = [_est_public(e) for e in sorted(ests, key=lambda x: x.get("created_at", ""), reverse=True)[:6]]
    cats = await db.categories.find({"status": "active"}).sort("order", 1).to_list(100)

    # stories grouped by establishment — patrocinados primeiro (prioridade desc, ativação asc)
    stories = await _active_stories()
    smap = await sponsored_story_ids()
    est_map = {e["id"]: e for e in ests}
    grouped = {}
    for s in stories:
        eid = s["establishment_id"]
        if eid not in est_map:
            continue
        grouped.setdefault(eid, {"establishment": {"id": eid, "fantasy_name": est_map[eid].get("fantasy_name"),
                                                     "logo_url": est_map[eid].get("logo_url"),
                                                     "category_name": est_map[eid].get("category_name"),
                                                     "neighborhood": est_map[eid].get("neighborhood"),
                                                     "whatsapp": est_map[eid].get("whatsapp"),
                                                     "discount_percent": est_map[eid].get("discount_percent"),
                                                     "discount_min_purchase": est_map[eid].get("discount_min_purchase"),
                                                     "discount_max_cap": est_map[eid].get("discount_max_cap"),
                                                     "discount_rules": est_map[eid].get("discount_rules"),
                                                     "action_buttons": public_buttons(est_map[eid])}, "stories": []})
        sd = strip_id(s)
        sd["sponsored"] = s["id"] in smap
        grouped[eid]["stories"].append(sd)

    story_groups = list(grouped.values())
    for g in story_groups:
        sp = [smap[st["id"]] for st in g["stories"] if st["id"] in smap]
        g["sponsored"] = bool(sp)
        g["priority"] = max([b.get("priority") or 0 for b in sp], default=0)
        _hb = None
        for b in sp:
            if not (b.get("happening_date") and b.get("happening_start")):
                continue
            st = happening_status(b)
            if st == "now":
                _hb = b
                break
            if _hb is None:
                _hb = b  # 1º boost com config de acontecimento (cliente calcula o estado ao vivo)
        g["happening"] = happening_status(_hb) if _hb else None
        g["happening_info"] = ({
            "title": _hb.get("happening_title"),
            "date": _hb.get("happening_date"),
            "start": _hb.get("happening_start"),
            "end": _hb.get("happening_end"),
            "region": _hb.get("region") or None,
        } if _hb else None)
        g["_act"] = min([b.get("activated_at") or "" for b in sp], default="")
    story_groups.sort(key=lambda g: (0 if g["sponsored"] else 1, -(g["priority"]), g["_act"] or ""))
    for g in story_groups:
        g.pop("_act", None)

    # month savings
    start_month = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    txs = await db.transactions.find({"consumer_id": user["id"], "status": "confirmed",
                                      "confirmed_at": {"$gte": start_month}}).to_list(1000)
    month_saved = sum(t.get("saved_amount", 0) for t in txs)

    return {
        "greeting_name": (user.get("name") or "").split(" ")[0],
        "photo_url": user.get("photo_url"),
        "neighborhood": user.get("neighborhood") or user.get("city") or "Sua região",
        "subscription": {
            "status": user.get("subscription_status"),
            "next_due": user.get("next_due"),
        },
        "categories": [strip_id(c) for c in cats],
        "stories": story_groups,
        "featured": featured,
        "for_you": for_you,
        "new_partners": new_partners,
        "month_saved": round(month_saved, 2),
        "ticket_count": user.get("ticket_count", 0),
        "total_saved": round(user.get("total_saved", 0), 2),
    }


@router.get("/establishments")
async def catalog(user=Depends(consumer_only), q: Optional[str] = None, category: Optional[str] = None,
                  neighborhood: Optional[str] = None, sort: Optional[str] = "new"):
    query = {"approval_status": "approved", "subscription_status": "active", "discount_configured": True}
    if category:
        query["category_id"] = category
    if neighborhood:
        query["neighborhood"] = {"$regex": neighborhood, "$options": "i"}
    if q:
        query["$or"] = [
            {"fantasy_name": {"$regex": q, "$options": "i"}},
            {"category_name": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
        ]
    ests = await db.establishments.find(query).to_list(300)
    if sort == "discount":
        ests.sort(key=lambda x: x.get("discount_percent", 0), reverse=True)
    else:
        ests.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    favs = user.get("favorites", [])
    out = []
    for e in ests:
        pe = _est_public(e)
        pe["is_favorite"] = e["id"] in favs
        out.append(pe)
    return out


@router.get("/establishments/{est_id}")
async def establishment_detail(est_id: str, user=Depends(consumer_only)):
    e = await db.establishments.find_one({"id": est_id, "approval_status": "approved", "subscription_status": "active", "discount_configured": True})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    pe = _est_public(e)
    pe["is_favorite"] = est_id in user.get("favorites", [])
    r = await db.ratings.find_one({"user_id": user["id"], "establishment_id": est_id})
    pe["my_rating"] = r.get("stars") if r else 0
    pe["stories"] = [strip_id(s) for s in await _active_stories(est_id)]
    await log_interest(user["id"], "visit_establishment", weight=2,
                       category_id=e.get("category_id"), establishment_id=est_id)
    return pe


@router.post("/favorites/{est_id}")
async def toggle_favorite(est_id: str, user=Depends(consumer_only)):
    favs = user.get("favorites", [])
    if est_id in favs:
        favs.remove(est_id)
        fav = False
        await db.establishments.update_one({"id": est_id, "fav_count": {"$gt": 0}}, {"$inc": {"fav_count": -1}})
    else:
        favs.append(est_id)
        fav = True
        e = await db.establishments.find_one({"id": est_id})
        await db.establishments.update_one({"id": est_id}, {"$inc": {"fav_count": 1}})
        await log_interest(user["id"], "favorite", weight=3,
                           category_id=(e or {}).get("category_id"), establishment_id=est_id)
    await db.users.update_one({"id": user["id"]}, {"$set": {"favorites": favs}})
    fc = (await db.establishments.find_one({"id": est_id}) or {}).get("fav_count", 0)
    return {"is_favorite": fav, "fav_count": fc}


class NotifyPref(BaseModel):
    enabled: bool


@router.post("/notify-preference")
async def set_notify_preference(payload: NotifyPref, user=Depends(consumer_only)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"notify_favorites": payload.enabled}})
    return {"notify_favorites": payload.enabled}


class RateInput(BaseModel):
    stars: int


@router.post("/establishments/{est_id}/rate")
async def rate_establishment(est_id: str, payload: RateInput, user=Depends(consumer_only)):
    if payload.stars < 1 or payload.stars > 5:
        raise HTTPException(status_code=400, detail="A nota deve ser de 1 a 5 estrelas.")
    prev = await db.ratings.find_one({"user_id": user["id"], "establishment_id": est_id})
    now = now_iso()
    await db.ratings.update_one(
        {"user_id": user["id"], "establishment_id": est_id},
        {"$set": {"stars": payload.stars, "updated_at": now},
         "$setOnInsert": {"id": new_id(), "user_id": user["id"], "establishment_id": est_id, "created_at": now}},
        upsert=True)
    if prev:
        await db.establishments.update_one({"id": est_id}, {"$inc": {"rating_sum": payload.stars - prev.get("stars", 0)}})
    else:
        await db.establishments.update_one({"id": est_id}, {"$inc": {"rating_sum": payload.stars, "rating_count": 1}})
    e = await db.establishments.find_one({"id": est_id})
    avg = round(e.get("rating_sum", 0) / e["rating_count"], 1) if e.get("rating_count") else None
    return {"my_rating": payload.stars, "rating_avg": avg, "rating_count": e.get("rating_count", 0)}


@router.get("/favorites")
async def list_favorites(user=Depends(consumer_only)):
    favs = user.get("favorites", [])
    if not favs:
        return []
    ests = await db.establishments.find({"id": {"$in": favs}, "approval_status": "approved"}).to_list(200)
    out = []
    for e in ests:
        pe = _est_public(e)
        pe["is_favorite"] = True
        out.append(pe)
    return out


@router.get("/discover")
async def discover(user=Depends(consumer_only), filter: str = "novidades",
                   lat: Optional[float] = None, lng: Optional[float] = None):
    """Filtros de descoberta da Home sobre conteúdo já cadastrado (Fase 1)."""
    ests = await db.establishments.find({"approval_status": "approved", "subscription_status": "active",
                                         "discount_configured": True}).to_list(400)
    now = now_iso()
    start_day = now_utc().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    stories = await db.stories.find({"status": "active", "expires_at": {"$gt": now}}).to_list(500)
    favs = user.get("favorites", [])

    result = ests
    if filter == "ofertas":
        result = sorted(ests, key=lambda x: x.get("discount_percent") or 0, reverse=True)
    elif filter == "novidades":
        recent_story_ids = {s["establishment_id"] for s in stories if s.get("created_at", "") >= start_day}
        result = sorted(ests, key=lambda x: (x["id"] in recent_story_ids, x.get("created_at", "")), reverse=True)
    elif filter == "vagas":
        job_ids = {s["establishment_id"] for s in stories if s.get("category") == "job"}
        result = [e for e in ests if e["id"] in job_ids]
    elif filter == "hoje":
        today_ids = {s["establishment_id"] for s in stories if s.get("created_at", "") >= start_day}
        result = [e for e in ests if e["id"] in today_ids] or ests
    elif filter == "bombando":
        views = {}
        for s in stories:
            views[s["establishment_id"]] = views.get(s["establishment_id"], 0) + (s.get("views") or 0)
        # engajamento coletivo de TODOS os consumidores (interest_events agregado)
        agg = await db.interest_events.aggregate([
            {"$match": {"establishment_id": {"$ne": None}}},
            {"$group": {"_id": "$establishment_id", "score": {"$sum": "$weight"}}},
        ]).to_list(2000)
        interest = {a["_id"]: a["score"] for a in agg}

        def score(e):
            return (e.get("fav_count", 0) * 3) + views.get(e["id"], 0) + interest.get(e["id"], 0)
        result = sorted(ests, key=lambda x: (score(x), x.get("discount_percent") or 0), reverse=True)
    elif filter == "perto":
        if lat is not None and lng is not None:
            def dist(e):
                d = _haversine(lat, lng, e.get("lat"), e.get("lng"))
                return d if d is not None else 1e9
            result = sorted(ests, key=dist)
        else:
            un = (user.get("neighborhood") or "").lower()
            result = sorted(ests, key=lambda x: (x.get("neighborhood", "").lower() != un))

    out = []
    for e in result[:60]:
        pe = _est_public(e)
        pe["is_favorite"] = e["id"] in favs
        if filter == "perto" and lat is not None and lng is not None:
            pe["distance_km"] = _haversine(lat, lng, e.get("lat"), e.get("lng"))
        out.append(pe)
    await log_interest(user["id"], f"filter_{filter}", weight=1)
    return {"filter": filter, "items": out}


@router.post("/stories/{sid}/view")
async def view_story(sid: str, user=Depends(consumer_only)):
    await db.stories.update_one({"id": sid}, {"$inc": {"views": 1}})
    await register_view(sid, user["id"])
    st = await db.stories.find_one({"id": sid})
    if st:
        await log_interest(user["id"], "story_view", weight=1, establishment_id=st.get("establishment_id"))
    return {"ok": True}


class StoryClickInput(BaseModel):
    kind: str  # story | establishment


@router.post("/stories/{sid}/click")
async def click_story(sid: str, payload: StoryClickInput, user=Depends(consumer_only)):
    field = "establishment_clicks" if payload.kind == "establishment" else "story_clicks"
    await bump_metric(sid, field)
    return {"ok": True}


class ScanInput(BaseModel):
    qr_token: str


@router.post("/scan")
async def scan(payload: ScanInput, user=Depends(consumer_only)):
    e = await db.establishments.find_one({"qr_token": payload.qr_token})
    if not e:
        raise HTTPException(status_code=404, detail="QR Code inválido ou não reconhecido.")
    if e.get("approval_status") != "approved":
        raise HTTPException(status_code=400, detail="Este estabelecimento não está ativo na OFF 360 no momento.")
    if user.get("subscription_status") != "active":
        raise HTTPException(status_code=403, detail="Sua assinatura não está ativa. Regularize para utilizar os descontos.")
    if e.get("subscription_status") != "active":
        raise HTTPException(status_code=400, detail="Benefício temporariamente indisponível neste estabelecimento.")
    if not e.get("discount_configured") or not e.get("discount_percent"):
        raise HTTPException(status_code=400, detail="Este estabelecimento ainda não configurou as condições do desconto.")

    def _resp(tx_id):
        return {
            "transaction_id": tx_id,
            "validation_mode": e.get("validation_mode") or "controlled",
            "establishment": {"id": e["id"], "fantasy_name": e.get("fantasy_name"), "logo_url": e.get("logo_url"),
                              "discount_percent": e.get("discount_percent"), "discount_rules": e.get("discount_rules"),
                              "discount_min_purchase": e.get("discount_min_purchase"),
                              "discount_max_cap": e.get("discount_max_cap")},
            "consumer": public_user(user),
        }

    # Reuse an existing non-expired pending session — a re-scan / page refresh must NOT create a duplicate.
    existing = await db.transactions.find_one({
        "consumer_id": user["id"], "establishment_id": e["id"], "status": "pending_validation",
        "token_expires_at": {"$gt": now_utc().isoformat()},
    })
    if existing:
        return _resp(existing["id"])

    # Create a single-use pending validation session (merchant enters the amount later).
    await log_activity(user, "scan", "scanner")
    tx = {
        "id": new_id(),
        "consumer_id": user["id"], "consumer_name": user.get("name"), "consumer_photo": user.get("photo_url"),
        "establishment_id": e["id"], "establishment_name": e.get("fantasy_name"),
        "merchant_owner_id": e.get("owner_id"),
        # discount snapshot — old transactions are never recalculated if the merchant changes it later
        "discount_percent": e.get("discount_percent"),
        "discount_min_purchase": e.get("discount_min_purchase"),
        "discount_max_cap": e.get("discount_max_cap"),
        "discount_rules": e.get("discount_rules"),
        "discount_cumulative": bool(e.get("discount_cumulative")),
        "gross_amount": None, "discount_amount": None, "saved_amount": None, "final_amount": None,
        "created_at": now_iso(), "status": "pending_validation",
        "confirmed_by": None, "confirmed_at": None,
        "transaction_code": gen_code("OFF"),
        "validation_token": new_id(),
        "token_expires_at": (now_utc() + timedelta(minutes=10)).isoformat(),
        "device": "web", "validation_mode": e.get("validation_mode") or "controlled",
    }
    await db.transactions.insert_one(dict(tx))
    await create_notification(e.get("owner_id"), "merchant", "qr_scanned",
                              "Nova validação", f"{user.get('name')} • aguardando valor da compra",
                              "/merchant/validate")
    return _resp(tx["id"])


@router.get("/transactions/{tx_id}")
async def get_transaction(tx_id: str, user=Depends(consumer_only)):
    tx = await db.transactions.find_one({"id": tx_id, "consumer_id": user["id"]})
    if not tx:
        raise HTTPException(status_code=404, detail="Transação não encontrada")
    return strip_id(tx)


class FastConfirmInput(BaseModel):
    gross_amount: float


@router.post("/transactions/{tx_id}/fast-confirm")
async def fast_confirm(tx_id: str, payload: FastConfirmInput, user=Depends(consumer_only)):
    """Modo rápido: o próprio consumidor informa o valor; a transação é registrada automaticamente."""
    tx = await db.transactions.find_one({"id": tx_id, "consumer_id": user["id"]})
    if not tx:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    if (tx.get("validation_mode") or "controlled") != "fast":
        raise HTTPException(status_code=400, detail="Este estabelecimento utiliza validação controlada.")
    if tx.get("status") == "confirmed":
        return strip_id(tx)  # idempotente — não gera outra transação
    if tx.get("status") != "pending_validation":
        raise HTTPException(status_code=400, detail="Sessão inválida.")
    if tx.get("token_expires_at", "") < now_iso():
        raise HTTPException(status_code=400, detail="Sessão expirada. Escaneie o QR Code novamente.")
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
        "status": "confirmed", "confirmed_by": None, "confirmed_at": confirmed_at, "validation_token": None,
        "origin": "fast_mode",
    }})
    await db.users.update_one({"id": user["id"]}, {"$inc": {"total_saved": discount, "total_spent": final}})
    await log_interest(user["id"], "use_discount", weight=5,
                       category_id=tx.get("category_id"), establishment_id=tx.get("establishment_id"))
    settings = await get_settings()
    rule = settings.get("ticket_rule_type")
    tickets_to_add = int(settings.get("ticket_rule_value") or 1) if rule == "per_confirmed_purchase" else (
        int(final // float(settings.get("ticket_rule_value") or 50)) if rule == "per_amount" else 0)
    for _ in range(tickets_to_add):
        await db.tickets.insert_one({"id": new_id(), "consumer_id": user["id"], "transaction_id": tx_id,
                                     "campaign": "Sorteio", "number": f"{new_id()[:8].upper()}",
                                     "created_at": now_iso(), "status": "valid"})
    if tickets_to_add:
        await db.users.update_one({"id": user["id"]}, {"$inc": {"ticket_count": tickets_to_add}})
    await create_notification(tx.get("merchant_owner_id"), "merchant", "purchase_confirmed",
                              "Venda registrada (Modo rápido)",
                              f"{user.get('name')} • R$ {final:.2f} • economia R$ {discount:.2f}",
                              "/merchant/transactions")
    updated = await db.transactions.find_one({"id": tx_id})
    return strip_id(updated)


@router.get("/economy")
async def economy(user=Depends(consumer_only), period: Optional[str] = None, establishment: Optional[str] = None,
                  category: Optional[str] = None, status: Optional[str] = None):
    query = {"consumer_id": user["id"]}
    txs = await db.transactions.find(query).sort("created_at", -1).to_list(2000)
    confirmed = [t for t in txs if t.get("status") == "confirmed"]

    start_month = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    start_day = now_utc().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    month_saved = sum(t.get("saved_amount", 0) for t in confirmed if t.get("confirmed_at", "") >= start_month)
    total_saved = sum(t.get("saved_amount", 0) for t in confirmed)
    day_spent = sum(t.get("final_amount", 0) for t in confirmed if t.get("confirmed_at", "") >= start_day)
    month_spent = sum(t.get("final_amount", 0) for t in confirmed if t.get("confirmed_at", "") >= start_month)

    # filters for history
    hist = txs
    if status:
        hist = [t for t in hist if t.get("status") == status]
    if establishment:
        hist = [t for t in hist if t.get("establishment_id") == establishment]

    settings = await get_settings()
    return {
        "month_saved": round(month_saved, 2),
        "total_saved": round(total_saved, 2),
        "day_spent": round(day_spent, 2),
        "month_spent": round(month_spent, 2),
        "total_purchases": len(confirmed),
        "benefits_used": len(confirmed),
        "ticket_count": user.get("ticket_count", 0),
        "subscription_price": settings.get("consumer_plan_price"),
        "history": [strip_id(t) for t in hist],
    }


@router.get("/tickets")
async def tickets(user=Depends(consumer_only)):
    items = await db.tickets.find({"consumer_id": user["id"]}).sort("created_at", -1).to_list(500)
    return [strip_id(t) for t in items]


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    photo_url: Optional[str] = None
    city: Optional[str] = None
    neighborhood: Optional[str] = None


@router.put("/profile")
async def update_profile(payload: ProfileUpdate, user=Depends(consumer_only)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    updated = await db.users.find_one({"id": user["id"]})
    return strip_id(updated)


