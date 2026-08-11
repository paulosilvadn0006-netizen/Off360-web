from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import timedelta

from core import (db, require_role, new_id, now_iso, now_utc, strip_id, gen_code,
                  public_user, log_activity, create_notification, get_settings)

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
    featured = [_est_public(e) for e in ests[:6]]
    new_partners = [_est_public(e) for e in sorted(ests, key=lambda x: x.get("created_at", ""), reverse=True)[:6]]
    cats = await db.categories.find({"status": "active"}).sort("order", 1).to_list(100)

    # stories grouped by establishment
    stories = await _active_stories()
    est_map = {e["id"]: e for e in ests}
    grouped = {}
    for s in stories:
        eid = s["establishment_id"]
        if eid not in est_map:
            continue
        grouped.setdefault(eid, {"establishment": {"id": eid, "fantasy_name": est_map[eid].get("fantasy_name"),
                                                     "logo_url": est_map[eid].get("logo_url")}, "stories": []})
        grouped[eid]["stories"].append(strip_id(s))

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
        "stories": list(grouped.values()),
        "featured": featured,
        "new_partners": new_partners,
        "month_saved": round(month_saved, 2),
        "ticket_count": user.get("ticket_count", 0),
        "total_saved": round(user.get("total_saved", 0), 2),
    }


@router.get("/establishments")
async def catalog(user=Depends(consumer_only), q: Optional[str] = None, category: Optional[str] = None,
                  neighborhood: Optional[str] = None, sort: Optional[str] = "new"):
    query = {"approval_status": "approved"}
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
    e = await db.establishments.find_one({"id": est_id, "approval_status": "approved"})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    pe = _est_public(e)
    pe["is_favorite"] = est_id in user.get("favorites", [])
    pe["stories"] = [strip_id(s) for s in await _active_stories(est_id)]
    return pe


@router.post("/favorites/{est_id}")
async def toggle_favorite(est_id: str, user=Depends(consumer_only)):
    favs = user.get("favorites", [])
    if est_id in favs:
        favs.remove(est_id)
        fav = False
    else:
        favs.append(est_id)
        fav = True
    await db.users.update_one({"id": user["id"]}, {"$set": {"favorites": favs}})
    return {"is_favorite": fav}


@router.post("/stories/{sid}/view")
async def view_story(sid: str, user=Depends(consumer_only)):
    await db.stories.update_one({"id": sid}, {"$inc": {"views": 1}})
    return {"ok": True}


class ScanInput(BaseModel):
    qr_token: str


@router.post("/scan")
async def scan(payload: ScanInput, user=Depends(consumer_only)):
    e = await db.establishments.find_one({"qr_token": payload.qr_token})
    if not e:
        raise HTTPException(status_code=404, detail="QR Code inválido")
    if e.get("approval_status") != "approved":
        raise HTTPException(status_code=400, detail="Estabelecimento não está ativo")
    if user.get("subscription_status") != "active":
        raise HTTPException(status_code=403, detail="Sua assinatura não está ativa. Regularize para usar os descontos.")
    await log_activity(user, "scan", "scanner")
    return {
        "establishment": {"id": e["id"], "fantasy_name": e.get("fantasy_name"), "logo_url": e.get("logo_url"),
                          "discount_percent": e.get("discount_percent"), "discount_rules": e.get("discount_rules")},
        "consumer": public_user(user),
    }


class CreateTxInput(BaseModel):
    establishment_id: str
    gross_amount: float


@router.post("/transactions")
async def create_transaction(payload: CreateTxInput, user=Depends(consumer_only)):
    if user.get("subscription_status") != "active":
        raise HTTPException(status_code=403, detail="Assinatura inativa")
    e = await db.establishments.find_one({"id": payload.establishment_id, "approval_status": "approved"})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento inválido")
    if payload.gross_amount <= 0:
        raise HTTPException(status_code=400, detail="Valor inválido")

    # prevent duplicate pending for same consumer+establishment+amount
    dup = await db.transactions.find_one({
        "consumer_id": user["id"], "establishment_id": e["id"],
        "gross_amount": payload.gross_amount, "status": "awaiting_confirmation",
    })
    if dup:
        return strip_id(dup)

    pct = e.get("discount_percent", 0)
    discount = round(payload.gross_amount * pct / 100, 2)
    final = round(payload.gross_amount - discount, 2)
    tx = {
        "id": new_id(),
        "consumer_id": user["id"],
        "consumer_name": user.get("name"),
        "consumer_photo": user.get("photo_url"),
        "establishment_id": e["id"],
        "establishment_name": e.get("fantasy_name"),
        "merchant_owner_id": e.get("owner_id"),
        "gross_amount": payload.gross_amount,
        "discount_percent": pct,
        "discount_amount": discount,
        "saved_amount": discount,
        "final_amount": final,
        "created_at": now_iso(),
        "status": "awaiting_confirmation",
        "confirmed_by": None,
        "confirmed_at": None,
        "transaction_code": gen_code("OFF"),
        "validation_token": new_id(),
        "token_expires_at": (now_utc() + timedelta(minutes=10)).isoformat(),
        "device": "web",
    }
    await db.transactions.insert_one(dict(tx))
    await create_notification(e.get("owner_id"), "merchant", "qr_scanned",
                              "Nova validação", f"{user.get('name')} • R$ {payload.gross_amount:.2f}",
                              "/merchant/validate")
    return strip_id(tx)


@router.get("/transactions/{tx_id}")
async def get_transaction(tx_id: str, user=Depends(consumer_only)):
    tx = await db.transactions.find_one({"id": tx_id, "consumer_id": user["id"]})
    if not tx:
        raise HTTPException(status_code=404, detail="Transação não encontrada")
    return strip_id(tx)


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
