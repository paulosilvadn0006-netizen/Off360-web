"""Destaque OFF 360 — Stories patrocinados (Fase B). Período gratuito, sem cobrança."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import timedelta

from core import (db, require_role, new_id, now_iso, now_utc, strip_id,
                  create_notification, create_audit)
from moderation import moderate_content

router = APIRouter(prefix="/api", tags=["boosts"])
merchant_only = require_role("merchant")
admin_only = require_role("admin")

BOOST_ACTIVE_LOCKS = {"awaiting", "approved", "active", "paused"}
PRICE_LABEL = "Valor a definir pela administração."


def _empty_metrics():
    return {"views": 0, "unique_viewers": 0, "story_clicks": 0, "establishment_clicks": 0,
            "whatsapp_clicks": 0, "button_clicks": 0, "requests_from_story": 0}


def _pub(b):
    return strip_id(b)


# ---------------- Helpers de exibição/métricas (usados pelo consumer) ----------------
async def sponsored_story_ids():
    """Mapa story_id -> boost ATIVO e válido. Encerra automaticamente os expirados."""
    now = now_iso()
    boosts = await db.boosts.find({"status": "active"}).to_list(1000)
    out = {}
    for b in boosts:
        if b.get("period_end") and b["period_end"] < now:
            await db.boosts.update_one({"id": b["id"]}, {"$set": {"status": "ended", "updated_at": now_iso()},
                                                          "$push": {"status_history": {"status": "ended", "at": now_iso(), "by": "system", "note": "Expirado"}}})
            continue
        if b.get("period_start") and b["period_start"] > now:
            continue
        s = await db.stories.find_one({"id": b["story_id"]})
        if not s or s.get("status") != "active" or s.get("expires_at", "") < now:
            continue
        e = await db.establishments.find_one({"id": b["establishment_id"]})
        if not e or e.get("subscription_status") != "active" or e.get("approval_status") != "approved":
            continue
        out[b["story_id"]] = b
    return out


async def active_boost_for_story(sid):
    b = await db.boosts.find_one({"story_id": sid, "status": "active"})
    if not b:
        return None
    now = now_iso()
    if b.get("period_end") and b["period_end"] < now:
        await db.boosts.update_one({"id": b["id"]}, {"$set": {"status": "ended", "updated_at": now_iso()}})
        return None
    if b.get("period_start") and b["period_start"] > now:
        return None
    return b


async def register_view(sid, consumer_id):
    b = await active_boost_for_story(sid)
    if not b:
        return
    # proteção básica: ignora reaberturas do mesmo consumidor em < 10s
    cutoff = (now_utc() - timedelta(seconds=10)).isoformat()
    recent = await db.boost_view_events.find_one({"boost_id": b["id"], "consumer_id": consumer_id, "at": {"$gt": cutoff}})
    if recent:
        return
    await db.boost_view_events.insert_one({"id": new_id(), "boost_id": b["id"], "consumer_id": consumer_id, "at": now_iso()})
    upd = {"$inc": {"metrics.views": 1}}
    if consumer_id not in (b.get("viewer_ids") or []):
        upd["$addToSet"] = {"viewer_ids": consumer_id}
        upd["$inc"]["metrics.unique_viewers"] = 1
    await db.boosts.update_one({"id": b["id"]}, upd)


async def bump_metric(sid, field):
    b = await active_boost_for_story(sid)
    if not b:
        return
    await db.boosts.update_one({"id": b["id"]}, {"$inc": {f"metrics.{field}": 1, "metrics.story_clicks": 1}})


# ---------------- Empresário ----------------
class NewBoost(BaseModel):
    establishment_id: str
    story_id: str
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    region: Optional[str] = ""
    category: Optional[str] = ""
    notes: Optional[str] = ""
    happening_title: Optional[str] = None
    happening_date: Optional[str] = None
    happening_start: Optional[str] = None
    happening_end: Optional[str] = None


def happening_status(b):
    """Retorna 'now', 'soon' ou None conforme data/horários (America/Sao_Paulo)."""
    d = b.get("happening_date") if b else None
    hs, he = (b or {}).get("happening_start"), (b or {}).get("happening_end")
    if not d or not hs:
        return None
    try:
        from datetime import datetime, timezone, timedelta as _td
        tz = timezone(_td(hours=-3))
        start = datetime.fromisoformat(f"{d}T{hs}:00").replace(tzinfo=tz)
        end = datetime.fromisoformat(f"{d}T{(he or hs)}:00").replace(tzinfo=tz)
        if end <= start:
            end = end + _td(days=1)  # evento que cruza a meia-noite
        now = now_utc().astimezone(tz)
        if start <= now <= end:
            return "now"
        if now < start and (start - now) <= _td(minutes=90):
            return "soon"
    except (ValueError, TypeError):
        return None
    return None


@router.get("/merchant/boosts")
async def merchant_boosts(user=Depends(merchant_only), establishment_id: Optional[str] = None):
    ests = await db.establishments.find({"owner_id": user["id"]}).to_list(50)
    ids = [e["id"] for e in ests]
    if establishment_id and establishment_id != "all":
        ids = [establishment_id] if establishment_id in ids else []
    items = await db.boosts.find({"establishment_id": {"$in": ids}}).sort("created_at", -1).to_list(500) if ids else []
    return [_pub(b) for b in items]


@router.post("/merchant/boosts")
async def create_boost(payload: NewBoost, user=Depends(merchant_only)):
    e = await db.establishments.find_one({"id": payload.establishment_id, "owner_id": user["id"]})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado.")
    s = await db.stories.find_one({"id": payload.story_id, "establishment_id": e["id"]})
    if not s:
        raise HTTPException(status_code=404, detail="Story não encontrado neste estabelecimento.")
    if s.get("status") != "active" or s.get("expires_at", "") < now_iso():
        raise HTTPException(status_code=400, detail="Só é possível destacar um Story ativo.")
    dup = await db.boosts.find_one({"story_id": payload.story_id, "status": {"$in": list(BOOST_ACTIVE_LOCKS)}})
    if dup:
        raise HTTPException(status_code=400, detail="Já existe uma solicitação de destaque em andamento para este Story.")
    # Pré-moderação automática (texto). Bloqueia conteúdo claramente proibido antes da fila do admin.
    mod = moderate_content(s.get("title"), s.get("text"), payload.happening_title, payload.notes,
                           payload.region, payload.category)
    init_status = "rejected" if mod["decision"] == "rejected" else "awaiting"
    reject_reason = mod["reason"] if init_status == "rejected" else None
    bid = new_id()
    boost = {
        "id": bid, "merchant_owner_id": user["id"],
        "establishment_id": e["id"], "establishment_name": e.get("fantasy_name"),
        "story_id": s["id"], "story_title": s.get("title"), "story_media_url": s.get("media_url"),
        "period_start": payload.period_start, "period_end": payload.period_end,
        "region": payload.region or "", "category": payload.category or "", "notes": payload.notes or "",
        "happening_title": payload.happening_title, "happening_date": payload.happening_date,
        "happening_start": payload.happening_start, "happening_end": payload.happening_end,
        "priority": 1, "status": init_status, "activated_at": None,
        "price": None, "price_label": PRICE_LABEL, "free_period": True,
        "moderation": mod, "reject_reason": reject_reason,
        "metrics": _empty_metrics(), "viewer_ids": [],
        "status_history": [{"status": init_status, "at": now_iso(), "by": "system",
                            "note": mod["reason"]}],
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.boosts.insert_one(dict(boost))
    if init_status == "rejected":
        await create_notification(user["id"], "merchant", "boost", "Destaque reprovado na pré-moderação",
                                  f"{e.get('fantasy_name')}: {mod['reason']}", "/merchant/boosts")
    else:
        admins = await db.users.find({"role": {"$in": ["admin", "super_admin"]}}).to_list(50)
        flag = " (requer análise)" if mod["decision"] == "review" else ""
        for a in admins:
            await create_notification(a["id"], "admin", "new_boost", "Novo Destaque OFF 360",
                                      f"{e.get('fantasy_name')} solicitou destaque para um Story{flag}", "/admin/boosts")
    await create_audit(user, "create_boost", bid, {}, {"establishment_id": e["id"], "story_id": s["id"], "moderation": mod["decision"]})
    return _pub(boost)


@router.post("/merchant/boosts/{bid}/cancel")
async def cancel_boost(bid: str, user=Depends(merchant_only)):
    b = await db.boosts.find_one({"id": bid, "merchant_owner_id": user["id"]})
    if not b:
        raise HTTPException(status_code=404, detail="Destaque não encontrado.")
    if b.get("status") not in ("awaiting", "approved"):
        raise HTTPException(status_code=400, detail="Só é possível cancelar antes da ativação.")
    await _set_status(b, "cancelled", "merchant")
    await create_audit(user, "cancel_boost", bid, {"status": b.get("status")}, {"status": "cancelled"})
    return _pub(await db.boosts.find_one({"id": bid}))


async def _set_status(b, status, by, note=None, extra=None):
    upd = {"$set": {"status": status, "updated_at": now_iso()},
           "$push": {"status_history": {"status": status, "at": now_iso(), "by": by, "note": note}}}
    if extra:
        upd["$set"].update(extra)
    await db.boosts.update_one({"id": b["id"]}, upd)


# ---------------- Admin ----------------
@router.get("/admin/boosts")
async def admin_boosts(user=Depends(admin_only), status: Optional[str] = None, q: Optional[str] = None):
    query = {}
    if status and status != "all":
        query["status"] = status
    items = await db.boosts.find(query).sort("created_at", -1).to_list(2000)
    if q:
        ql = q.lower()
        items = [b for b in items if ql in (b.get("establishment_name") or "").lower() or ql in (b.get("story_title") or "").lower()]
    return [_pub(b) for b in items]


@router.post("/admin/boosts/{bid}/approve")
async def approve_boost(bid: str, user=Depends(admin_only)):
    b = await _admin_get(bid)
    if b.get("status") != "awaiting":
        raise HTTPException(status_code=400, detail="Este destaque não está aguardando análise.")
    await _set_status(b, "approved", "admin")
    await create_notification(b["merchant_owner_id"], "merchant", "boost", "Destaque aprovado",
                              f"{b.get('establishment_name')} — destaque aprovado", "/merchant/boosts")
    await create_audit(user, "approve_boost", bid, {"status": "awaiting"}, {"status": "approved"})
    return _pub(await db.boosts.find_one({"id": bid}))


class RejectInput(BaseModel):
    reason: Optional[str] = None


@router.post("/admin/boosts/{bid}/reject")
async def reject_boost(bid: str, payload: Optional[RejectInput] = None, user=Depends(admin_only)):
    b = await _admin_get(bid)
    if b.get("status") in ("ended", "cancelled", "rejected"):
        raise HTTPException(status_code=400, detail="Este destaque já foi finalizado.")
    reason = (payload.reason if payload else None) or "Reprovado pela administração."
    await _set_status(b, "rejected", "admin", note=reason, extra={"reject_reason": reason})
    await create_notification(b["merchant_owner_id"], "merchant", "boost", "Destaque recusado",
                              f"{b.get('establishment_name')}: {reason}", "/merchant/boosts")
    await create_audit(user, "reject_boost", bid, {"status": b.get("status")}, {"status": "rejected", "reason": reason})
    return _pub(await db.boosts.find_one({"id": bid}))


class ActivateInput(BaseModel):
    priority: Optional[int] = 1
    period_start: Optional[str] = None
    period_end: Optional[str] = None


@router.post("/admin/boosts/{bid}/activate")
async def activate_boost(bid: str, payload: ActivateInput, user=Depends(admin_only)):
    b = await _admin_get(bid)
    if b.get("status") in ("ended", "cancelled", "rejected"):
        raise HTTPException(status_code=400, detail="Este destaque já foi finalizado.")
    extra = {
        "priority": int(payload.priority or 1),
        "period_start": payload.period_start or b.get("period_start") or now_iso(),
        "period_end": payload.period_end or b.get("period_end"),
        "activated_at": b.get("activated_at") or now_iso(),
    }
    await _set_status(b, "active", "admin", note="Período gratuito — sem cobrança", extra=extra)
    await create_notification(b["merchant_owner_id"], "merchant", "boost", "Destaque ativado",
                              f"{b.get('establishment_name')} — seu Story está em destaque!", "/merchant/boosts")
    await create_audit(user, "activate_boost", bid, {"status": b.get("status")}, {"status": "active", **extra})
    return _pub(await db.boosts.find_one({"id": bid}))


@router.post("/admin/boosts/{bid}/pause")
async def pause_boost(bid: str, user=Depends(admin_only)):
    b = await _admin_get(bid)
    if b.get("status") != "active":
        raise HTTPException(status_code=400, detail="Só é possível pausar um destaque ativo.")
    await _set_status(b, "paused", "admin")
    await create_audit(user, "pause_boost", bid, {"status": "active"}, {"status": "paused"})
    return _pub(await db.boosts.find_one({"id": bid}))


@router.post("/admin/boosts/{bid}/resume")
async def resume_boost(bid: str, user=Depends(admin_only)):
    b = await _admin_get(bid)
    if b.get("status") != "paused":
        raise HTTPException(status_code=400, detail="Só é possível reativar um destaque pausado.")
    await _set_status(b, "active", "admin", extra={"activated_at": b.get("activated_at") or now_iso()})
    await create_audit(user, "resume_boost", bid, {"status": "paused"}, {"status": "active"})
    return _pub(await db.boosts.find_one({"id": bid}))


@router.post("/admin/boosts/{bid}/end")
async def end_boost(bid: str, user=Depends(admin_only)):
    b = await _admin_get(bid)
    if b.get("status") in ("ended", "cancelled", "rejected"):
        raise HTTPException(status_code=400, detail="Este destaque já foi finalizado.")
    await _set_status(b, "ended", "admin")
    await create_audit(user, "end_boost", bid, {"status": b.get("status")}, {"status": "ended"})
    return _pub(await db.boosts.find_one({"id": bid}))


async def _admin_get(bid):
    b = await db.boosts.find_one({"id": bid})
    if not b:
        raise HTTPException(status_code=404, detail="Destaque não encontrado.")
    return b
