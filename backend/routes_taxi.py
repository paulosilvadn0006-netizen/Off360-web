"""360Taxi — módulo de corridas (separado das entregas). Prefixo /api/taxi.
Fluxo: cotação -> solicitação -> (negociação) -> aceite -> a caminho -> chegou ->
código de embarque -> em andamento -> finalização -> avaliação.
Comissão OFF360 = R$ 0,00 (valor da corrida vai integralmente ao motorista).
"""
import random
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
import re as _re
import docai as _docai
import mp as _mp
from datetime import datetime as _dt, timezone as _tz
from pydantic import BaseModel

from core import (db, require_role, new_id, now_iso, strip_id,
                  create_notification, get_settings, get_current_user, ws_hub,
                  get_jwt_secret, JWT_ALGORITHM)
import jwt as _jwt
from fastapi import WebSocket, WebSocketDisconnect
import geo

router = APIRouter(prefix="/api/taxi", tags=["taxi"])
from taxi_subscription import ensure_can_accept, trial_fields
consumer_only = require_role("consumer")
deliverer_only = require_role("deliverer")
admin_only = require_role("admin")

# O app ainda não tem um loop de GPS automático em background (taxi_location só é
# atualizada ao ficar online, ao usar "local favorito" ou no botão de simulação da
# corrida) — por isso a janela de "atual" é por turno/dia, não em minutos, para não
# derrubar motoristas legitimamente online. Cobre o caso relatado: localização parada
# há dias/semanas ainda contando como motorista disponível.
DRIVER_LOCATION_STALE_SECONDS = 24 * 60 * 60  # 24h


def _driver_location_fresh(loc):
    """True se taxi_location foi atualizada há poucos minutos (evita usar posição congelada em matching/ETA)."""
    at = (loc or {}).get("at")
    if not at:
        return False
    try:
        ts = _dt.fromisoformat(at.replace("Z", "+00:00"))
        return (_dt.now(_tz.utc) - ts).total_seconds() <= DRIVER_LOCATION_STALE_SECONDS
    except Exception:
        return False


@router.websocket("/ws")
async def taxi_ws(websocket: WebSocket):
    token = websocket.cookies.get("access_token") or websocket.query_params.get("token")
    user = None
    try:
        payload = _jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") == "access":
            user = await db.users.find_one({"id": payload.get("sub")})
    except Exception:
        user = None
    if not user:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    websocket.off_role = user.get("role")
    await ws_hub.connect(user["id"], websocket)
    try:
        while True:
            await websocket.receive_text()  # keepalive/ping do cliente
    except Exception:
        pass
    finally:
        ws_hub.disconnect(user["id"], websocket)

TAXI_DEFAULTS = {
    "taxi_base_fare": 5.0,
    "taxi_min_fare": 8.0,
    "taxi_per_km": 2.5,
    "taxi_per_min": 0.5,
    "taxi_include_pickup": True,      # considera deslocamento motorista->consumidor no valor
    "taxi_max_negotiations": 3,       # limite de rodadas de negociação
    "taxi_search_radius_km": 50.0,    # raio para o motorista ver solicitações
    "taxi_commission": 0.0,           # comissão OFF360 (fixa em 0 nesta etapa)
    # Tarifas por categoria de carro (cada uma: base, valor até 2km, valor por km adicional, valor por minuto)
    "taxi_categories": {
        "basic":   {"base_fare": 3.0, "up_to_2km": 6.0,  "per_km_extra": 2.0, "per_min": 0.3},
        "select":  {"base_fare": 4.0, "up_to_2km": 8.0,  "per_km_extra": 2.8, "per_min": 0.4},
        "premium": {"base_fare": 6.0, "up_to_2km": 11.0, "per_km_extra": 3.5, "per_min": 0.6},
    },
}

CATEGORIES = ["basic", "select", "premium"]
CATEGORY_LABELS = {"basic": "Basic", "select": "Select", "premium": "Premium"}


def _norm_category(c):
    return c if c in CATEGORIES else "basic"

ACTIVE_STATUSES = ("searching", "negotiating", "accepted", "arrived", "in_progress")


async def taxi_settings():
    s = await get_settings()
    out = dict(TAXI_DEFAULTS)
    for k in TAXI_DEFAULTS:
        if k == "taxi_categories":
            continue
        if s.get(k) is not None:
            out[k] = s[k]
    # Mescla as tarifas por categoria (mantém defaults para campos não configurados)
    cats = {c: dict(TAXI_DEFAULTS["taxi_categories"][c]) for c in CATEGORIES}
    saved = s.get("taxi_categories") or {}
    for c in CATEGORIES:
        for fld, val in (saved.get(c) or {}).items():
            if val is not None:
                cats[c][fld] = val
    out["taxi_categories"] = cats
    return out


def compute_price_cat(cat_cfg, dist_km, dur_min):
    base = cat_cfg.get("base_fare") or 0
    up2 = cat_cfg.get("up_to_2km") or 0
    pkm = cat_cfg.get("per_km_extra") or 0
    pmin = cat_cfg.get("per_min") or 0
    extra_km = max(0, (dist_km or 0) - 2)
    return round(base + up2 + extra_km * pkm + (dur_min or 0) * pmin, 2)


def category_prices(cfg, dist_km, dur_min):
    cats = cfg["taxi_categories"]
    return [{"id": c, "label": CATEGORY_LABELS[c], "price": compute_price_cat(cats[c], dist_km, dur_min)} for c in CATEGORIES]


class Point(BaseModel):
    lat: float
    lng: float
    address: Optional[str] = ""


def compute_price(cfg, pickup_km, pickup_min, trip_km, trip_min):
    base = cfg.get("taxi_base_fare") or 0
    per_km = cfg.get("taxi_per_km") or 0
    per_min = cfg.get("taxi_per_min") or 0
    minf = cfg.get("taxi_min_fare") or 0
    include_pickup = cfg.get("taxi_include_pickup", True)
    dist = (pickup_km + trip_km) if include_pickup else trip_km
    tmin = (pickup_min + trip_min) if include_pickup else trip_min
    price = base + per_km * dist + per_min * tmin
    return round(max(price, minf), 2)


def _public_driver(u):
    if not u:
        return None
    cnt = u.get("taxi_rating_count") or 0
    avg = round((u.get("taxi_rating_sum") or 0) / cnt, 1) if cnt else None
    rides = u.get("taxi_rides_count") or 0
    return {
        "id": u.get("id"), "name": u.get("name"),
        "photo_url": u.get("taxi_photo_3x4_url") or u.get("photo_url"),
        "rating": avg, "rating_count": cnt, "rides_count": rides,
        "vehicle": u.get("taxi_modelo") or u.get("taxi_vehicle") or u.get("vehicle") or "carro",
        "vehicle_type": u.get("taxi_vehicle_type") or "carro",
        "category": u.get("taxi_category") or "basic",
        "category_label": CATEGORY_LABELS.get(u.get("taxi_category") or "basic", "Basic"),
        "modelo": u.get("taxi_modelo") or "", "cor": u.get("taxi_cor") or "",
        "plate": u.get("taxi_plate") or "",
        "verified": (u.get("taxi_status") == "aprovado"),
        "is_gold": rides >= 1000,
    }


def _rider_public(u):
    """Perfil público do passageiro (avaliação recebida dos motoristas + nº de viagens)."""
    if not u:
        return None
    cnt = u.get("rider_rating_count") or 0
    avg = round((u.get("rider_rating_sum") or 0) / cnt, 1) if cnt else None
    return {
        "id": u.get("id"), "name": u.get("name"), "photo_url": u.get("photo_url"),
        "rating": avg, "rating_count": cnt,
        "rides_count": u.get("rider_rides_count") or 0,
    }


def _ride_out(r, driver=None):
    r = strip_id(r)
    if driver is not None:
        r["driver"] = _public_driver(driver)
    return r


async def _get_ride(rid):
    r = await db.taxi_rides.find_one({"id": rid})
    if not r:
        raise HTTPException(status_code=404, detail="Corrida não encontrada")
    return dict(r)


# ==================== CONSUMIDOR ====================
class QuoteInput(BaseModel):
    origin: Point
    destination: Point
    category: Optional[str] = "basic"


@router.post("/quote")
async def quote(payload: QuoteInput, user=Depends(consumer_only)):
    cfg = await taxi_settings()
    trip = geo.route(payload.origin.model_dump(), payload.destination.model_dump())
    cats = category_prices(cfg, trip["distance_km"], trip["duration_min"])
    return {
        "trip": trip,
        "categories": cats,
        "suggested_price": cats[0]["price"],
        "commission": cfg["taxi_commission"],
        "max_negotiations": cfg["taxi_max_negotiations"],
    }


# ---------- Autocomplete de endereços + endereços salvos ----------
@router.get("/geocode")
async def taxi_geocode(q: str, lat: Optional[float] = None, lng: Optional[float] = None, user=Depends(consumer_only)):
    """Autocomplete de endereços por texto (usado nos campos de origem/destino)."""
    return geo.geocode(q, lat=lat, lng=lng)


@router.get("/reverse")
async def taxi_reverse(lat: float, lng: float, user=Depends(consumer_only)):
    """Endereço textual da localização atual (GPS)."""
    return {"address": geo.reverse_geocode(lat, lng)}


@router.get("/place-details")
async def taxi_place_details(place_id: str, user=Depends(consumer_only)):
    """Resolve coordenadas de uma predição do autocomplete (Google place_id)."""
    d = geo.place_details(place_id)
    if not d:
        raise HTTPException(status_code=404, detail="Endereço não encontrado")
    return d


class SavedAddressInput(BaseModel):
    label: Optional[str] = ""
    address: str
    lat: float
    lng: float


@router.get("/addresses")
async def list_addresses(user=Depends(consumer_only)):
    docs = await db.taxi_saved_addresses.find({"consumer_id": user["id"]}).sort("created_at", -1).to_list(50)
    return [strip_id(d) for d in docs]


@router.post("/addresses")
async def add_address(payload: SavedAddressInput, user=Depends(consumer_only)):
    if not (payload.address or "").strip():
        raise HTTPException(status_code=400, detail="Endereço inválido.")
    existing = await db.taxi_saved_addresses.find_one({
        "consumer_id": user["id"], "lat": round(payload.lat, 5), "lng": round(payload.lng, 5)})
    if existing:
        return strip_id(existing)
    doc = {
        "id": new_id(), "consumer_id": user["id"],
        "label": (payload.label or "").strip(),
        "address": payload.address.strip(),
        "lat": round(payload.lat, 5), "lng": round(payload.lng, 5),
        "created_at": now_iso(),
    }
    await db.taxi_saved_addresses.insert_one(dict(doc))
    return strip_id(doc)


@router.delete("/addresses/{aid}")
async def del_address(aid: str, user=Depends(consumer_only)):
    await db.taxi_saved_addresses.delete_one({"id": aid, "consumer_id": user["id"]})
    return {"ok": True}


class MpTokenInput(BaseModel):
    access_token: str


@router.post("/driver/mp/token")
async def driver_mp_token(payload: MpTokenInput, user=Depends(deliverer_only)):
    """Vincula a conta Mercado Pago do motorista via Access Token (valida em /users/me)."""
    token = (payload.access_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Informe o Access Token do Mercado Pago.")
    try:
        me = _mp.mp_request("GET", "/users/me", token)
    except Exception:
        raise HTTPException(status_code=400, detail="Access Token inválido. Verifique e tente novamente.")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "mp_access_token": token, "mp_user_id": str(me.get("id") or ""),
        "mp_connected_at": now_iso(),
    }})
    return {"ok": True, "mp_user": me.get("nickname") or me.get("email")}


@router.post("/driver/mp/disconnect")
async def driver_mp_disconnect(user=Depends(deliverer_only)):
    await db.users.update_one({"id": user["id"]}, {"$unset": {
        "mp_access_token": "", "mp_refresh_token": "", "mp_user_id": "",
        "mp_public_key": "", "mp_token_expires_at": "", "mp_connected_at": "",
    }})
    return {"ok": True}


class RideInput(BaseModel):
    origin: Point
    destination: Point
    category: Optional[str] = "basic"
    offer_price: Optional[float] = None  # None = aceita o valor sugerido
    payment_method: Optional[str] = "pix"  # pix | card | cash
    card_id: Optional[str] = None


@router.post("/rides")
async def create_ride(payload: RideInput, user=Depends(consumer_only)):
    existing = await db.taxi_rides.find_one({"consumer_id": user["id"], "status": {"$in": list(ACTIVE_STATUSES)}})
    if existing:
        raise HTTPException(status_code=400, detail="Você já tem uma corrida em andamento.")
    cfg = await taxi_settings()
    category = _norm_category(payload.category)
    trip = geo.route(payload.origin.model_dump(), payload.destination.model_dump())
    suggested = compute_price_cat(cfg["taxi_categories"][category], trip["distance_km"], trip["duration_min"])
    price = suggested
    offers = []
    if payload.offer_price is not None:
        price = round(float(payload.offer_price), 2)
        if price <= 0:
            raise HTTPException(status_code=400, detail="Informe um valor válido para a oferta.")
        offers.append({"by": "consumer", "amount": price, "at": now_iso()})
    rid = new_id()
    ride = {
        "id": rid, "consumer_id": user["id"], "consumer_name": user.get("name"),
        "consumer_photo": user.get("photo_url"),
        "origin": payload.origin.model_dump(), "destination": payload.destination.model_dump(),
        "category": category, "category_label": CATEGORY_LABELS[category], "vehicle_type": "carro",
        "trip_distance_km": trip["distance_km"], "trip_duration_min": trip["duration_min"],
        "trip_geometry": trip["geometry"], "route_provider": trip["provider"],
        "suggested_price": suggested, "current_price": price, "agreed_price": None,
        "final_price": None, "offers": offers, "negotiation_count": len(offers),
        "driver_id": None, "driver_location": None, "pickup_distance_km": None, "pickup_eta_min": None,
        "driver_offers": [],
        "boarding_code": None, "share_token": new_id(),
        "rating": None, "emergency": False,
        "payment": {"method": (payload.payment_method if payload.payment_method in ("pix", "card", "cash") else "pix"),
                    "status": "pending", "card_id": payload.card_id},
        "status": "searching",
        "created_at": now_iso(), "accepted_at": None, "arrived_at": None,
        "started_at": None, "completed_at": None,
    }
    await db.taxi_rides.insert_one(dict(ride))
    await ws_hub.broadcast_role("deliverer", {"type": "taxi_event", "event": "new_request"})
    return strip_id(ride)


@router.get("/rides/active")
async def consumer_active(user=Depends(consumer_only)):
    r = await db.taxi_rides.find_one({"consumer_id": user["id"], "status": {"$in": list(ACTIVE_STATUSES)}})
    if not r:
        # Mantém a corrida recém-concluída visível até o passageiro avaliar o motorista.
        r = await db.taxi_rides.find_one({
            "consumer_id": user["id"], "status": "completed",
            "$or": [{"rating": None}, {"rating": {"$exists": False}}],
            "consumer_closed": {"$ne": True},
        }, sort=[("completed_at", -1)])
    if not r:
        return None
    driver = await db.users.find_one({"id": r["driver_id"]}) if r.get("driver_id") else None
    return _ride_out(r, driver)


@router.post("/rides/{rid}/dismiss")
async def dismiss_ride(rid: str, user=Depends(consumer_only)):
    """Fecha a tela de conclusão sem avaliar (não afeta a nota do motorista)."""
    await db.taxi_rides.update_one({"id": rid, "consumer_id": user["id"]}, {"$set": {"consumer_closed": True}})
    return {"ok": True}


@router.get("/rides/history")
async def consumer_history(user=Depends(consumer_only)):
    rides = await db.taxi_rides.find({
        "consumer_id": user["id"], "status": {"$in": ["completed", "cancelled", "interrupted"]}
    }).sort("created_at", -1).to_list(100)
    out = []
    for r in rides:
        driver = await db.users.find_one({"id": r["driver_id"]}) if r.get("driver_id") else None
        item = strip_id(r)
        item["driver"] = _public_driver(driver)
        out.append(item)
    return out


@router.get("/me/stats")
async def my_taxi_stats(user=Depends(consumer_only)):
    u = await db.users.find_one({"id": user["id"]})
    return _rider_public(u)


async def _lost_found(rides, counterpart_key):
    out = []
    for r in rides:
        cid = r.get(counterpart_key)
        if not cid:
            continue
        cu = await db.users.find_one({"id": cid})
        if not cu:
            continue
        out.append({"ride_id": r["id"], "at": r.get("completed_at") or r.get("created_at"),
                    "name": cu.get("name"), "whatsapp": cu.get("phone") or ""})
    return out


@router.get("/lost-and-found/consumer")
async def lf_consumer(user=Depends(consumer_only)):
    rides = await db.taxi_rides.find({"consumer_id": user["id"], "status": "completed", "driver_id": {"$ne": None}}).sort("completed_at", -1).to_list(30)
    return await _lost_found(rides, "driver_id")


@router.get("/lost-and-found/driver")
async def lf_driver(user=Depends(deliverer_only)):
    rides = await db.taxi_rides.find({"driver_id": user["id"], "status": "completed"}).sort("completed_at", -1).to_list(30)
    return await _lost_found(rides, "consumer_id")


@router.get("/rides/{rid}")
async def get_ride(rid: str, user=Depends(consumer_only)):
    r = await _get_ride(rid)
    if r["consumer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Sem acesso a esta corrida.")
    driver = await db.users.find_one({"id": r["driver_id"]}) if r.get("driver_id") else None
    return _ride_out(r, driver)


class OfferInput(BaseModel):
    amount: float


@router.post("/rides/{rid}/offer")
async def consumer_offer(rid: str, payload: OfferInput, user=Depends(consumer_only)):
    r = await _get_ride(rid)
    if r["consumer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Sem acesso a esta corrida.")
    if r["status"] not in ("searching", "negotiating"):
        raise HTTPException(status_code=400, detail="Não é possível negociar agora.")
    cfg = await taxi_settings()
    if r.get("negotiation_count", 0) >= cfg["taxi_max_negotiations"]:
        raise HTTPException(status_code=400, detail="Limite de negociações atingido.")
    amt = round(float(payload.amount), 2)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Informe um valor válido.")
    offers = r.get("offers", []) + [{"by": "consumer", "amount": amt, "at": now_iso()}]
    await db.taxi_rides.update_one({"id": rid}, {"$set": {
        "current_price": amt, "offers": offers, "negotiation_count": len(offers),
    }})
    if r.get("driver_id"):
        await create_notification(r["driver_id"], "deliverer", "taxi_offer", "Nova contraproposta",
                                  f"O passageiro propôs R$ {amt:.2f}", "/deliverer")
    return strip_id(await _get_ride(rid))


@router.post("/rides/{rid}/accept-price")
async def consumer_accept_price(rid: str, user=Depends(consumer_only)):
    r = await _get_ride(rid)
    if r["consumer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Sem acesso a esta corrida.")
    if r["status"] != "negotiating" or not r.get("driver_id"):
        raise HTTPException(status_code=400, detail="Nenhuma proposta de motorista para aceitar.")
    code = f"{random.randint(0, 9999):04d}"
    await db.taxi_rides.update_one({"id": rid}, {"$set": {
        "agreed_price": r["current_price"], "status": "accepted",
        "boarding_code": code, "accepted_at": now_iso(),
    }})
    await create_notification(r["driver_id"], "deliverer", "taxi_accepted", "Corrida confirmada",
                              "O passageiro aceitou o valor. Vá até o ponto de embarque.", "/deliverer")
    return strip_id(await _get_ride(rid))


class CancelInput(BaseModel):
    reason: Optional[str] = ""


@router.post("/rides/{rid}/cancel")
async def cancel_ride(rid: str, payload: Optional[CancelInput] = None, user=Depends(consumer_only)):
    r = await _get_ride(rid)
    if r["consumer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Sem acesso a esta corrida.")
    if r["status"] in ("completed", "cancelled", "interrupted"):
        raise HTTPException(status_code=400, detail="Corrida já encerrada.")
    reason = (payload.reason if payload else "") or ""
    # Se já embarcou (in_progress), NÃO zera: registra como "Corrida interrompida".
    if r["status"] == "in_progress":
        cfg = await taxi_settings()
        traveled = None
        if r.get("driver_location"):
            leg = geo.route(r["origin"], r["driver_location"])
            traveled = leg["distance_km"]
        charge = round(float(cfg.get("taxi_min_fare") or 0), 2)  # valor conforme regra configurada
        await db.taxi_rides.update_one({"id": rid}, {"$set": {
            "status": "interrupted", "cancel_reason": reason,
            "interrupted_at": now_iso(), "completed_at": now_iso(),
            "distance_traveled_km": traveled, "final_price": charge,
        }})
        if r.get("driver_id"):
            await create_notification(r["driver_id"], "deliverer", "taxi_interrupted", "Corrida interrompida",
                                      "A corrida foi interrompida após o embarque.", "/deliverer")
        return {"ok": True, "status": "interrupted", "final_price": charge}
    await db.taxi_rides.update_one({"id": rid}, {"$set": {
        "status": "cancelled", "cancel_reason": reason, "completed_at": now_iso()}})
    if r.get("driver_id"):
        await create_notification(r["driver_id"], "deliverer", "taxi_cancelled", "Corrida cancelada",
                                  "O passageiro cancelou a corrida.", "/deliverer")
    return {"ok": True, "status": "cancelled"}


class RateInput(BaseModel):
    score: int


@router.post("/rides/{rid}/rate")
async def rate_ride(rid: str, payload: RateInput, user=Depends(consumer_only)):
    r = await _get_ride(rid)
    if r["consumer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Sem acesso a esta corrida.")
    if r["status"] != "completed":
        raise HTTPException(status_code=400, detail="Só é possível avaliar após a corrida.")
    if r.get("rating") is not None:
        raise HTTPException(status_code=400, detail="Corrida já avaliada.")
    score = int(payload.score)
    if score < 5 or score > 10:
        raise HTTPException(status_code=400, detail="A nota deve ser entre 5 e 10.")
    await db.taxi_rides.update_one({"id": rid}, {"$set": {"rating": score}})
    if r.get("driver_id"):
        await db.users.update_one({"id": r["driver_id"]}, {"$inc": {
            "taxi_rating_sum": score, "taxi_rating_count": 1,
        }})
    return {"ok": True}


@router.post("/rides/{rid}/rate-passenger")
async def rate_passenger(rid: str, payload: RateInput, user=Depends(deliverer_only)):
    r = await _get_ride(rid)
    if r.get("driver_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Corrida de outro motorista.")
    if r["status"] != "completed":
        raise HTTPException(status_code=400, detail="Só é possível avaliar após a corrida.")
    if r.get("passenger_rating") is not None:
        raise HTTPException(status_code=400, detail="Passageiro já avaliado.")
    score = int(payload.score)
    if score < 5 or score > 10:
        raise HTTPException(status_code=400, detail="A nota deve ser entre 5 e 10.")
    await db.taxi_rides.update_one({"id": rid}, {"$set": {"passenger_rating": score}})
    if r.get("consumer_id"):
        await db.users.update_one({"id": r["consumer_id"]}, {"$inc": {
            "rider_rating_sum": score, "rider_rating_count": 1,
        }})
    return {"ok": True}


@router.post("/rides/{rid}/emergency")
async def emergency(rid: str, user=Depends(consumer_only)):
    r = await _get_ride(rid)
    if r["consumer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Sem acesso a esta corrida.")
    await db.taxi_rides.update_one({"id": rid}, {"$set": {"emergency": True, "emergency_at": now_iso()}})
    admins = await db.users.find({"role": "admin"}).to_list(50)
    for a in admins:
        await create_notification(a["id"], "admin", "taxi_emergency", "🆘 Emergência em corrida",
                                  f"Passageiro {r.get('consumer_name')} acionou emergência.", "/admin")
    return {"ok": True}


# ==================== ACOMPANHAMENTO PÚBLICO (compartilhar trajeto) ====================
@router.get("/track/{share_token}")
async def public_track(share_token: str):
    r = await db.taxi_rides.find_one({"share_token": share_token})
    if not r:
        raise HTTPException(status_code=404, detail="Trajeto não encontrado")
    driver = await db.users.find_one({"id": r["driver_id"]}) if r.get("driver_id") else None
    status = r["status"]
    ended = status in ("completed", "cancelled", "interrupted")
    if status in ("accepted", "arrived"):
        eta = r.get("pickup_eta_min")
    elif status == "in_progress":
        eta = r.get("remaining_eta_min") or r.get("trip_duration_min")
    else:
        eta = None
    return {
        "status": status,
        "active": not ended,
        "origin": r["origin"], "destination": r["destination"],
        "trip_geometry": r.get("trip_geometry"),
        "driver_location": r.get("driver_location"),
        "driver_name": (driver or {}).get("name") if driver else None,
        "driver_vehicle_type": r.get("driver_vehicle_type") or "carro",
        "eta_min": eta,
        "final_price": r.get("final_price") if ended else None,
        "cancel_reason": r.get("cancel_reason") if status in ("interrupted", "cancelled") else None,
    }


# ==================== MOTORISTA (360Taxi) ====================
class OnlineInput(BaseModel):
    online: bool
    lat: Optional[float] = None
    lng: Optional[float] = None


@router.post("/driver/online")
async def driver_online(payload: OnlineInput, user=Depends(deliverer_only)):
    if payload.online:
        u = await db.users.find_one({"id": user["id"]})
        if u.get("taxi_status") != "aprovado":
            raise HTTPException(status_code=403, detail="Seu cadastro 360Taxi ainda não foi aprovado.")
        ins = u.get("taxi_insurance") or {}
        if ins.get("status") != "aprovada":
            if ins.get("status") == "vencida":
                raise HTTPException(status_code=403, detail="Seu Seguro APP MBM está vencido. Renove com a corretora e reenvie a apólice para ficar online.")
            raise HTTPException(status_code=403, detail="Seu Seguro APP MBM ainda não foi aprovado. Anexe/aguarde a aprovação da apólice para ficar online.")
        if not u.get("mp_access_token"):
            raise HTTPException(status_code=403, detail="Conecte sua conta Mercado Pago para receber pagamentos antes de ficar online.")
    upd = {"taxi_online": bool(payload.online)}
    if payload.lat is not None and payload.lng is not None:
        upd["taxi_location"] = {"lat": payload.lat, "lng": payload.lng, "at": now_iso()}
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    return {"ok": True, "online": bool(payload.online)}


class LocInput(BaseModel):
    lat: float
    lng: float


@router.post("/driver/location")
async def driver_location(payload: LocInput, user=Depends(deliverer_only)):
    loc = {"lat": payload.lat, "lng": payload.lng, "at": now_iso()}
    await db.users.update_one({"id": user["id"]}, {"$set": {"taxi_location": loc}})
    # atualiza a localização na corrida ativa do motorista (a caminho / em andamento)
    ride = await db.taxi_rides.find_one({"driver_id": user["id"], "status": {"$in": ["accepted", "arrived", "in_progress"]}})
    if ride:
        upd = {"driver_location": loc}
        if ride["status"] == "accepted":
            leg = geo.route(loc, ride["origin"])
            upd["pickup_distance_km"] = leg["distance_km"]
            upd["pickup_eta_min"] = leg["duration_min"]
        elif ride["status"] == "in_progress":
            leg = geo.route(loc, ride["destination"])
            upd["remaining_distance_km"] = leg["distance_km"]
            upd["remaining_eta_min"] = leg["duration_min"]
        await db.taxi_rides.update_one({"id": ride["id"]}, {"$set": upd})
    return {"ok": True}


@router.get("/driver/favorites")
async def list_favorites(user=Depends(deliverer_only)):
    docs = await db.taxi_driver_favorites.find({"driver_id": user["id"]}).sort("created_at", -1).to_list(50)
    return [strip_id(d) for d in docs]


class FavoriteInput(BaseModel):
    label: Optional[str] = ""
    lat: float
    lng: float


@router.post("/driver/favorites")
async def add_favorite(payload: FavoriteInput, user=Depends(deliverer_only)):
    doc = {
        "id": new_id(), "driver_id": user["id"],
        "label": (payload.label or "").strip() or "Ponto favorito",
        "lat": round(payload.lat, 6), "lng": round(payload.lng, 6),
        "created_at": now_iso(),
    }
    await db.taxi_driver_favorites.insert_one(dict(doc))
    return strip_id(doc)


@router.delete("/driver/favorites/{fid}")
async def del_favorite(fid: str, user=Depends(deliverer_only)):
    await db.taxi_driver_favorites.delete_one({"id": fid, "driver_id": user["id"]})
    return {"ok": True}


@router.get("/driver/earnings")
async def driver_earnings(user=Depends(deliverer_only)):
    from datetime import datetime, timezone
    rides = await db.taxi_rides.find({"driver_id": user["id"], "status": "completed"}).to_list(3000)
    now = datetime.now(timezone.utc)
    res = {"today": {"count": 0, "earnings": 0.0}, "month": {"count": 0, "earnings": 0.0}, "all": {"count": 0, "earnings": 0.0}}
    for r in rides:
        val = float(r.get("final_price") or r.get("agreed_price") or 0)
        res["all"]["count"] += 1
        res["all"]["earnings"] += val
        ca = r.get("completed_at")
        dt = None
        if ca:
            try:
                dt = datetime.fromisoformat(ca)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                dt = None
        if dt and dt.year == now.year and dt.month == now.month:
            res["month"]["count"] += 1
            res["month"]["earnings"] += val
            if dt.date() == now.date():
                res["today"]["count"] += 1
                res["today"]["earnings"] += val
    for k in res:
        res[k]["earnings"] = round(res[k]["earnings"], 2)
    return res


@router.get("/driver/status")
async def driver_status(user=Depends(deliverer_only)):
    u = await db.users.find_one({"id": user["id"]})
    return {
        "online": bool(u.get("taxi_online")),
        "location": u.get("taxi_location"),
        "registered": bool(u.get("taxi_registered")),
        "taxi_status": u.get("taxi_status") or None,  # em_analise | aprovado | pendente
        "vehicle": u.get("taxi_modelo") or u.get("taxi_vehicle") or "carro",
        "vehicle_type": u.get("taxi_vehicle_type") or "carro",
        "category": u.get("taxi_category") or "basic",
        "category_label": CATEGORY_LABELS.get(u.get("taxi_category") or "basic", "Basic"),
        "modelo": u.get("taxi_modelo") or "", "cor": u.get("taxi_cor") or "",
        "plate": u.get("taxi_plate") or "", "ano": u.get("taxi_ano"), "portas": u.get("taxi_portas"),
        "cnh_number": u.get("taxi_cnh_number") or "", "cnh_validade": u.get("taxi_cnh_validade") or "",
        "ear": bool(u.get("taxi_ear")), "photo_3x4_url": u.get("taxi_photo_3x4_url") or "",
        "mp_connected": bool(u.get("mp_access_token")),
        "insurance": u.get("taxi_insurance") or {},
        "profile": _public_driver(u),
    }


class ProfileInput(BaseModel):
    vehicle: Optional[str] = None
    plate: Optional[str] = None
    category: Optional[str] = None  # basic | select | premium


@router.post("/driver/profile")
async def driver_profile(payload: ProfileInput, user=Depends(deliverer_only)):
    upd = {}
    if payload.vehicle is not None:
        upd["taxi_vehicle"] = payload.vehicle
    if payload.plate is not None:
        upd["taxi_plate"] = payload.plate.upper()
    if payload.category in CATEGORIES:
        upd["taxi_category"] = payload.category
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
    return {"ok": True}


class TaxiRegisterInput(BaseModel):
    photo_3x4_url: str
    cnh: Optional[str] = ""
    cnh_number: str
    cnh_validade: str
    ear: bool
    category: str  # basic | select | premium
    modelo: str
    cor: str
    placa: str
    ano: int
    portas: int
    insurance_accepted: Optional[bool] = False


# Regra comercial OFF360 (Campinas e região) — arquitetura permite config regional futura.
MAX_VEHICLE_AGE = 12
MIN_DOORS = 4


@router.post("/driver/register")
async def driver_register(payload: TaxiRegisterInput, user=Depends(deliverer_only)):
    from datetime import datetime, timezone
    if not payload.photo_3x4_url:
        raise HTTPException(status_code=400, detail="Foto 3x4 é obrigatória.")
    if not payload.ear:
        raise HTTPException(status_code=400, detail="É necessário possuir EAR (Exerce Atividade Remunerada) na CNH.")
    category = _norm_category(payload.category)
    if payload.portas < MIN_DOORS:
        raise HTTPException(status_code=400, detail=f"O veículo precisa ter no mínimo {MIN_DOORS} portas.")
    year = datetime.now(timezone.utc).year
    if year - int(payload.ano) > MAX_VEHICLE_AGE:
        raise HTTPException(status_code=400, detail=f"Regra OFF360: veículo com no máximo {MAX_VEHICLE_AGE} anos de fabricação.")
    if not payload.insurance_accepted:
        raise HTTPException(status_code=400, detail="É obrigatório aceitar as condições do Seguro APP MBM para concluir o cadastro.")
    upd = {
        "taxi_registered": True, "taxi_status": "em_analise",
        "taxi_insurance.accepted": True, "taxi_insurance.accepted_at": now_iso(),
        "taxi_photo_3x4_url": payload.photo_3x4_url,
        "taxi_cnh": payload.cnh or "", "taxi_cnh_number": payload.cnh_number,
        "taxi_cnh_validade": payload.cnh_validade, "taxi_ear": True,
        "taxi_vehicle_type": "carro", "taxi_category": category,
        "taxi_modelo": payload.modelo, "taxi_cor": payload.cor,
        "taxi_plate": payload.placa.upper(), "taxi_ano": int(payload.ano), "taxi_portas": int(payload.portas),
        "taxi_vehicle": payload.modelo, "taxi_region": "campinas",
    }
    if not user.get("status_assinatura"):
        upd.update(trial_fields())  # 30 dias grátis para novo motorista
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    admins = await db.users.find({"role": "admin"}).to_list(50)
    for a in admins:
        await create_notification(a["id"], "admin", "taxi_new_driver", "Novo cadastro 360Taxi",
                                  f"{user.get('name')} enviou cadastro para análise.", "/admin/taxi-drivers")
    return {"ok": True, "status": "em_analise"}


# ==================== SEGURO APP MBM ====================
class InsuranceAcceptInput(BaseModel):
    accepted: bool = True


@router.post("/insurance/accept")
async def insurance_accept(payload: InsuranceAcceptInput, user=Depends(deliverer_only)):
    if not payload.accepted:
        raise HTTPException(status_code=400, detail="É necessário aceitar as condições do Seguro APP MBM.")
    u = await db.users.find_one({"id": user["id"]})
    ins = (u or {}).get("taxi_insurance") or {}
    upd = {"taxi_insurance.accepted": True, "taxi_insurance.accepted_at": now_iso()}
    if not ins.get("status"):
        upd["taxi_insurance.status"] = "aguardando"
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    return {"ok": True}


class InsurancePolicyInput(BaseModel):
    file_url: str
    filename: Optional[str] = ""


@router.post("/insurance/policy")
async def insurance_policy(payload: InsurancePolicyInput, user=Depends(deliverer_only)):
    if not (payload.file_url or "").strip():
        raise HTTPException(status_code=400, detail="Arquivo da apólice é obrigatório.")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "taxi_insurance.policy_url": payload.file_url,
        "taxi_insurance.policy_filename": payload.filename or "apolice",
        "taxi_insurance.policy_uploaded_at": now_iso(),
        "taxi_insurance.status": "aguardando",
        "taxi_insurance.review_note": "",
    }})
    admins = await db.users.find({"role": "admin"}).to_list(50)
    for a in admins:
        await create_notification(a["id"], "admin", "taxi_insurance_policy", "Apólice Seguro APP MBM enviada",
                                  f"{user.get('name')} anexou a apólice do seguro para análise.", "/admin/taxi-drivers")
    return {"ok": True, "status": "aguardando"}


class InsuranceReviewInput(BaseModel):
    note: Optional[str] = ""
    expires_at: Optional[str] = ""  # YYYY-MM-DD (apólice anual); se vazio no approve, assume +1 ano


_INS_STATUS = {"approve": "aprovada", "correction": "correcao", "reject": "reprovada"}
_INS_MSG = {
    "aprovada": ("Seguro APP MBM aprovado ✅", "Sua apólice foi aprovada. Cadastro concluído!"),
    "correcao": ("Apólice precisa de correção ⚠️", "Sua apólice do Seguro APP MBM precisa de ajustes. Reenvie o arquivo."),
    "reprovada": ("Apólice reprovada ❌", "Sua apólice do Seguro APP MBM foi reprovada. Fale com a corretora e reenvie."),
}


@router.post("/admin/drivers/{did}/insurance/{action}")
async def admin_review_insurance(did: str, action: str, payload: Optional[InsuranceReviewInput] = None, user=Depends(admin_only)):
    from datetime import date, timedelta
    status = _INS_STATUS.get(action)
    if not status:
        raise HTTPException(status_code=400, detail="Ação inválida.")
    d = await db.users.find_one({"id": did, "role": "deliverer"})
    if not d:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")
    upd = {
        "taxi_insurance.status": status,
        "taxi_insurance.reviewed_at": now_iso(),
        "taxi_insurance.reviewed_by": user.get("name") or user.get("email") or user["id"],
        "taxi_insurance.review_note": (payload.note if payload else "") or "",
    }
    if status == "aprovada":
        exp = (payload.expires_at if payload else "") or ""
        expd = None
        try:
            if exp.strip():
                expd = date.fromisoformat(exp.strip())
        except Exception:
            expd = None
        if not expd:
            expd = date.today() + timedelta(days=365)  # apólice anual
        upd["taxi_insurance.policy_expires_at"] = expd.isoformat()
        upd["taxi_insurance.expiry_warned_for"] = ""  # reset avisos p/ nova vigência
    await db.users.update_one({"id": did}, {"$set": upd})
    title, body = _INS_MSG[status]
    if status == "aprovada" and upd.get("taxi_insurance.policy_expires_at"):
        body = f"Sua apólice foi aprovada (válida até {upd['taxi_insurance.policy_expires_at']}). Cadastro concluído!"
    await create_notification(did, "deliverer", "taxi_insurance_review", title, body, "/deliverer")
    return {"ok": True, "status": status, "expires_at": upd.get("taxi_insurance.policy_expires_at")}


# ==================== ADMIN — APROVAÇÃO DE MOTORISTAS ====================
def _doc_find_date(text):
    m = _re.search(r'(\d{2})[/.](\d{2})[/.](\d{4})', text or "")
    if not m:
        return None
    try:
        return _dt(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except Exception:
        return None


def _analyze_doc(doc_type, res):
    text = (res.get("text") or "").upper()
    conf = res.get("avg_confidence", 0)
    out = {"doc_type": doc_type, "raw_text": (res.get("text") or "")[:1200], "confidence": conf}
    suspeito = len(text.strip()) < 15
    if doc_type == "cnh":
        val = _doc_find_date(text)
        out["validade"] = val.strftime("%d/%m/%Y") if val else None
        out["ear"] = ("EAR" in text) or ("EXERCE ATIVIDADE REMUNERADA" in text)
        vencida = bool(val and val < _dt.utcnow())
        if not any(k in text for k in ("CONDUTOR", "HABILITA", "CNH", "TRANSITO")):
            suspeito = True
        out["status"] = "suspeito" if suspeito else ("vencido" if vencida else ("irregular" if not out["ear"] else "aprovado"))
        out["motivo"] = "Baixa leitura/campos faltando" if suspeito else ("CNH vencida" if vencida else ("Sem categoria EAR" if not out["ear"] else "OK"))
    elif doc_type == "antecedentes":
        limpo = "NADA CONSTA" in text
        out["resultado"] = "NADA CONSTA" if limpo else "Registro encontrado — revisar"
        out["status"] = "suspeito" if suspeito else ("aprovado" if limpo else "irregular")
        out["motivo"] = "Baixa leitura" if suspeito else ("OK" if limpo else "Verificar resultado")
    else:  # veiculo
        val = _doc_find_date(text)
        out["validade"] = val.strftime("%d/%m/%Y") if val else None
        vencida = bool(val and val < _dt.utcnow())
        if not val:
            suspeito = True
        out["status"] = "suspeito" if suspeito else ("vencido" if vencida else "aprovado")
        out["motivo"] = "Validade não encontrada" if suspeito else ("Documento vencido" if vencida else "OK")
    return out


DOC_TYPES = ("cnh_frente", "cnh_verso", "cnh", "antecedentes", "veiculo", "selfie")


async def _verify_stored_file(file_url):
    """Confere no banco (db.files) se o arquivo referenciado existe e está acessível.
    Retorna metadados (filename/content_type/path) ou None se não encontrado/removido."""
    if not file_url:
        return None
    marker = "/api/files/"
    idx = file_url.find(marker)
    if idx == -1:
        return None
    path = file_url[idx + len(marker):]
    rec = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not rec:
        return None
    return {
        "path": path,
        "filename": rec.get("original_filename") or path.split("/")[-1],
        "content_type": rec.get("content_type") or "application/octet-stream",
    }


@router.post("/documents/analyze")
async def analyze_document(doc_type: str = Form(...), file: UploadFile = File(...),
                           file_url: str = Form(None), user=Depends(deliverer_only)):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de documento inválido")
    content = await file.read()
    import doc_validation as _docval
    try:
        analysis = await _docval.run_document_pipeline(doc_type, content, file.filename, file.content_type or "")
    except ValueError:
        raise HTTPException(status_code=400, detail="Tipo de documento inválido")
    except Exception:
        raise HTTPException(status_code=502, detail="Falha ao analisar o documento")
    analysis["analyzed_at"] = now_iso()
    if file_url:
        analysis["file_url"] = file_url
    # Só concluímos como validado se o arquivo realmente existe e está acessível no armazenamento.
    verified = await _verify_stored_file(file_url) if file_url else None
    analysis["file_verified"] = bool(verified)
    if file_url and not verified:
        analysis["status"] = "revisao"
        analysis["motivo"] = "Arquivo não encontrado no armazenamento — reenvie o documento"
    await db.users.update_one({"id": user["id"]}, {"$set": {f"taxi_docs.{doc_type}": analysis}})
    return analysis


@router.get("/insurance/broker-docs")
async def insurance_broker_docs(user=Depends(deliverer_only)):
    """Lista os documentos originais do motorista (CNH, antecedentes, veículo) para envio à
    corretora, confirmando no banco que cada arquivo existe e está acessível."""
    u = await db.users.find_one({"id": user["id"]})
    docs = (u or {}).get("taxi_docs") or {}
    first_name = ((u.get("name") or "motorista").split() or ["motorista"])[0].lower()

    candidates = []  # (label, url)
    cnh_pair = []
    for k, lbl in (("cnh_frente", "CNH (frente)"), ("cnh_verso", "CNH (verso)")):
        url = (docs.get(k) or {}).get("file_url")
        if url:
            cnh_pair.append((lbl, url))
    if cnh_pair:
        candidates += cnh_pair
    else:
        cnh_url = (docs.get("cnh") or {}).get("file_url")
        if cnh_url:
            candidates.append(("CNH", cnh_url))
    antec_url = (docs.get("antecedentes") or {}).get("file_url")
    if antec_url:
        candidates.append(("Antecedentes criminais", antec_url))
    veic_url = (docs.get("veiculo") or {}).get("file_url")
    if veic_url:
        candidates.append(("Documento do veículo", veic_url))

    out, missing = [], []
    if not cnh_pair and not (docs.get("cnh") or {}).get("file_url"):
        missing.append("CNH")
    if not antec_url:
        missing.append("Antecedentes criminais")
    if not veic_url:
        missing.append("Documento do veículo")

    for label, url in candidates:
        v = await _verify_stored_file(url)
        if not v:
            if label not in missing:
                missing.append(label)
            continue
        ext = v["filename"].rsplit(".", 1)[-1].lower() if "." in v["filename"] else "jpg"
        safe = (label.lower().replace(" ", "_").replace("(", "").replace(")", ""))
        out.append({
            "label": label, "url": url,
            "filename": f"{safe}_{first_name}.{ext}",
            "content_type": v["content_type"],
        })
    return {"docs": out, "missing": missing}


@router.get("/admin/drivers")
async def admin_drivers(user=Depends(admin_only)):
    drivers = await db.users.find({"role": "deliverer", "taxi_registered": True}).sort("name", 1).to_list(500)
    out = []
    for d in drivers:
        p = _public_driver(d)
        out.append({
            "id": d["id"], "name": d.get("name"), "photo_3x4_url": d.get("taxi_photo_3x4_url"),
            "taxi_status": d.get("taxi_status") or "em_analise",
            "cnh_number": d.get("taxi_cnh_number"), "cnh_validade": d.get("taxi_cnh_validade"),
            "ear": bool(d.get("taxi_ear")), "vehicle_type": d.get("taxi_vehicle_type") or "carro",
            "modelo": d.get("taxi_modelo"), "cor": d.get("taxi_cor"), "placa": d.get("taxi_plate"),
            "ano": d.get("taxi_ano"), "portas": d.get("taxi_portas"),
            "rides_count": p["rides_count"], "rating": p["rating"], "is_gold": p["is_gold"],
            "category": d.get("taxi_category") or "basic",
            "taxi_docs": d.get("taxi_docs") or {},
            "insurance": d.get("taxi_insurance") or {},
        })
    return out


@router.post("/admin/drivers/{did}/approve")
async def admin_approve_driver(did: str, user=Depends(admin_only)):
    await db.users.update_one({"id": did}, {"$set": {"taxi_status": "aprovado"}})
    await create_notification(did, "deliverer", "taxi_approved", "360Taxi aprovado ✅",
                              "Seu cadastro foi aprovado. Você já pode ficar online.", "/deliverer")
    return {"ok": True}


@router.post("/admin/drivers/{did}/reject")
async def admin_reject_driver(did: str, payload: Optional[CancelInput] = None, user=Depends(admin_only)):
    await db.users.update_one({"id": did}, {"$set": {"taxi_status": "pendente", "taxi_online": False}})
    await create_notification(did, "deliverer", "taxi_rejected", "360Taxi pendente ❌",
                              "Seu cadastro precisa de ajustes. Revise seus dados.", "/deliverer")
    return {"ok": True}


@router.delete("/admin/drivers/{did}")
async def admin_delete_driver(did: str, user=Depends(admin_only)):
    """Exclui o cadastro completo do motorista, liberando e-mail/CPF para novo cadastro."""
    d = await db.users.find_one({"id": did, "role": "deliverer"})
    if not d:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")
    email = (d.get("email") or "").lower().strip()
    await db.taxi_rides.delete_many({"driver_id": did})
    await db.taxi_driver_favorites.delete_many({"driver_id": did})
    await db.notifications.delete_many({"recipient_id": did})
    if email:
        await db.login_attempts.delete_many({"identifier": {"$regex": f":{_re.escape(email)}$"}})
    await db.users.delete_one({"id": did})
    return {"ok": True}


def _offer_obj(u, amount, pickup):
    o = dict(_public_driver(u))
    o["driver_id"] = u["id"]
    o["amount"] = round(float(amount), 2)
    if pickup:
        o["pickup_distance_km"] = pickup["distance_km"]
        o["pickup_eta_min"] = pickup["duration_min"]
    o["at"] = now_iso()
    return o


@router.get("/driver/offers")
async def driver_offers(user=Depends(deliverer_only)):
    u = await db.users.find_one({"id": user["id"]})
    if not u.get("taxi_online") or not u.get("taxi_location") or not _driver_location_fresh(u.get("taxi_location")):
        return []
    # FILA: mostra solicitações mesmo com corrida ativa (motorista escolhe depois).
    cfg = await taxi_settings()
    loc = u["taxi_location"]
    # Distribuição por categoria: Basic/Select só veem a própria; Premium vê todas.
    dcat = _norm_category(u.get("taxi_category"))
    allowed = set(CATEGORIES) if dcat == "premium" else {dcat}
    rides = await db.taxi_rides.find({"status": "searching"}).sort("created_at", -1).to_list(50)
    from datetime import datetime, timezone
    DISMISS_TTL = 180  # 3 min: após esse tempo sem motorista, a corrida volta para todos
    now = datetime.now(timezone.utc)
    out = []
    for r in rides:
        if _norm_category(r.get("category")) not in allowed:
            continue
        # Descarte pelo motorista: fica oculta só por até 3 min; depois reaparece para todos.
        if user["id"] in (r.get("dismissed_by") or []):
            try:
                ca = r.get("created_at", "").replace("Z", "+00:00")
                age = (now - datetime.fromisoformat(ca)).total_seconds()
            except Exception:
                age = 0
            if age <= DISMISS_TTL:
                continue
        leg = geo.route(loc, r["origin"])
        if leg["distance_km"] > cfg["taxi_search_radius_km"]:
            continue
        item = strip_id(r)
        item["pickup_distance_km"] = leg["distance_km"]
        item["pickup_eta_min"] = leg["duration_min"]
        item["driver_earning"] = r["current_price"]
        item["already_offered"] = any(o.get("driver_id") == user["id"] for o in r.get("driver_offers", []))
        consumer = await db.users.find_one({"id": r["consumer_id"]}) if r.get("consumer_id") else None
        item["passenger"] = _rider_public(consumer)
        out.append(item)
    out.sort(key=lambda x: x["pickup_distance_km"])
    return out


@router.post("/rides/{rid}/dismiss-offer")
async def dismiss_offer(rid: str, user=Depends(deliverer_only)):
    """Motorista descarta a corrida: some para ele por até 3 min (regra em driver_offers)."""
    await db.taxi_rides.update_one({"id": rid, "status": "searching"},
                                   {"$addToSet": {"dismissed_by": user["id"]}})
    return {"ok": True}


@router.get("/driver/rides/active")
async def driver_active(user=Depends(deliverer_only)):
    r = await db.taxi_rides.find_one({"driver_id": user["id"], "status": {"$in": ["negotiating", "accepted", "arrived", "in_progress"]}})
    if not r:
        return None
    item = strip_id(r)
    consumer = await db.users.find_one({"id": r["consumer_id"]}) if r.get("consumer_id") else None
    item["passenger"] = _rider_public(consumer)
    return item


@router.get("/driver/rides/history")
async def driver_history(user=Depends(deliverer_only)):
    rides = await db.taxi_rides.find({
        "driver_id": user["id"], "status": {"$in": ["completed", "interrupted"]}
    }).sort("created_at", -1).to_list(100)
    return [strip_id(r) for r in rides]


async def _guard_one_active(driver_id, rid):
    active = await db.taxi_rides.find_one({"driver_id": driver_id, "status": {"$in": ["accepted", "arrived", "in_progress"]}})
    if active and active["id"] != rid:
        raise HTTPException(status_code=400, detail="Você já tem uma corrida ativa. Finalize-a antes de aceitar outra.")


@router.post("/rides/{rid}/driver-accept")
async def driver_accept(rid: str, user=Depends(deliverer_only)):
    # Envia oferta pelo valor pedido (marketplace, sem travar a corrida).
    r = await _get_ride(rid)
    await ensure_can_accept(user["id"])
    if r["status"] != "searching":
        raise HTTPException(status_code=409, detail="Esta corrida não está mais disponível.")
    u = await db.users.find_one({"id": user["id"]})
    loc = u.get("taxi_location")
    if not loc or not _driver_location_fresh(loc):
        raise HTTPException(status_code=400, detail="Sua localização não está atualizada. Ative o GPS e fique online novamente.")
    pickup = geo.route(loc, r["origin"]) if loc else None
    offer = _offer_obj(u, r["current_price"], pickup)
    await db.taxi_rides.update_one({"id": rid}, {"$pull": {"driver_offers": {"driver_id": user["id"]}}})
    await db.taxi_rides.update_one({"id": rid}, {"$push": {"driver_offers": offer}})
    await create_notification(r["consumer_id"], "consumer", "taxi_offer_new", "Nova oferta",
                              f"{u.get('name')} ofereceu R$ {offer['amount']:.2f}", "/taxi")
    return {"ok": True, "amount": offer["amount"]}


@router.post("/rides/{rid}/driver-offer")
async def driver_offer(rid: str, payload: OfferInput, user=Depends(deliverer_only)):
    # Contraproposta (valor próprio) — também vira uma oferta no marketplace.
    r = await _get_ride(rid)
    await ensure_can_accept(user["id"])
    if r["status"] != "searching":
        raise HTTPException(status_code=409, detail="Esta corrida não está mais disponível.")
    amt = round(float(payload.amount), 2)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Informe um valor válido.")
    u = await db.users.find_one({"id": user["id"]})
    loc = u.get("taxi_location")
    if not loc or not _driver_location_fresh(loc):
        raise HTTPException(status_code=400, detail="Sua localização não está atualizada. Ative o GPS e fique online novamente.")
    pickup = geo.route(loc, r["origin"]) if loc else None
    offer = _offer_obj(u, amt, pickup)
    await db.taxi_rides.update_one({"id": rid}, {"$pull": {"driver_offers": {"driver_id": user["id"]}}})
    await db.taxi_rides.update_one({"id": rid}, {"$push": {"driver_offers": offer}})
    await create_notification(r["consumer_id"], "consumer", "taxi_offer_new", "Nova oferta",
                              f"{u.get('name')} propôs R$ {amt:.2f}", "/taxi")
    return {"ok": True, "amount": amt}


@router.post("/rides/{rid}/driver-claim")
async def driver_claim(rid: str, user=Depends(deliverer_only)):
    # Aceitar corrida direto pelo valor pedido: assume o motorista e já coloca a corrida "a caminho".
    r = await _get_ride(rid)
    await ensure_can_accept(user["id"])
    if r["status"] != "searching":
        raise HTTPException(status_code=409, detail="Esta corrida não está mais disponível.")
    await _guard_one_active(user["id"], rid)
    u = await db.users.find_one({"id": user["id"]})
    loc = u.get("taxi_location")
    if not loc or not _driver_location_fresh(loc):
        raise HTTPException(status_code=400, detail="Sua localização não está atualizada. Ative o GPS e fique online novamente para aceitar corridas.")
    pickup = geo.route(loc, r["origin"]) if loc else None
    code = f"{random.randint(0, 9999):04d}"
    upd = {"driver_id": user["id"], "agreed_price": r["current_price"], "status": "accepted",
           "boarding_code": code, "accepted_at": now_iso(),
           "driver_vehicle_type": u.get("taxi_vehicle_type") or "carro",
           "driver_category": _norm_category(u.get("taxi_category"))}
    if pickup:
        upd["driver_location"] = loc
        upd["pickup_distance_km"] = pickup["distance_km"]
        upd["pickup_eta_min"] = pickup["duration_min"]
    res = await db.taxi_rides.update_one({"id": rid, "status": "searching"}, {"$set": upd})
    if res.modified_count == 0:
        raise HTTPException(status_code=409, detail="Corrida não está mais disponível.")
    await create_notification(r["consumer_id"], "consumer", "taxi_accepted", "Motorista a caminho!",
                              f"{u.get('name')} aceitou sua corrida.", "/taxi")
    await ws_hub.broadcast_role("deliverer", {"type": "taxi_event", "event": "queue_changed"})
    return strip_id(await _get_ride(rid))


class ChooseInput(BaseModel):
    driver_id: str


@router.post("/rides/{rid}/choose")
async def choose_offer(rid: str, payload: ChooseInput, user=Depends(consumer_only)):
    r = await _get_ride(rid)
    if r["consumer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Sem acesso a esta corrida.")
    if r["status"] != "searching":
        raise HTTPException(status_code=409, detail="Corrida não está mais disponível para escolha.")
    off = next((o for o in r.get("driver_offers", []) if o.get("driver_id") == payload.driver_id), None)
    if not off:
        raise HTTPException(status_code=404, detail="Oferta não encontrada.")
    busy = await db.taxi_rides.find_one({"driver_id": payload.driver_id, "status": {"$in": ["accepted", "arrived", "in_progress"]}})
    if busy:
        raise HTTPException(status_code=409, detail="Esse motorista ficou ocupado. Escolha outra oferta.")
    d = await db.users.find_one({"id": payload.driver_id})
    loc = d.get("taxi_location")
    if not loc or not _driver_location_fresh(loc):
        raise HTTPException(status_code=409, detail="Esse motorista está com a localização desatualizada. Escolha outra oferta.")
    pickup = geo.route(loc, r["origin"]) if loc else None
    code = f"{random.randint(0, 9999):04d}"
    upd = {"driver_id": payload.driver_id, "agreed_price": off["amount"], "status": "accepted",
           "boarding_code": code, "accepted_at": now_iso(),
           "driver_vehicle_type": d.get("taxi_vehicle_type") or "carro",
           "driver_category": _norm_category(d.get("taxi_category"))}
    if pickup:
        upd["driver_location"] = loc
        upd["pickup_distance_km"] = pickup["distance_km"]
        upd["pickup_eta_min"] = pickup["duration_min"]
    res = await db.taxi_rides.update_one({"id": rid, "status": "searching"}, {"$set": upd})
    if res.modified_count == 0:
        raise HTTPException(status_code=409, detail="Corrida não está mais disponível.")
    await create_notification(payload.driver_id, "deliverer", "taxi_chosen", "Você foi escolhido!",
                              "O passageiro escolheu sua oferta.", "/deliverer")
    await ws_hub.broadcast_role("deliverer", {"type": "taxi_event", "event": "queue_changed"})
    return strip_id(await _get_ride(rid))


@router.post("/rides/{rid}/arrived")
async def driver_arrived(rid: str, user=Depends(deliverer_only)):
    r = await _get_ride(rid)
    if r.get("driver_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Corrida de outro motorista.")
    if r["status"] != "accepted":
        raise HTTPException(status_code=400, detail="A corrida não está a caminho.")
    await db.taxi_rides.update_one({"id": rid}, {"$set": {"status": "arrived", "arrived_at": now_iso()}})
    await create_notification(r["consumer_id"], "consumer", "taxi_arrived", "Seu motorista chegou",
                              "O motorista está no ponto de embarque.", "/taxi")
    return strip_id(await _get_ride(rid))


class BoardInput(BaseModel):
    code: str


@router.post("/rides/{rid}/board")
async def board(rid: str, payload: BoardInput, user=Depends(deliverer_only)):
    r = await _get_ride(rid)
    if r.get("driver_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Corrida de outro motorista.")
    if r["status"] not in ("arrived", "accepted"):
        raise HTTPException(status_code=400, detail="Não é possível embarcar agora.")
    if (payload.code or "").strip() != (r.get("boarding_code") or ""):
        raise HTTPException(status_code=400, detail="Código de embarque incorreto.")
    await db.taxi_rides.update_one({"id": rid}, {"$set": {"status": "in_progress", "started_at": now_iso()}})
    await create_notification(r["consumer_id"], "consumer", "taxi_started", "Corrida iniciada",
                              "Boa viagem! Corrida em andamento.", "/taxi")
    return strip_id(await _get_ride(rid))


@router.post("/rides/{rid}/complete")
async def complete(rid: str, user=Depends(deliverer_only)):
    r = await _get_ride(rid)
    if r.get("driver_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Corrida de outro motorista.")
    if r["status"] != "in_progress":
        raise HTTPException(status_code=400, detail="A corrida não está em andamento.")
    final = r.get("agreed_price")
    prev = r.get("payment") or {}
    method = prev.get("method") if prev.get("method") in ("pix", "card", "cash") else "pix"
    await db.taxi_rides.update_one({"id": rid}, {"$set": {
        "status": "completed", "final_price": final, "completed_at": now_iso(),
        "payment": {"method": method, "status": "pending", "card_id": prev.get("card_id")}, "payment_notified": False,
    }})
    await db.users.update_one({"id": user["id"]}, {"$inc": {"taxi_rides_count": 1}})
    if r.get("consumer_id"):
        await db.users.update_one({"id": r["consumer_id"]}, {"$inc": {"rider_rides_count": 1}})
    _lbl = {"pix": "Pix", "card": "cartão de crédito", "cash": "dinheiro"}.get(method, "Pix")
    await create_notification(r["consumer_id"], "consumer", "taxi_completed", "Você chegou! 🏁",
                              f"Conclua o pagamento ({_lbl}). Valor: R$ {final:.2f}", "/taxi")
    return strip_id(await _get_ride(rid))


# perfil público do motorista (consumidor pode consultar)
@router.post("/rides/{rid}/driver-cancel")
async def driver_cancel(rid: str, payload: CancelInput, user=Depends(deliverer_only)):
    r = await _get_ride(rid)
    if r.get("driver_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Corrida de outro motorista.")
    if r["status"] in ("completed", "cancelled", "interrupted"):
        raise HTTPException(status_code=400, detail="Corrida já encerrada.")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Informe o motivo do cancelamento.")
    if r["status"] == "in_progress":
        cfg = await taxi_settings()
        traveled = None
        if r.get("driver_location"):
            leg = geo.route(r["origin"], r["driver_location"])
            traveled = leg["distance_km"]
        charge = round(float(cfg.get("taxi_min_fare") or 0), 2)
        await db.taxi_rides.update_one({"id": rid}, {"$set": {
            "status": "interrupted", "cancel_reason": reason, "cancelled_by": "driver",
            "interrupted_at": now_iso(), "completed_at": now_iso(),
            "distance_traveled_km": traveled, "final_price": charge,
        }})
        await create_notification(r["consumer_id"], "consumer", "taxi_interrupted", "Corrida interrompida",
                                  "O motorista interrompeu a corrida.", "/taxi")
        return {"ok": True, "status": "interrupted", "final_price": charge}
    # Pré-embarque: devolve a corrida ao pool para outro motorista.
    await db.taxi_rides.update_one({"id": rid}, {
        "$set": {"status": "searching", "driver_id": None, "driver_location": None,
                 "pickup_distance_km": None, "pickup_eta_min": None, "boarding_code": None,
                 "accepted_at": None},
        "$push": {"driver_cancellations": {"driver_id": user["id"], "reason": reason, "at": now_iso()}},
    })
    await create_notification(r["consumer_id"], "consumer", "taxi_driver_left", "Procurando outro motorista",
                              "O motorista cancelou. Estamos buscando outro para você.", "/taxi")
    return {"ok": True, "status": "searching"}


@router.get("/drivers/nearby")
async def drivers_nearby(lat: float, lng: float, category: Optional[str] = None, user=Depends(consumer_only)):
    """Motoristas 360Taxi online e DISPONÍVEIS próximos. Só posição aproximada (privacidade)."""
    cfg = await taxi_settings()
    busy = await db.taxi_rides.distinct("driver_id", {"status": {"$in": ["accepted", "arrived", "in_progress", "negotiating"]}})
    busy = set(b for b in busy if b)
    fav_rides = await db.taxi_rides.find({"consumer_id": user["id"], "status": "completed", "rating": {"$gte": 8}}).to_list(200)
    favorites = set(x["driver_id"] for x in fav_rides if x.get("driver_id"))
    drivers = await db.users.find({"role": "deliverer", "taxi_online": True, "taxi_location": {"$ne": None}}).to_list(300)
    out = []
    for d in drivers:
        if d["id"] in busy:
            continue
        dcat = _norm_category(d.get("taxi_category"))
        # Premium atende todas as categorias; demais só a própria.
        if category in CATEGORIES and dcat != category and dcat != "premium":
            continue
        loc = d.get("taxi_location")
        if not loc or not _driver_location_fresh(loc):
            continue
        if geo.haversine_km(lat, lng, loc["lat"], loc["lng"]) > cfg["taxi_search_radius_km"]:
            continue
        out.append({"lat": round(loc["lat"], 3), "lng": round(loc["lng"], 3),
                    "category": dcat, "favorite": d["id"] in favorites})  # sem id/nome (privacidade)
    return out


# ==================== CHAT DA CORRIDA ====================
class MessageInput(BaseModel):
    text: str


async def _participant_ride(rid, user):
    r = await _get_ride(rid)
    if user["id"] not in (r.get("consumer_id"), r.get("driver_id")):
        raise HTTPException(status_code=403, detail="Sem acesso a esta corrida.")
    return r


@router.get("/rides/{rid}/messages")
async def get_messages(rid: str, user=Depends(get_current_user)):
    r = await _participant_ride(rid, user)
    return r.get("messages", [])


@router.post("/rides/{rid}/messages")
async def post_message(rid: str, payload: MessageInput, user=Depends(get_current_user)):
    r = await _participant_ride(rid, user)
    if r["status"] not in ("negotiating", "accepted", "arrived", "in_progress"):
        raise HTTPException(status_code=400, detail="Chat disponível apenas durante a corrida.")
    text = (payload.text or "").strip()[:500]
    if not text:
        raise HTTPException(status_code=400, detail="Mensagem vazia.")
    msg = {"id": new_id(), "by_role": user["role"], "by_id": user["id"], "text": text, "at": now_iso()}
    await db.taxi_rides.update_one({"id": rid}, {"$push": {"messages": msg}})
    return msg


# ==================== PAINEL DE EMERGÊNCIA (ADMIN) ====================
@router.get("/admin/emergencies")
async def admin_emergencies(user=Depends(admin_only)):
    rides = await db.taxi_rides.find({"emergency": True}).sort("emergency_at", -1).to_list(200)
    out = []
    for r in rides:
        driver = await db.users.find_one({"id": r["driver_id"]}) if r.get("driver_id") else None
        out.append({
            "id": r["id"], "status": r["status"],
            "consumer_name": r.get("consumer_name"), "consumer_id": r.get("consumer_id"),
            "driver_name": (driver or {}).get("name") if driver else None,
            "emergency_at": r.get("emergency_at"),
            "origin": r.get("origin"), "destination": r.get("destination"),
            "driver_location": r.get("driver_location"),
        })
    return out


# perfil público do motorista (consumidor pode consultar)
@router.get("/driver/{driver_id}/profile")
async def public_driver_profile(driver_id: str, user=Depends(consumer_only)):
    u = await db.users.find_one({"id": driver_id, "role": "deliverer"})
    if not u:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")
    return _public_driver(u)
