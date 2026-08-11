from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import timedelta

from core import (db, require_role, new_id, now_iso, now_utc, strip_id,
                  create_notification, create_audit, get_settings)

router = APIRouter(prefix="/api/merchant", tags=["merchant"])
merchant_only = require_role("merchant")


async def _my_est(user):
    e = await db.establishments.find_one({"owner_id": user["id"]})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    return strip_id(e)


@router.get("/dashboard")
async def dashboard(user=Depends(merchant_only)):
    e = await _my_est(user)
    eid = e["id"]
    txs = await db.transactions.find({"establishment_id": eid}).to_list(5000)
    confirmed = [t for t in txs if t.get("status") == "confirmed"]

    start_month = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    start_day = now_utc().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    revenue = sum(t.get("final_amount", 0) for t in confirmed)
    discounts = sum(t.get("discount_amount", 0) for t in confirmed)
    day_tx = [t for t in confirmed if t.get("confirmed_at", "") >= start_day]
    month_tx = [t for t in confirmed if t.get("confirmed_at", "") >= start_month]

    customers = set(t.get("consumer_id") for t in confirmed)
    # recurring: consumers with >1 confirmed tx
    from collections import Counter
    counts = Counter(t.get("consumer_id") for t in confirmed)
    recurring = sum(1 for c, n in counts.items() if n > 1)

    stories = await db.stories.find({"establishment_id": eid, "status": "active",
                                     "expires_at": {"$gt": now_iso()}}).to_list(100)
    story_views = sum(s.get("views", 0) for s in stories)

    # chart: last 7 days revenue
    chart = []
    for i in range(6, -1, -1):
        day = (now_utc() - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day + timedelta(days=1)
        val = sum(t.get("final_amount", 0) for t in confirmed
                  if day.isoformat() <= t.get("confirmed_at", "") < day_end.isoformat())
        chart.append({"day": day.strftime("%d/%m"), "value": round(val, 2)})

    return {
        "establishment": {"id": eid, "fantasy_name": e.get("fantasy_name"),
                          "approval_status": e.get("approval_status"),
                          "subscription_status": e.get("subscription_status")},
        "revenue": round(revenue, 2),
        "discounts": round(discounts, 2),
        "net": round(revenue, 2),
        "total_customers": len(customers),
        "new_customers": len(customers),
        "recurring_customers": recurring,
        "day_transactions": len(day_tx),
        "month_transactions": len(month_tx),
        "active_stories": len(stories),
        "story_views": story_views,
        "chart": chart,
        "recent": [strip_id(t) for t in sorted(confirmed, key=lambda x: x.get("confirmed_at") or "", reverse=True)[:8]],
    }


@router.get("/pending")
async def pending(user=Depends(merchant_only)):
    e = await _my_est(user)
    items = await db.transactions.find({"establishment_id": e["id"], "status": "awaiting_confirmation"}).sort("created_at", -1).to_list(100)
    return [strip_id(t) for t in items]


@router.get("/transactions")
async def transactions(user=Depends(merchant_only), status: Optional[str] = None):
    e = await _my_est(user)
    q = {"establishment_id": e["id"]}
    if status:
        q["status"] = status
    items = await db.transactions.find(q).sort("created_at", -1).to_list(2000)
    out = []
    for t in items:
        t = strip_id(t)
        # merchant sees minimal consumer data: first name + photo
        name = t.get("consumer_name") or ""
        t["consumer_first_name"] = name.split(" ")[0] if name else ""
        t.pop("consumer_name", None)
        out.append(t)
    return out


@router.post("/transactions/{tx_id}/confirm")
async def confirm(tx_id: str, user=Depends(merchant_only)):
    e = await _my_est(user)
    tx = await db.transactions.find_one({"id": tx_id, "establishment_id": e["id"]})
    if not tx:
        raise HTTPException(status_code=404, detail="Transação não encontrada")
    if tx.get("status") != "awaiting_confirmation":
        raise HTTPException(status_code=400, detail="Transação já processada")
    if tx.get("token_expires_at", "") < now_iso():
        raise HTTPException(status_code=400, detail="Token de validação expirado")

    confirmed_at = now_iso()
    await db.transactions.update_one({"id": tx_id}, {"$set": {
        "status": "confirmed", "confirmed_by": user["id"], "confirmed_at": confirmed_at,
        "validation_token": None,
    }})
    # update consumer totals
    await db.users.update_one({"id": tx["consumer_id"]}, {"$inc": {
        "total_saved": tx.get("saved_amount", 0), "total_spent": tx.get("final_amount", 0),
    }})

    # ticket rule
    settings = await get_settings()
    rule = settings.get("ticket_rule_type")
    tickets_to_add = 0
    if rule == "per_confirmed_purchase":
        tickets_to_add = int(settings.get("ticket_rule_value") or 1)
    elif rule == "per_amount":
        step = float(settings.get("ticket_rule_value") or 50)
        tickets_to_add = int(tx.get("final_amount", 0) // step) if step > 0 else 0
    raffle = await db.raffles.find_one({"status": "active"})
    for _ in range(tickets_to_add):
        await db.tickets.insert_one({
            "id": new_id(), "consumer_id": tx["consumer_id"], "transaction_id": tx_id,
            "campaign": raffle.get("name") if raffle else "Sorteio",
            "number": f"{new_id()[:8].upper()}", "created_at": now_iso(), "status": "valid",
        })
    if tickets_to_add:
        await db.users.update_one({"id": tx["consumer_id"]}, {"$inc": {"ticket_count": tickets_to_add}})

    await create_notification(tx["consumer_id"], "consumer", "purchase_confirmed",
                              "Compra confirmada", f"Você economizou R$ {tx.get('saved_amount', 0):.2f} na {tx.get('establishment_name')}",
                              "/economy")
    if tickets_to_add:
        await create_notification(tx["consumer_id"], "consumer", "new_ticket",
                                  "Novo bilhete!", f"Você ganhou {tickets_to_add} bilhete(s) de sorteio", "/raffles")
    updated = await db.transactions.find_one({"id": tx_id})
    return strip_id(updated)


@router.post("/transactions/{tx_id}/reject")
async def reject(tx_id: str, user=Depends(merchant_only)):
    e = await _my_est(user)
    tx = await db.transactions.find_one({"id": tx_id, "establishment_id": e["id"]})
    if not tx or tx.get("status") != "awaiting_confirmation":
        raise HTTPException(status_code=400, detail="Transação inválida")
    await db.transactions.update_one({"id": tx_id}, {"$set": {"status": "cancelled", "confirmed_by": user["id"]}})
    await create_notification(tx["consumer_id"], "consumer", "purchase_cancelled",
                              "Validação recusada", f"A validação em {tx.get('establishment_name')} foi recusada", "/economy")
    return {"ok": True}


@router.get("/qr")
async def my_qr(user=Depends(merchant_only)):
    e = await _my_est(user)
    return {"qr_token": e.get("qr_token"), "fantasy_name": e.get("fantasy_name"),
            "discount_percent": e.get("discount_percent")}


@router.get("/establishment")
async def get_establishment(user=Depends(merchant_only)):
    e = await _my_est(user)
    return strip_id(e)


class EstUpdate(BaseModel):
    fantasy_name: Optional[str] = None
    description: Optional[str] = None
    category_id: Optional[str] = None
    address: Optional[str] = None
    neighborhood: Optional[str] = None
    city: Optional[str] = None
    hours: Optional[str] = None
    whatsapp: Optional[str] = None
    instagram: Optional[str] = None
    discount_rules: Optional[str] = None
    logo_url: Optional[str] = None
    cover_url: Optional[str] = None
    gallery: Optional[List[str]] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    discount_percent: Optional[float] = None


@router.put("/establishment")
async def update_establishment(payload: EstUpdate, user=Depends(merchant_only)):
    e = await _my_est(user)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    # discount change requires admin approval -> flag pending change
    pending_msg = None
    if "discount_percent" in updates and updates["discount_percent"] != e.get("discount_percent"):
        await db.pending_changes.insert_one({
            "id": new_id(), "establishment_id": e["id"], "field": "discount_percent",
            "old": e.get("discount_percent"), "new": updates["discount_percent"],
            "status": "pending", "created_at": now_iso(),
        })
        admins = await db.users.find({"role": "admin"}).to_list(50)
        for a in admins:
            await create_notification(a["id"], "admin", "discount_change",
                                      "Alteração de desconto", f"{e.get('fantasy_name')} solicitou desconto {updates['discount_percent']}%",
                                      "/admin/establishments")
        pending_msg = "Alteração de desconto enviada para aprovação do administrador."
        updates.pop("discount_percent")
    if "category_id" in updates:
        cat = await db.categories.find_one({"id": updates["category_id"]})
        if cat:
            updates["category_name"] = cat["name"]
    updates["last_activity"] = now_iso()
    await db.establishments.update_one({"id": e["id"]}, {"$set": updates})
    updated = await db.establishments.find_one({"id": e["id"]})
    return {"establishment": strip_id(updated), "message": pending_msg}


@router.get("/stories")
async def list_stories(user=Depends(merchant_only)):
    e = await _my_est(user)
    items = await db.stories.find({"establishment_id": e["id"]}).sort("created_at", -1).to_list(100)
    return [strip_id(s) for s in items]


class StoryInput(BaseModel):
    category: str
    title: str
    text: Optional[str] = ""
    media_url: Optional[str] = None
    media_type: Optional[str] = "image"
    whatsapp_link: Optional[str] = None


@router.post("/stories")
async def create_story(payload: StoryInput, user=Depends(merchant_only)):
    e = await _my_est(user)
    story = {
        "id": new_id(), "establishment_id": e["id"], "establishment_name": e.get("fantasy_name"),
        "category": payload.category, "title": payload.title, "text": payload.text,
        "media_url": payload.media_url, "media_type": payload.media_type,
        "whatsapp_link": payload.whatsapp_link,
        "created_at": now_iso(), "expires_at": (now_utc() + timedelta(hours=24)).isoformat(),
        "status": "active", "views": 0,
    }
    await db.stories.insert_one(dict(story))
    return strip_id(story)


@router.delete("/stories/{sid}")
async def delete_story(sid: str, user=Depends(merchant_only)):
    e = await _my_est(user)
    await db.stories.update_one({"id": sid, "establishment_id": e["id"]}, {"$set": {"status": "removed"}})
    return {"ok": True}


@router.get("/subscription")
async def subscription(user=Depends(merchant_only)):
    settings = await get_settings()
    return {
        "status": user.get("subscription_status"),
        "start": user.get("subscription_start"),
        "next_due": user.get("next_due"),
        "price": settings.get("merchant_plan_price"),
    }
