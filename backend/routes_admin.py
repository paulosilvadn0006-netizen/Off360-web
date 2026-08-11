from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import timedelta

from core import (db, require_role, new_id, now_iso, now_utc, strip_id,
                  create_notification, create_audit, get_settings)

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_only = require_role("admin")


@router.get("/overview")
async def overview(user=Depends(admin_only)):
    consumers = await db.users.find({"role": "consumer"}).to_list(20000)
    merchants = await db.users.find({"role": "merchant"}).to_list(20000)
    ests = await db.establishments.find({}).to_list(20000)
    txs = await db.transactions.find({}).to_list(50000)
    confirmed = [t for t in txs if t.get("status") == "confirmed"]

    start_month = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    start_day = now_utc().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week_ago = (now_utc() - timedelta(days=7)).isoformat()
    online_cut = (now_utc() - timedelta(minutes=5)).isoformat()

    def active_since(users, since):
        return sum(1 for u in users if (u.get("last_activity") or "") >= since)

    buyers = set(t.get("consumer_id") for t in confirmed)
    receiving_merchants = set(t.get("merchant_owner_id") for t in confirmed)
    active_est = [e for e in ests if e.get("subscription_status") == "active"]
    merchants_with_active = set(e.get("owner_id") for e in active_est)

    return {
        "total_users": len(consumers) + len(merchants),
        "total_consumers": len(consumers),
        "total_merchants": len(merchants),
        "total_establishments": len(ests),
        "active_subscription_consumers": sum(1 for c in consumers if c.get("subscription_status") == "active"),
        "inactive_consumers": sum(1 for c in consumers if c.get("subscription_status") in ("inactive", "cancelled", "expired")),
        "overdue_consumers": sum(1 for c in consumers if c.get("subscription_status") in ("pending", "expired")),
        "new_consumers_month": sum(1 for c in consumers if (c.get("created_at") or "") >= start_month),
        "active_merchants": len(merchants_with_active),
        "inactive_merchants": len(merchants) - len(merchants_with_active),
        "active_establishments": len(active_est),
        "pending_establishments": sum(1 for e in ests if e.get("subscription_status") == "pending" or e.get("approval_status") == "pending"),
        "suspended_establishments": sum(1 for e in ests if e.get("subscription_status") in ("suspended", "expired", "inactive")),
        "online_now": active_since(consumers + merchants, online_cut),
        "active_today": active_since(consumers + merchants, start_day),
        "active_week": active_since(consumers + merchants, week_ago),
        "active_month": active_since(consumers + merchants, start_month),
        "buying_consumers": len(buyers),
        "receiving_merchants": len(receiving_merchants),
        "total_transactions": len(confirmed),
        "financial_volume": round(sum(t.get("gross_amount", 0) for t in confirmed), 2),
        "total_discounts": round(sum(t.get("discount_amount", 0) for t in confirmed), 2),
        "total_saved": round(sum(t.get("saved_amount", 0) for t in confirmed), 2),
    }


@router.get("/consumers")
async def consumers(user=Depends(admin_only), q: Optional[str] = None, status: Optional[str] = None):
    query = {"role": "consumer"}
    if status:
        query["subscription_status"] = status
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"email": {"$regex": q, "$options": "i"}}]
    items = await db.users.find(query).sort("created_at", -1).to_list(2000)
    return [strip_id(i) for i in items]


@router.get("/consumers/{cid}")
async def consumer_detail(cid: str, user=Depends(admin_only)):
    c = await db.users.find_one({"id": cid, "role": "consumer"})
    if not c:
        raise HTTPException(status_code=404, detail="Não encontrado")
    txs = await db.transactions.find({"consumer_id": cid}).sort("created_at", -1).to_list(500)
    tickets = await db.tickets.find({"consumer_id": cid}).to_list(500)
    return {"consumer": strip_id(c), "transactions": [strip_id(t) for t in txs], "tickets_count": len(tickets)}


class ConsumerUpdate(BaseModel):
    account_status: Optional[str] = None
    subscription_status: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    note: Optional[str] = None


@router.put("/consumers/{cid}")
async def update_consumer(cid: str, payload: ConsumerUpdate, user=Depends(admin_only)):
    c = await db.users.find_one({"id": cid, "role": "consumer"})
    if not c:
        raise HTTPException(status_code=404, detail="Não encontrado")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    before = {k: c.get(k) for k in updates}
    if "subscription_status" in updates and updates["subscription_status"] == "active" and not c.get("subscription_start"):
        updates["subscription_start"] = now_iso()
        updates["next_due"] = (now_utc() + timedelta(days=30)).isoformat()
    await db.users.update_one({"id": cid}, {"$set": updates})
    await create_audit(user, "update_consumer", cid, before, updates)
    if "subscription_status" in updates:
        await create_notification(cid, "consumer", "subscription",
                                  "Assinatura atualizada", f"Status: {updates['subscription_status']}", "/profile")
    updated = await db.users.find_one({"id": cid})
    return strip_id(updated)


@router.post("/consumers/{cid}/activate")
async def activate_consumer(cid: str, user=Depends(admin_only)):
    c = await db.users.find_one({"id": cid, "role": "consumer"})
    if not c:
        raise HTTPException(status_code=404, detail="Não encontrado")
    before = {"account_status": c.get("account_status"), "subscription_status": c.get("subscription_status")}
    updates = {
        "account_status": "active", "subscription_status": "active",
        "subscription_start": now_iso(), "next_due": (now_utc() + timedelta(days=30)).isoformat(),
    }
    await db.users.update_one({"id": cid}, {"$set": updates})
    await create_audit(user, "activate_consumer", cid, before, updates)
    await create_notification(cid, "consumer", "subscription", "Assinatura ativada",
                              "Sua assinatura foi ativada. Descontos e scanner liberados!", "/home")
    updated = await db.users.find_one({"id": cid})
    return strip_id(updated)


@router.post("/consumers/{cid}/suspend")
async def suspend_consumer(cid: str, user=Depends(admin_only)):
    c = await db.users.find_one({"id": cid, "role": "consumer"})
    if not c:
        raise HTTPException(status_code=404, detail="Não encontrado")
    before = {"account_status": c.get("account_status"), "subscription_status": c.get("subscription_status")}
    updates = {"account_status": "suspended", "subscription_status": "suspended"}
    await db.users.update_one({"id": cid}, {"$set": updates})
    await create_audit(user, "suspend_consumer", cid, before, updates)
    await create_notification(cid, "consumer", "subscription", "Assinatura suspensa",
                              "Sua assinatura foi suspensa. Regularize para voltar a usar os descontos.", "/profile")
    updated = await db.users.find_one({"id": cid})
    return strip_id(updated)


@router.post("/merchants/{mid}/activate")
async def activate_merchant(mid: str, user=Depends(admin_only)):
    m = await db.users.find_one({"id": mid, "role": "merchant"})
    if not m:
        raise HTTPException(status_code=404, detail="Não encontrado")
    before = {"account_status": m.get("account_status")}
    await db.users.update_one({"id": mid}, {"$set": {"account_status": "active"}})
    await create_audit(user, "activate_merchant", mid, before, {"account_status": "active"})
    await create_notification(mid, "merchant", "account_status", "Conta empresarial ativada",
                              "Sua conta empresarial foi ativada.", "/merchant")
    updated = await db.users.find_one({"id": mid})
    return strip_id(updated)


@router.post("/merchants/{mid}/suspend")
async def suspend_merchant(mid: str, user=Depends(admin_only)):
    m = await db.users.find_one({"id": mid, "role": "merchant"})
    if not m:
        raise HTTPException(status_code=404, detail="Não encontrado")
    before = {"account_status": m.get("account_status")}
    await db.users.update_one({"id": mid}, {"$set": {"account_status": "suspended"}})
    await create_audit(user, "suspend_merchant", mid, before, {"account_status": "suspended"})
    await create_notification(mid, "merchant", "account_status", "Conta empresarial suspensa",
                              "Sua conta empresarial foi suspensa. Contate o suporte.", "/merchant")
    updated = await db.users.find_one({"id": mid})
    return strip_id(updated)


@router.get("/merchants")
async def merchants(user=Depends(admin_only), q: Optional[str] = None):
    ms = await db.users.find({"role": "merchant"}).sort("created_at", -1).to_list(2000)
    settings = await get_settings()
    mprice = settings.get("merchant_plan_price")
    out = []
    for m in ms:
        ests = await db.establishments.find({"owner_id": m["id"]}).to_list(50)
        active = [e for e in ests if e.get("subscription_status") == "active"]
        item = strip_id(m)
        item["establishment_count"] = len(ests)
        item["active_count"] = len(active)
        item["monthly_total"] = None if mprice is None else round(len(active) * mprice, 2)
        if q and q.lower() not in (item.get("name") or "").lower() and q.lower() not in (item.get("email") or "").lower():
            continue
        out.append(item)
    return out


@router.get("/establishments")
async def establishments(user=Depends(admin_only), status: Optional[str] = None):
    q = {}
    if status:
        q["approval_status"] = status
    items = await db.establishments.find(q).sort("created_at", -1).to_list(2000)
    return [strip_id(e) for e in items]


class ApproveInput(BaseModel):
    approval_status: str  # approved | rejected | pending


@router.post("/establishments/{eid}/approve")
async def approve_establishment(eid: str, payload: ApproveInput, user=Depends(admin_only)):
    e = await db.establishments.find_one({"id": eid})
    if not e:
        raise HTTPException(status_code=404, detail="Não encontrado")
    await db.establishments.update_one({"id": eid}, {"$set": {"approval_status": payload.approval_status}})
    await create_audit(user, "approve_establishment", eid, {"approval_status": e.get("approval_status")}, {"approval_status": payload.approval_status})
    await create_notification(e.get("owner_id"), "merchant", "establishment_status",
                              "Status do estabelecimento", f"Seu estabelecimento foi {payload.approval_status}", "/merchant")
    return {"ok": True}


class EstAdminUpdate(BaseModel):
    discount_percent: Optional[float] = None
    subscription_status: Optional[str] = None
    approval_status: Optional[str] = None


@router.put("/establishments/{eid}")
async def admin_update_establishment(eid: str, payload: EstAdminUpdate, user=Depends(admin_only)):
    e = await db.establishments.find_one({"id": eid})
    if not e:
        raise HTTPException(status_code=404, detail="Não encontrado")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    before = {k: e.get(k) for k in updates}
    await db.establishments.update_one({"id": eid}, {"$set": updates})
    await create_audit(user, "update_establishment", eid, before, updates)
    updated = await db.establishments.find_one({"id": eid})
    return strip_id(updated)


@router.post("/establishments/{eid}/activate")
async def activate_establishment(eid: str, user=Depends(admin_only)):
    e = await db.establishments.find_one({"id": eid})
    if not e:
        raise HTTPException(status_code=404, detail="Não encontrado")
    before = {"approval_status": e.get("approval_status"), "subscription_status": e.get("subscription_status")}
    updates = {
        "approval_status": "approved", "subscription_status": "active",
        "subscription_start": e.get("subscription_start") or now_iso(),
        "next_due": (now_utc() + timedelta(days=30)).isoformat(),
    }
    await db.establishments.update_one({"id": eid}, {"$set": updates})
    await create_audit(user, "activate_establishment", eid, before, updates)
    await create_notification(e.get("owner_id"), "merchant", "establishment_status", "Estabelecimento ativado",
                              f"{e.get('fantasy_name')} foi ativado. " + ("Configure o desconto para liberar o QR Code." if not e.get("discount_configured") else "QR Code liberado."),
                              "/merchant")
    updated = await db.establishments.find_one({"id": eid})
    return strip_id(updated)


@router.post("/establishments/{eid}/suspend")
async def suspend_establishment(eid: str, user=Depends(admin_only)):
    e = await db.establishments.find_one({"id": eid})
    if not e:
        raise HTTPException(status_code=404, detail="Não encontrado")
    before = {"subscription_status": e.get("subscription_status")}
    await db.establishments.update_one({"id": eid}, {"$set": {"subscription_status": "suspended"}})
    await create_audit(user, "suspend_establishment", eid, before, {"subscription_status": "suspended"})
    await create_notification(e.get("owner_id"), "merchant", "establishment_status", "Estabelecimento suspenso",
                              f"{e.get('fantasy_name')} foi suspenso.", "/merchant")
    return {"ok": True}


@router.post("/establishments/{eid}/regenerate-qr")
async def regenerate_qr(eid: str, user=Depends(admin_only)):
    await db.establishments.update_one({"id": eid}, {"$set": {"qr_token": new_id()}})
    await create_audit(user, "regenerate_qr", eid, {}, {})
    return {"ok": True}


@router.get("/transactions")
async def transactions(user=Depends(admin_only), status: Optional[str] = None):
    q = {}
    if status:
        q["status"] = status
    items = await db.transactions.find(q).sort("created_at", -1).to_list(3000)
    return [strip_id(t) for t in items]


@router.post("/transactions/{tx_id}/cancel")
async def cancel_transaction(tx_id: str, user=Depends(admin_only)):
    tx = await db.transactions.find_one({"id": tx_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Não encontrado")
    await db.transactions.update_one({"id": tx_id}, {"$set": {"status": "cancelled"}})
    await create_audit(user, "cancel_transaction", tx_id, {"status": tx.get("status")}, {"status": "cancelled"})
    return {"ok": True}


@router.get("/subscriptions")
async def subscriptions(user=Depends(admin_only), type: Optional[str] = None, status: Optional[str] = None,
                        q: Optional[str] = None, merchant_id: Optional[str] = None):
    settings = await get_settings()
    cprice = settings.get("consumer_plan_price")
    mprice = settings.get("merchant_plan_price")
    rows = []

    if type in (None, "consumer"):
        consumers = await db.users.find({"role": "consumer"}).to_list(5000)
        for c in consumers:
            rows.append({
                "id": c["id"], "kind": "consumer", "subscriber_name": c.get("name"),
                "merchant_name": None, "establishment_name": None, "establishment_id": None,
                "email": c.get("email"), "whatsapp": c.get("phone"),
                "status": c.get("subscription_status"), "start": c.get("subscription_start"),
                "next_due": c.get("next_due"), "value": cprice, "payment_method": c.get("payment_method"),
            })

    if type in (None, "establishment"):
        ests = await db.establishments.find({}).to_list(5000)
        owners = {}
        for e in ests:
            oid = e.get("owner_id")
            if oid not in owners:
                m = await db.users.find_one({"id": oid})
                owners[oid] = m
            m = owners.get(oid) or {}
            if merchant_id and oid != merchant_id:
                continue
            rows.append({
                "id": e["id"], "kind": "establishment", "subscriber_name": e.get("fantasy_name"),
                "merchant_name": m.get("name"), "establishment_name": e.get("fantasy_name"), "establishment_id": e["id"],
                "email": m.get("email"), "whatsapp": e.get("whatsapp") or m.get("phone"),
                "status": e.get("subscription_status"), "start": e.get("subscription_start"),
                "next_due": e.get("next_due"), "value": mprice, "payment_method": e.get("payment_method"),
            })

    if status:
        rows = [r for r in rows if r["status"] == status]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in (r.get("subscriber_name") or "").lower() or ql in (r.get("email") or "").lower() or ql in (r.get("merchant_name") or "").lower()]

    return {
        "rows": rows, "total": len(rows), "prices_configured": bool(cprice is not None and mprice is not None),
    }


@router.get("/financial")
async def financial(user=Depends(admin_only)):
    settings = await get_settings()
    consumers = await db.users.find({"role": "consumer"}).to_list(5000)
    ests = await db.establishments.find({}).to_list(5000)
    cprice = settings.get("consumer_plan_price") or 0
    mprice = settings.get("merchant_plan_price") or 0
    active_c = sum(1 for c in consumers if c.get("subscription_status") == "active")
    active_e = sum(1 for e in ests if e.get("subscription_status") == "active")
    c_rev = active_c * cprice
    m_rev = active_e * mprice
    all_subs = consumers + ests
    return {
        "consumer_revenue": round(c_rev, 2),
        "merchant_revenue": round(m_rev, 2),
        "total_revenue": round(c_rev + m_rev, 2),
        "mrr": round(c_rev + m_rev, 2),
        "active_consumer_subs": active_c,
        "active_merchant_subs": active_e,
        "pending_subs": sum(1 for u in all_subs if u.get("subscription_status") == "pending"),
        "expired_subs": sum(1 for u in all_subs if u.get("subscription_status") in ("expired", "suspended")),
        "cancelled_subs": sum(1 for u in all_subs if u.get("subscription_status") == "cancelled"),
        "consumer_price": cprice, "merchant_price": mprice,
        "prices_configured": bool(settings.get("consumer_plan_price") and settings.get("merchant_plan_price")),
    }


# ---- Categories ----
class CategoryInput(BaseModel):
    name: str
    icon: Optional[str] = "Store"
    image_url: Optional[str] = None
    order: Optional[int] = 0
    status: Optional[str] = "active"


@router.get("/categories")
async def admin_categories(user=Depends(admin_only)):
    items = await db.categories.find({}).sort("order", 1).to_list(200)
    return [strip_id(c) for c in items]


@router.post("/categories")
async def create_category(payload: CategoryInput, user=Depends(admin_only)):
    cat = {"id": new_id(), **payload.model_dump()}
    await db.categories.insert_one(dict(cat))
    return strip_id(cat)


@router.put("/categories/{cid}")
async def update_category(cid: str, payload: CategoryInput, user=Depends(admin_only)):
    await db.categories.update_one({"id": cid}, {"$set": payload.model_dump()})
    updated = await db.categories.find_one({"id": cid})
    return strip_id(updated)


# ---- Raffles ----
class RaffleInput(BaseModel):
    name: str
    prize: str
    draw_date: str
    rules: Optional[str] = ""
    status: Optional[str] = "active"


@router.get("/raffles")
async def admin_raffles(user=Depends(admin_only)):
    items = await db.raffles.find({}).sort("created_at", -1).to_list(100)
    return [strip_id(r) for r in items]


@router.post("/raffles")
async def create_raffle(payload: RaffleInput, user=Depends(admin_only)):
    if payload.status == "active":
        await db.raffles.update_many({"status": "active"}, {"$set": {"status": "finished"}})
    r = {"id": new_id(), **payload.model_dump(), "created_at": now_iso(), "winner": None}
    await db.raffles.insert_one(dict(r))
    await create_audit(user, "create_raffle", r["id"], {}, {"name": payload.name})
    return strip_id(r)


@router.put("/raffles/{rid}")
async def update_raffle(rid: str, payload: RaffleInput, user=Depends(admin_only)):
    await db.raffles.update_one({"id": rid}, {"$set": payload.model_dump()})
    updated = await db.raffles.find_one({"id": rid})
    return strip_id(updated)


# ---- Settings ----
class SettingsInput(BaseModel):
    consumer_plan_price: Optional[float] = None
    merchant_plan_price: Optional[float] = None
    ticket_rule_type: Optional[str] = None
    ticket_rule_value: Optional[float] = None
    promo_period: Optional[str] = None
    coupon: Optional[str] = None


@router.get("/settings")
async def get_admin_settings(user=Depends(admin_only)):
    return await get_settings()


@router.put("/settings")
async def update_settings(payload: SettingsInput, user=Depends(admin_only)):
    before = await get_settings()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    await db.settings.update_one({"id": "global"}, {"$set": updates}, upsert=True)
    await create_audit(user, "update_settings", "global", before, updates)
    return await get_settings()


@router.get("/audit")
async def audit(user=Depends(admin_only)):
    items = await db.audit_logs.find({}).sort("created_at", -1).to_list(500)
    return [strip_id(i) for i in items]


@router.get("/stories")
async def admin_stories(user=Depends(admin_only)):
    items = await db.stories.find({}).sort("created_at", -1).to_list(500)
    return [strip_id(s) for s in items]


@router.delete("/stories/{sid}")
async def moderate_story(sid: str, user=Depends(admin_only)):
    await db.stories.update_one({"id": sid}, {"$set": {"status": "removed"}})
    await create_audit(user, "moderate_story", sid, {}, {"status": "removed"})
    return {"ok": True}


@router.get("/reports/{report_type}")
async def reports(report_type: str, user=Depends(admin_only)):
    if report_type == "consumers":
        data = await db.users.find({"role": "consumer"}).to_list(5000)
    elif report_type == "merchants":
        data = await db.establishments.find({}).to_list(5000)
    elif report_type == "transactions":
        data = await db.transactions.find({}).to_list(5000)
    else:
        data = []
    return {"type": report_type, "count": len(data), "rows": [strip_id(d) for d in data]}
