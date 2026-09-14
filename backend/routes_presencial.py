"""Operação Presencial (Fase 3): cardápio digital, mesas, garçons, pedidos,
cozinha, comandas, chamar garçom, taxa de serviço. Usa o MESMO catálogo (catalog_items)."""
import os
import jwt
import hmac
import logging
import io
from datetime import timedelta
from typing import Optional, List
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel

from core import (db, require_role, new_id, now_iso, now_utc, strip_id, get_jwt_secret,
                  JWT_ALGORITHM, hash_password, verify_password, create_notification, ws_hub)
from emailer import send_email
from storage import get_object, put_object


def _crop_portrait(data: bytes) -> bytes:
    """Recorta a foto para 3x4 (retrato) e redimensiona para 300x400 JPEG."""
    from PIL import Image
    im = Image.open(io.BytesIO(data)).convert("RGB")
    ratio = 3 / 4  # largura/altura
    w, h = im.size
    if w / h > ratio:
        nw = int(h * ratio); l = (w - nw) // 2; im = im.crop((l, 0, l + nw, h))
    else:
        nh = int(w / ratio); t = (h - nh) // 2; im = im.crop((0, t, w, t + nh))
    im = im.resize((300, 400), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
    return buf.getvalue()

router = APIRouter(prefix="/api", tags=["presencial"])
merchant_only = require_role("merchant")


# ---------------- helpers ----------------
def _safe_text(v, fallback=""):
    """Coerce a Mongo field that is supposed to be display text into a plain str.
    Guards against React error #31 ("objects are not valid as a React child") when a
    name/label field is ever stored as a dict/list/other non-string value."""
    if isinstance(v, str):
        return v
    if v is None:
        return fallback
    if isinstance(v, dict):
        for k in ("pt", "pt-BR", "en", "name", "text", "value"):
            if isinstance(v.get(k), str):
                return v[k]
        return fallback
    if isinstance(v, (list, tuple)):
        for item in v:
            if isinstance(item, str):
                return item
        return fallback
    return str(v)


def _safe_num(v, fallback=0):
    """Coerce a Mongo field that is supposed to be numeric into an int/float,
    never a dict/list that would blow up arithmetic or a direct render on the frontend."""
    if isinstance(v, bool):
        return fallback
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        try:
            return float(v) if "." in v else int(v)
        except ValueError:
            return fallback
    return fallback


def _eff_price(it):
    price = float(it.get("price") or 0)
    disc = float(it.get("discount_percent") or 0)
    unit = price * (1 - disc / 100)
    promo = float(it.get("promo_price") or 0)
    if promo > 0 and promo < price and promo < unit:
        unit = promo
    return round(unit, 2)


def _totals(c):
    sub = 0.0
    for it in c.get("items", []):
        add = sum(_safe_num(a.get("price"), 0) for a in (it.get("addons") or []) if isinstance(a, dict))
        sub += (_safe_num(it.get("unit_price"), 0) + add) * _safe_num(it.get("qty"), 1)
    pct = _safe_num(c.get("service_fee_percent"), 0)
    fee = round(sub * pct / 100, 2)
    return round(sub, 2), fee, round(sub + fee, 2)


def _comanda_out(c):
    sub, fee, total = _totals(c)
    c = strip_id(dict(c))
    c["subtotal"], c["service_fee"], c["total"] = sub, fee, total
    c["table_name"] = _safe_text(c.get("table_name"))
    c["items"] = [{**it, "name": _safe_text(it.get("name")), "qty": _safe_num(it.get("qty"), 1),
                   "status": _safe_text(it.get("status"), "new")} for it in c.get("items", [])]
    return c


async def _owned(uid, eid):
    e = await db.establishments.find_one({"id": eid, "owner_id": uid})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    return e


async def _open_comanda(eid, table):
    c = await db.comandas.find_one({"table_id": table["id"], "status": {"$in": ["open", "bill_requested"]}})
    if c:
        return c
    e = await db.establishments.find_one({"id": eid})
    c = {"id": new_id(), "establishment_id": eid, "table_id": table["id"], "table_name": table.get("name"),
         "status": "open", "items": [], "service_fee_percent": float((e or {}).get("service_fee_percent") or 0),
         "waiter_id": table.get("waiter_id"), "created_at": now_iso(), "updated_at": now_iso()}
    await db.comandas.insert_one(dict(c))
    return c


async def _add_items(eid, table, items, default_status):
    comanda = await _open_comanda(eid, table)
    cat = await db.catalog_items.find({"establishment_id": eid}).to_list(300)
    by_id = {i["id"]: i for i in cat}
    added = []
    for req in items:
        it = by_id.get(req.get("item_id"))
        if not it or not it.get("active", True) or it.get("available") is False:
            continue
        qty = max(1, int(req.get("qty") or 1))
        added.append({
            "item_id": it["id"], "name": it.get("name"), "unit_price": _eff_price(it),
            "qty": qty, "addons": [a for a in (req.get("addons") or []) if a.get("name")],
            "observations": (req.get("observations") or "").strip(),
            "status": default_status, "created_at": now_iso(),
        })
    if not added:
        raise HTTPException(status_code=400, detail="Nenhum item válido para adicionar")
    await db.comandas.update_one({"id": comanda["id"]}, {"$push": {"items": {"$each": added}}, "$set": {"updated_at": now_iso()}})
    await db.tables.update_one({"id": table["id"]}, {"$set": {"status": "occupied", "comanda_id": comanda["id"]}})
    return await db.comandas.find_one({"id": comanda["id"]})


# ==================== MERCHANT: CONFIG ====================
class ConfigInput(BaseModel):
    establishment_id: str
    service_fee_percent: Optional[float] = None
    presencial_flow: Optional[str] = None  # "waiter" | "direct"
    print_enabled: Optional[bool] = None
    nfc_enabled: Optional[bool] = None
    menu_mode: Optional[str] = None  # "native" | "external"
    menu_external_url: Optional[str] = None
    google_review_url: Optional[str] = None


@router.get("/merchant/presencial/config")
async def get_config(establishment_id: str, user=Depends(merchant_only)):
    e = await _owned(user["id"], establishment_id)
    return {"service_fee_percent": e.get("service_fee_percent") or 0,
            "presencial_flow": e.get("presencial_flow") or "waiter",
            "print_enabled": bool(e.get("print_enabled")), "nfc_enabled": bool(e.get("nfc_enabled")),
            "menu_mode": e.get("menu_mode") or "native", "menu_external_url": e.get("menu_external_url") or "",
            "google_review_url": e.get("google_review_url") or "",
            "modules": e.get("modules") or {"online": True, "presencial": False}}


@router.put("/merchant/presencial/config")
async def put_config(payload: ConfigInput, user=Depends(merchant_only)):
    await _owned(user["id"], payload.establishment_id)
    upd = {k: v for k, v in payload.model_dump().items() if v is not None and k != "establishment_id"}
    if "presencial_flow" in upd and upd["presencial_flow"] not in ("waiter", "direct"):
        raise HTTPException(status_code=400, detail="Fluxo inválido")
    if "menu_mode" in upd and upd["menu_mode"] not in ("native", "external"):
        raise HTTPException(status_code=400, detail="Origem de cardápio inválida")
    if upd:
        await db.establishments.update_one({"id": payload.establishment_id}, {"$set": upd})
    return {"ok": True, **upd}


# ==================== MERCHANT: MESAS ====================
class TableInput(BaseModel):
    establishment_id: str
    name: str


@router.get("/merchant/presencial/tables")
async def list_tables(establishment_id: str, user=Depends(merchant_only)):
    await _owned(user["id"], establishment_id)
    items = await db.tables.find({"establishment_id": establishment_id}).sort("created_at", 1).to_list(300)
    for t in items:
        if not t.get("qr_token"):
            newtok = new_id()
            await db.tables.update_one({"id": t["id"]}, {"$set": {"qr_token": newtok}})
            t["qr_token"] = newtok
    return [strip_id(t) for t in items]


@router.post("/merchant/presencial/tables")
async def create_table(payload: TableInput, user=Depends(merchant_only)):
    await _owned(user["id"], payload.establishment_id)
    t = {"id": new_id(), "establishment_id": payload.establishment_id, "owner_id": user["id"],
         "name": payload.name.strip(), "qr_token": new_id(), "status": "free",
         "waiter_id": None, "comanda_id": None, "created_at": now_iso()}
    await db.tables.insert_one(dict(t))
    return strip_id(t)


@router.delete("/merchant/presencial/tables/{tid}")
async def delete_table(tid: str, user=Depends(merchant_only)):
    t = await db.tables.find_one({"id": tid, "owner_id": user["id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Mesa não encontrada")
    await db.tables.delete_one({"id": tid})
    await db.comandas.delete_many({"table_id": tid, "status": {"$in": ["open", "bill_requested"]}})
    return {"ok": True}


@router.post("/merchant/presencial/tables/{tid}/reset-scans")
async def reset_table_scans(tid: str, user=Depends(merchant_only)):
    t = await db.tables.find_one({"id": tid, "owner_id": user["id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Mesa não encontrada")
    await db.tables.update_one({"id": tid}, {"$set": {"scan_count": 0}})
    return {"ok": True}


# ==================== MERCHANT: GARÇONS ====================
class WaiterInput(BaseModel):
    establishment_id: str
    name: str
    login: str
    password: str


@router.get("/merchant/presencial/waiters")
async def list_waiters(establishment_id: str, user=Depends(merchant_only)):
    await _owned(user["id"], establishment_id)
    items = await db.waiters.find({"establishment_id": establishment_id}).sort("created_at", 1).to_list(200)
    return [{"id": w["id"], "name": _safe_text(w.get("name")), "login": _safe_text(w.get("login")),
             "status": _safe_text(w.get("status"), "active"), "photo_url": w.get("photo_url"), "phone": w.get("phone")} for w in items]


@router.post("/merchant/presencial/waiters")
async def create_waiter(payload: WaiterInput, user=Depends(merchant_only)):
    await _owned(user["id"], payload.establishment_id)
    login = payload.login.strip().lower()
    if await db.waiters.find_one({"login": login}):
        raise HTTPException(status_code=400, detail="Este login de garçom já existe. Escolha outro.")
    w = {"id": new_id(), "establishment_id": payload.establishment_id, "owner_id": user["id"],
         "name": payload.name.strip(), "login": login, "password_hash": hash_password(payload.password),
         "status": "active", "created_at": now_iso()}
    await db.waiters.insert_one(dict(w))
    return {"id": w["id"], "name": w["name"], "login": w["login"], "status": "active"}


class WaiterUpdate(BaseModel):
    status: Optional[str] = None
    password: Optional[str] = None


@router.put("/merchant/presencial/waiters/{wid}")
async def update_waiter(wid: str, payload: WaiterUpdate, user=Depends(merchant_only)):
    w = await db.waiters.find_one({"id": wid, "owner_id": user["id"]})
    if not w:
        raise HTTPException(status_code=404, detail="Garçom não encontrado")
    upd = {}
    if payload.status in ("active", "inactive"):
        upd["status"] = payload.status
        if payload.status == "active" and w.get("status") == "pending":
            upd["approved_at"] = now_iso()
    if payload.password:
        upd["password_hash"] = hash_password(payload.password)
    if upd:
        await db.waiters.update_one({"id": wid}, {"$set": upd})
    return {"ok": True}


@router.delete("/merchant/presencial/waiters/{wid}")
async def delete_waiter(wid: str, user=Depends(merchant_only)):
    r = await db.waiters.delete_one({"id": wid, "owner_id": user["id"]})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Garçom não encontrado")
    return {"ok": True}


# ==================== MERCHANT: COMANDAS / COZINHA / CHAMADAS ====================
@router.get("/merchant/presencial/comandas")
async def list_comandas(establishment_id: str, user=Depends(merchant_only)):
    await _owned(user["id"], establishment_id)
    items = await db.comandas.find({"establishment_id": establishment_id, "status": {"$in": ["open", "bill_requested"]}}).sort("created_at", 1).to_list(300)
    return [_comanda_out(c) for c in items]


@router.get("/merchant/presencial/kitchen")
async def kitchen(establishment_id: str, user=Depends(merchant_only)):
    await _owned(user["id"], establishment_id)
    return await _kitchen_board(establishment_id)


async def _kitchen_board(eid):
    comandas = await db.comandas.find({"establishment_id": eid, "status": {"$in": ["open", "bill_requested"]}}).to_list(300)
    board = {"new": [], "preparing": [], "ready": []}
    for c in comandas:
        for idx, it in enumerate(c.get("items", [])):
            st = it.get("status")
            if isinstance(st, str) and st in board:
                board[st].append({"comanda_id": c["id"], "table_name": _safe_text(c.get("table_name")), "idx": idx,
                                  "name": _safe_text(it.get("name")), "qty": _safe_num(it.get("qty"), 1), "observations": _safe_text(it.get("observations")),
                                  "addons": it.get("addons", []), "created_at": it.get("created_at")})
    return board


class ItemStatusInput(BaseModel):
    comanda_id: str
    idx: int
    status: str  # new | preparing | ready | delivered


async def _set_item_status(eid, comanda_id, idx, status):
    if status not in ("new", "preparing", "ready", "delivered"):
        raise HTTPException(status_code=400, detail="Status inválido")
    c = await db.comandas.find_one({"id": comanda_id, "establishment_id": eid})
    if not c or idx < 0 or idx >= len(c.get("items", [])):
        raise HTTPException(status_code=404, detail="Item não encontrado")
    items = c["items"]
    items[idx]["status"] = status
    await db.comandas.update_one({"id": comanda_id}, {"$set": {"items": items, "updated_at": now_iso()}})
    # Avisa o garçom responsável quando fica pronto
    if status == "ready" and c.get("waiter_id"):
        try:
            await ws_hub.send(c["waiter_id"], {"type": "kitchen_ready", "comanda_id": comanda_id, "item": items[idx].get("name")})
        except Exception:
            pass
    return {"ok": True}


@router.post("/merchant/presencial/kitchen/status")
async def kitchen_status(payload: ItemStatusInput, user=Depends(merchant_only)):
    e = await db.establishments.find_one({"owner_id": user["id"]})
    # valida via comanda->establishment do dono
    c = await db.comandas.find_one({"id": payload.comanda_id})
    if not c:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    await _owned(user["id"], c["establishment_id"])
    return await _set_item_status(c["establishment_id"], payload.comanda_id, payload.idx, payload.status)


# ==================== COZINHA PÚBLICA (tablet/monitor, sem login do dono) ====================
@router.get("/presencial/kitchen/{eid}")
async def public_kitchen(eid: str):
    e = await db.establishments.find_one({"id": eid})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    board = await _kitchen_board(eid)
    return {"establishment": {"id": e["id"], "fantasy_name": e.get("fantasy_name")}, "board": board}


@router.post("/presencial/kitchen/{eid}/status")
async def public_kitchen_status(eid: str, payload: ItemStatusInput):
    e = await db.establishments.find_one({"id": eid})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    c = await db.comandas.find_one({"id": payload.comanda_id, "establishment_id": eid})
    if not c:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    return await _set_item_status(eid, payload.comanda_id, payload.idx, payload.status)


@router.post("/merchant/presencial/comandas/{cid}/close")
async def close_comanda(cid: str, user=Depends(merchant_only)):
    c = await db.comandas.find_one({"id": cid})
    if not c:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    await _owned(user["id"], c["establishment_id"])
    await db.comandas.update_one({"id": cid}, {"$set": {"status": "closed", "closed_at": now_iso()}})
    await db.tables.update_one({"id": c["table_id"]}, {"$set": {"status": "free", "comanda_id": None}})
    return {"ok": True}


@router.get("/merchant/presencial/calls")
async def list_calls(establishment_id: str, user=Depends(merchant_only)):
    await _owned(user["id"], establishment_id)
    items = await db.waiter_calls.find({"establishment_id": establishment_id, "status": "open"}).sort("created_at", 1).to_list(100)
    out = []
    for x in items:
        x = strip_id(x)
        x["table_name"] = _safe_text(x.get("table_name"))
        x["note"] = _safe_text(x.get("note"))
        out.append(x)
    return out


@router.post("/merchant/presencial/calls/{call_id}/attend")
async def attend_call(call_id: str, user=Depends(merchant_only)):
    c = await db.waiter_calls.find_one({"id": call_id})
    if not c:
        raise HTTPException(status_code=404, detail="Chamada não encontrada")
    await _owned(user["id"], c["establishment_id"])
    await db.waiter_calls.update_one({"id": call_id}, {"$set": {"status": "attended", "attended_at": now_iso(), "attended_by": user["id"]}})
    return {"ok": True}


# ==================== PÚBLICO (MESA via QR) ====================
async def _table_by_token(token):
    t = await db.tables.find_one({"qr_token": token}) or await db.tables.find_one({"id": token})
    if not t:
        raise HTTPException(status_code=404, detail="Mesa não encontrada")
    return t


@router.get("/presencial/table/{token}")
async def table_menu(token: str):
    t = await _table_by_token(token)
    await db.tables.update_one({"id": t["id"]}, {"$inc": {"scan_count": 1}, "$set": {"last_scan_at": now_iso()}})
    e = await db.establishments.find_one({"id": t["establishment_id"]})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    cat = await db.catalog_items.find({"establishment_id": e["id"], "active": True}).sort("sort_order", 1).to_list(300)
    catalog = []
    for i in cat:
        if i.get("available") is False:
            continue
        catalog.append({"id": i["id"], "name": i.get("name"), "description": i.get("description"),
                        "category": i.get("category") or "", "price": i.get("price"), "eff_price": _eff_price(i),
                        "photo_url": i.get("photo_url"), "addons": i.get("addons", []),
                        "observations_enabled": i.get("observations_enabled", True),
                        "featured": i.get("featured"), "best_seller": i.get("best_seller")})
    comanda = await db.comandas.find_one({"table_id": t["id"], "status": {"$in": ["open", "bill_requested"]}})
    comanda_out = _comanda_out(comanda) if comanda else None
    if comanda_out and comanda.get("waiter_id"):
        wv = await db.waiters.find_one({"id": comanda["waiter_id"]})
        if wv:
            comanda_out["waiter"] = {"name": wv.get("name"), "photo_url": wv.get("photo_url")}
    return {"establishment": {"id": e["id"], "fantasy_name": e.get("fantasy_name"), "logo_url": e.get("logo_url"), "cover_url": e.get("cover_url")},
            "table": {"id": t["id"], "name": t.get("name")},
            "flow": e.get("presencial_flow") or "waiter",
            "service_fee_percent": e.get("service_fee_percent") or 0,
            "menu_mode": e.get("menu_mode") or "native",
            "menu_external_url": e.get("menu_external_url") or "",
            "google_review_url": e.get("google_review_url") or "",
            "catalog": catalog,
            "comanda": comanda_out}


class OrderInput(BaseModel):
    items: List[dict]


@router.post("/presencial/table/{token}/order")
async def table_order(token: str, payload: OrderInput):
    t = await _table_by_token(token)
    e = await db.establishments.find_one({"id": t["establishment_id"]})
    flow = (e or {}).get("presencial_flow") or "waiter"
    default_status = "new" if flow == "direct" else "pending"
    c = await _add_items(t["establishment_id"], t, payload.items, default_status)
    # notifica o dono (novo pedido presencial)
    try:
        await create_notification(e["owner_id"], "merchant", "presencial_order", "Novo pedido na mesa",
                                  f"Mesa {t.get('name')} enviou um pedido", "/merchant/presencial")
    except Exception:
        pass
    return {"ok": True, "flow": flow, "comanda": _comanda_out(c)}


@router.get("/presencial/table/{token}/comanda")
async def table_comanda(token: str):
    t = await _table_by_token(token)
    c = await db.comandas.find_one({"table_id": t["id"], "status": {"$in": ["open", "bill_requested"]}})
    return _comanda_out(c) if c else None


class CallInput(BaseModel):
    note: Optional[str] = ""


@router.post("/presencial/table/{token}/call-waiter")
async def call_waiter(token: str, payload: CallInput):
    t = await _table_by_token(token)
    e = await db.establishments.find_one({"id": t["establishment_id"]})
    existing = await db.waiter_calls.find_one({"table_id": t["id"], "status": "open"})
    if existing:
        return {"ok": True, "already": True}
    call = {"id": new_id(), "establishment_id": t["establishment_id"], "table_id": t["id"],
            "table_name": t.get("name"), "note": (payload.note or "").strip(), "status": "open",
            "alert_waiter_id": t.get("waiter_id"), "created_at": now_iso()}
    await db.waiter_calls.insert_one(dict(call))
    try:
        await create_notification(e["owner_id"], "merchant", "waiter_call", "Chamada de garçom",
                                  f"Mesa {t.get('name')} está chamando", "/merchant/presencial")
    except Exception:
        pass
    return {"ok": True}


@router.post("/presencial/table/{token}/request-bill")
async def request_bill(token: str):
    t = await _table_by_token(token)
    c = await db.comandas.find_one({"table_id": t["id"], "status": "open"})
    if not c:
        raise HTTPException(status_code=400, detail="Não há comanda aberta nesta mesa.")
    await db.comandas.update_one({"id": c["id"]}, {"$set": {"status": "bill_requested", "updated_at": now_iso()}})
    e = await db.establishments.find_one({"id": t["establishment_id"]})
    try:
        await create_notification(e["owner_id"], "merchant", "bill_request", "Conta solicitada",
                                  f"Mesa {t.get('name')} pediu a conta", "/merchant/presencial")
    except Exception:
        pass
    return {"ok": True}


# ==================== GARÇOM (login + painel) ====================
@router.get("/presencial/invite/{eid}")
async def waiter_invite_info(eid: str):
    e = await db.establishments.find_one({"id": eid})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    return {"establishment": {"id": e["id"], "fantasy_name": e.get("fantasy_name"), "logo_url": e.get("logo_url")}}


@router.post("/presencial/waiter/register")
async def waiter_register(establishment_id: str = Form(...), name: str = Form(...),
                          login: str = Form(...), password: str = Form(...),
                          phone: str = Form(""), file: UploadFile = File(None)):
    e = await db.establishments.find_one({"id": establishment_id})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    login = login.strip().lower()
    if not name.strip() or not login or len(password) < 4:
        raise HTTPException(status_code=400, detail="Preencha nome, login e senha (mínimo 4 caracteres)")
    if await db.waiters.find_one({"login": login}):
        raise HTTPException(status_code=400, detail="Este login já existe. Escolha outro.")
    photo_url = None
    if file is not None:
        data = await file.read()
        if data:
            out = _crop_portrait(data)
            npath = f"off360/uploads/{establishment_id}/{new_id()}.jpg"
            res = put_object(npath, out, "image/jpeg")
            spath = res.get("path", npath)
            await db.files.insert_one({"id": new_id(), "storage_path": spath, "original_filename": "selfie.jpg",
                                       "content_type": "image/jpeg", "size": res.get("size"), "owner_id": e.get("owner_id"),
                                       "is_deleted": False, "created_at": now_iso()})
            photo_url = f"/api/files/{spath}"
    w = {"id": new_id(), "establishment_id": establishment_id, "owner_id": e.get("owner_id"),
         "name": name.strip(), "login": login, "password_hash": hash_password(password),
         "phone": "".join(ch for ch in (phone or "") if ch.isdigit()),
         "status": "pending", "photo_url": photo_url, "created_at": now_iso()}
    await db.waiters.insert_one(dict(w))
    try:
        await create_notification(e["owner_id"], "merchant", "waiter_pending", "Novo garçom aguardando aprovação",
                                  f"{name.strip()} se cadastrou e aguarda sua aprovação", "/merchant/presencial")
    except Exception:
        pass
    return {"ok": True, "pending": True}


class WaiterLogin(BaseModel):
    login: str
    password: str


def _waiter_token(w):
    payload = {"sub": w["id"], "type": "waiter", "est": w["establishment_id"],
               "exp": now_utc() + timedelta(hours=12)}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


async def waiter_dep(request: Request):
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "waiter":
            raise HTTPException(status_code=401, detail="Token inválido")
        w = await db.waiters.find_one({"id": payload["sub"]})
        if not w or w.get("status") != "active":
            raise HTTPException(status_code=401, detail="Garçom inativo")
        return w
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessão inválida")


@router.post("/presencial/waiter/login")
async def waiter_login(payload: WaiterLogin):
    w = await db.waiters.find_one({"login": payload.login.strip().lower()})
    if not w or not verify_password(payload.password, w.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Login ou senha incorretos")
    if w.get("status") == "pending":
        raise HTTPException(status_code=403, detail="Seu cadastro está aguardando aprovação do estabelecimento.")
    if w.get("status") != "active":
        raise HTTPException(status_code=403, detail="Garçom inativo. Contate o estabelecimento.")
    e = await db.establishments.find_one({"id": w["establishment_id"]})
    return {"token": _waiter_token(w), "waiter": {"id": w["id"], "name": w.get("name")},
            "establishment": {"id": e["id"], "fantasy_name": e.get("fantasy_name")} if e else None}


@router.get("/presencial/waiter/overview")
async def waiter_overview(w=Depends(waiter_dep)):
    eid = w["establishment_id"]
    tables = await db.tables.find({"establishment_id": eid}).sort("created_at", 1).to_list(300)
    comandas = await db.comandas.find({"establishment_id": eid, "status": {"$in": ["open", "bill_requested"]}}).to_list(300)
    calls = await db.waiter_calls.find({"establishment_id": eid, "status": "open"}).sort("created_at", 1).to_list(100)
    cat = await db.catalog_items.find({"establishment_id": eid, "active": True}).sort("sort_order", 1).to_list(300)
    catalog = [{"id": i["id"], "name": _safe_text(i.get("name")), "eff_price": _eff_price(i), "category": _safe_text(i.get("category"))} for i in cat if i.get("available") is not False]
    wl = await db.waiters.find({"establishment_id": eid, "status": "active"}).sort("name", 1).to_list(200)
    out_tables = []
    for t in tables:
        t = strip_id(t)
        t["name"] = _safe_text(t.get("name"))
        out_tables.append(t)
    return {"tables": out_tables, "comandas": [_comanda_out(c) for c in comandas],
            "calls": [strip_id(c) for c in calls], "catalog": catalog, "board": await _kitchen_board(eid),
            "waiters": [{"id": x["id"], "name": _safe_text(x.get("name"))} for x in wl],
            "waiter": {"id": w["id"], "name": _safe_text(w.get("name")), "photo_url": w.get("photo_url")}}


@router.post("/presencial/waiter/photo")
async def waiter_photo(file: UploadFile = File(...), w=Depends(waiter_dep)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Arquivo vazio")
    out = _crop_portrait(data)
    npath = f"off360/uploads/{w['establishment_id']}/{new_id()}.jpg"
    res = put_object(npath, out, "image/jpeg")
    spath = res.get("path", npath)
    await db.files.insert_one({"id": new_id(), "storage_path": spath, "original_filename": "selfie.jpg",
                               "content_type": "image/jpeg", "size": res.get("size"), "owner_id": w.get("owner_id"),
                               "is_deleted": False, "created_at": now_iso()})
    nurl = f"/api/files/{spath}"
    await db.waiters.update_one({"id": w["id"]}, {"$set": {"photo_url": nurl}})
    return {"ok": True, "photo_url": nurl}


class ReassignInput(BaseModel):
    call_id: str
    waiter_id: str


@router.post("/presencial/waiter/call/reassign")
async def waiter_reassign(payload: ReassignInput, w=Depends(waiter_dep)):
    c = await db.waiter_calls.find_one({"id": payload.call_id, "establishment_id": w["establishment_id"], "status": "open"})
    if not c:
        raise HTTPException(status_code=404, detail="Chamada não encontrada")
    target = await db.waiters.find_one({"id": payload.waiter_id, "establishment_id": w["establishment_id"], "status": "active"})
    if not target:
        raise HTTPException(status_code=404, detail="Garçom não encontrado")
    # Vínculo fixo da mesa permanece; apenas o alvo do ALERTA muda para o colega.
    await db.waiter_calls.update_one({"id": c["id"]}, {"$set": {"alert_waiter_id": payload.waiter_id, "reassigned_by": w["id"]}})
    return {"ok": True}


class WaiterAdd(BaseModel):
    table_id: str
    items: List[dict]


@router.post("/presencial/waiter/comanda/add")
async def waiter_add(payload: WaiterAdd, w=Depends(waiter_dep)):
    t = await db.tables.find_one({"id": payload.table_id, "establishment_id": w["establishment_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Mesa não encontrada")
    await db.tables.update_one({"id": t["id"]}, {"$set": {"waiter_id": w["id"]}})
    t["waiter_id"] = w["id"]
    c = await _add_items(w["establishment_id"], t, payload.items, "new")
    await db.comandas.update_one({"id": c["id"]}, {"$set": {"waiter_id": w["id"]}})
    return {"ok": True, "comanda": _comanda_out(c)}


class ComandaRef(BaseModel):
    comanda_id: str


@router.post("/presencial/waiter/comanda/send-kitchen")
async def waiter_send_kitchen(payload: ComandaRef, w=Depends(waiter_dep)):
    c = await db.comandas.find_one({"id": payload.comanda_id, "establishment_id": w["establishment_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    items = c.get("items", [])
    for it in items:
        if it.get("status") == "pending":
            it["status"] = "new"
    await db.comandas.update_one({"id": c["id"]}, {"$set": {"items": items, "waiter_id": w["id"], "updated_at": now_iso()}})
    return {"ok": True}


@router.post("/presencial/waiter/item/status")
async def waiter_item_status(payload: ItemStatusInput, w=Depends(waiter_dep)):
    c = await db.comandas.find_one({"id": payload.comanda_id, "establishment_id": w["establishment_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    return await _set_item_status(w["establishment_id"], payload.comanda_id, payload.idx, payload.status)


@router.post("/presencial/waiter/call/{call_id}/attend")
async def waiter_attend(call_id: str, w=Depends(waiter_dep)):
    c = await db.waiter_calls.find_one({"id": call_id, "establishment_id": w["establishment_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Chamada não encontrada")
    await db.waiter_calls.update_one({"id": call_id}, {"$set": {"status": "attended", "attended_by": w["id"], "attended_at": now_iso()}})
    return {"ok": True}


@router.post("/presencial/waiter/comanda/request-bill")
async def waiter_request_bill(payload: ComandaRef, w=Depends(waiter_dep)):
    c = await db.comandas.find_one({"id": payload.comanda_id, "establishment_id": w["establishment_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    await db.comandas.update_one({"id": c["id"]}, {"$set": {"status": "bill_requested", "updated_at": now_iso()}})
    return {"ok": True}


# ==================== AVALIAÇÃO (cliente na mesa) ====================
class RateInput(BaseModel):
    stars: int
    waiter_stars: Optional[int] = None
    comment: Optional[str] = ""


@router.post("/presencial/table/{token}/rate")
async def table_rate(token: str, payload: RateInput):
    t = await _table_by_token(token)
    if not (1 <= int(payload.stars) <= 5):
        raise HTTPException(status_code=400, detail="Nota inválida")
    c = await db.comandas.find_one({"table_id": t["id"], "status": {"$in": ["open", "bill_requested", "closed"]}}, sort=[("created_at", -1)])
    doc = {"id": new_id(), "establishment_id": t["establishment_id"], "table_id": t["id"],
           "table_name": t.get("name"), "comanda_id": (c or {}).get("id"), "waiter_id": (c or {}).get("waiter_id"),
           "stars": int(payload.stars), "waiter_stars": int(payload.waiter_stars) if payload.waiter_stars else None,
           "comment": (payload.comment or "").strip(), "created_at": now_iso()}
    await db.presencial_ratings.insert_one(dict(doc))
    return {"ok": True}


# ==================== ALERTAS EM TEMPO REAL (painel do dono) ====================
@router.get("/merchant/presencial/alerts")
async def presencial_alerts(user=Depends(merchant_only)):
    ests = await db.establishments.find({"owner_id": user["id"]}).to_list(50)
    eids = [e["id"] for e in ests]
    if not eids:
        return {"calls": 0, "orders": 0}
    calls = await db.waiter_calls.count_documents({"establishment_id": {"$in": eids}, "status": "open"})
    # pedidos aguardando (itens 'new' ou 'pending') em comandas abertas
    comandas = await db.comandas.find({"establishment_id": {"$in": eids}, "status": {"$in": ["open", "bill_requested"]}}).to_list(300)
    orders = sum(1 for c in comandas for it in c.get("items", []) if it.get("status") in ("new", "pending"))
    bills = sum(1 for c in comandas if c.get("status") == "bill_requested")
    return {"calls": calls, "orders": orders, "bills": bills}


# ==================== CRON: RESUMO DIÁRIO POR E-MAIL ====================
async def _run_daily_summaries():
    start = now_utc().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    ests = await db.establishments.find({}).to_list(2000)
    by_owner = {}
    for e in ests:
        by_owner.setdefault(e.get("owner_id"), []).append(e)
    for owner_id, owned in by_owner.items():
        owner = await db.users.find_one({"id": owner_id})
        if not owner or not owner.get("email"):
            continue
        eids = [e["id"] for e in owned]
        txs = await db.transactions.find({"establishment_id": {"$in": eids}, "status": "confirmed", "confirmed_at": {"$gte": start}}).to_list(5000)
        comandas = await db.comandas.find({"establishment_id": {"$in": eids}, "status": "closed", "closed_at": {"$gte": start}}).to_list(2000)
        tx_rev = sum(float(t.get("final_amount") or 0) for t in txs)
        com_rev = 0.0
        item_counter = Counter()
        for c in comandas:
            sub, fee, total = _totals(c)
            com_rev += total
            for it in c.get("items", []):
                item_counter[it.get("name")] += int(it.get("qty") or 1)
        total_rev = round(tx_rev + com_rev, 2)
        n_com = len(comandas)
        if total_rev <= 0 and n_com == 0 and not txs:
            continue  # nada a reportar hoje
        top = item_counter.most_common(1)
        top_txt = f"{top[0][0]} ({top[0][1]}x)" if top else "—"
        names = ", ".join(e.get("fantasy_name") for e in owned)
        html = (
            f"<div style='font-family:Arial,sans-serif;color:#0f172a'>"
            f"<h2 style='color:#FF7A00'>Resumo do dia — OFF360</h2>"
            f"<p>Olá, {owner.get('name') or 'empresário'}! Aqui está o fechamento de hoje de <b>{names}</b>:</p>"
            f"<ul>"
            f"<li><b>Faturamento do dia:</b> R$ {total_rev:.2f}</li>"
            f"<li><b>Comandas encerradas:</b> {n_com}</li>"
            f"<li><b>Validações de desconto:</b> {len(txs)}</li>"
            f"<li><b>Item mais vendido:</b> {top_txt}</li>"
            f"</ul>"
            f"<p style='color:#64748b;font-size:12px'>Acesse o painel em <a href='https://off360.com.br'>off360.com.br</a> para detalhes.</p>"
            f"</div>"
        )
        try:
            await send_email(to=owner["email"], subject="OFF360 — Resumo do seu dia", html=html)
        except Exception as ex:
            logging.getLogger("off360").warning("Falha ao enviar resumo diário para %s: %s", owner.get("email"), ex)


@router.post("/cron/merchant-daily-summary")
async def cron_daily_summary(request: Request, background: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    secret = os.environ.get("WEBHOOK_CRON_SECRET")
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    if not secret or not token or not hmac.compare_digest(token, secret):
        raise HTTPException(status_code=401, detail="Não autorizado")
    background.add_task(_run_daily_summaries)
    return {"ok": True, "queued": True}


# ==================== DASHBOARD DE AVALIAÇÕES / RANKING DE GARÇONS ====================
@router.get("/merchant/presencial/ratings-summary")
async def ratings_summary(establishment_id: str, user=Depends(merchant_only)):
    await _owned(user["id"], establishment_id)
    rts = await db.presencial_ratings.find({"establishment_id": establishment_id}).sort("created_at", -1).to_list(2000)
    n = len(rts)
    avg_service = round(sum(int(r.get("stars") or 0) for r in rts) / n, 2) if n else 0
    agg = {}
    for r in rts:
        wid, ws = r.get("waiter_id"), r.get("waiter_stars")
        if wid and ws:
            s = agg.setdefault(wid, {"sum": 0, "count": 0})
            s["sum"] += int(ws); s["count"] += 1
    waiters = {w["id"]: _safe_text(w.get("name"), "Garçom") for w in await db.waiters.find({"establishment_id": establishment_id}).to_list(200)}
    ranking = [{"waiter_id": k, "name": waiters.get(k, "Garçom"), "avg": round(v["sum"] / v["count"], 2), "count": v["count"]} for k, v in agg.items()]
    ranking.sort(key=lambda x: (x["avg"], x["count"]), reverse=True)
    recent = [{"stars": _safe_num(r.get("stars")), "waiter_stars": _safe_num(r.get("waiter_stars")), "comment": _safe_text(r.get("comment")),
               "table_name": _safe_text(r.get("table_name")), "created_at": r.get("created_at")} for r in rts[:20]]
    return {"avg_service": avg_service, "count": n, "waiter_ranking": ranking, "recent": recent}
