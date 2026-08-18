"""360Taxi — módulo de corridas (separado das entregas). Prefixo /api/taxi.
Fluxo: cotação -> solicitação -> (negociação) -> aceite -> a caminho -> chegou ->
código de embarque -> em andamento -> finalização -> avaliação.
Comissão OFF360 = R$ 0,00 (valor da corrida vai integralmente ao motorista).
"""
import random
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core import (db, require_role, new_id, now_iso, strip_id,
                  create_notification, get_settings, get_current_user, ws_hub,
                  get_jwt_secret, JWT_ALGORITHM)
import jwt as _jwt
from fastapi import WebSocket, WebSocketDisconnect
import geo

router = APIRouter(prefix="/api/taxi", tags=["taxi"])
consumer_only = require_role("consumer")
deliverer_only = require_role("deliverer")
admin_only = require_role("admin")


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
}

ACTIVE_STATUSES = ("searching", "negotiating", "accepted", "arrived", "in_progress")


async def taxi_settings():
    s = await get_settings()
    out = dict(TAXI_DEFAULTS)
    for k in TAXI_DEFAULTS:
        if s.get(k) is not None:
            out[k] = s[k]
    return out


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
    vehicle_type: Optional[str] = "carro"


@router.post("/quote")
async def quote(payload: QuoteInput, user=Depends(consumer_only)):
    cfg = await taxi_settings()
    trip = geo.route(payload.origin.model_dump(), payload.destination.model_dump())
    suggested = compute_price(cfg, 0, 0, trip["distance_km"], trip["duration_min"])
    return {
        "trip": trip,
        "suggested_price": suggested,
        "min_fare": cfg["taxi_min_fare"],
        "commission": cfg["taxi_commission"],
        "max_negotiations": cfg["taxi_max_negotiations"],
    }


# ---------- Autocomplete de endereços + endereços salvos ----------
@router.get("/geocode")
async def taxi_geocode(q: str, user=Depends(consumer_only)):
    """Autocomplete de endereços por texto (usado nos campos de origem/destino)."""
    return geo.geocode(q)


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


class RideInput(BaseModel):
    origin: Point
    destination: Point
    vehicle_type: Optional[str] = "carro"
    offer_price: Optional[float] = None  # None = aceita o valor sugerido


@router.post("/rides")
async def create_ride(payload: RideInput, user=Depends(consumer_only)):
    existing = await db.taxi_rides.find_one({"consumer_id": user["id"], "status": {"$in": list(ACTIVE_STATUSES)}})
    if existing:
        raise HTTPException(status_code=400, detail="Você já tem uma corrida em andamento.")
    cfg = await taxi_settings()
    trip = geo.route(payload.origin.model_dump(), payload.destination.model_dump())
    suggested = compute_price(cfg, 0, 0, trip["distance_km"], trip["duration_min"])
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
        "vehicle_type": payload.vehicle_type or "carro",
        "trip_distance_km": trip["distance_km"], "trip_duration_min": trip["duration_min"],
        "trip_geometry": trip["geometry"], "route_provider": trip["provider"],
        "suggested_price": suggested, "current_price": price, "agreed_price": None,
        "final_price": None, "offers": offers, "negotiation_count": len(offers),
        "driver_id": None, "driver_location": None, "pickup_distance_km": None, "pickup_eta_min": None,
        "driver_offers": [],
        "boarding_code": None, "share_token": new_id(),
        "rating": None, "emergency": False,
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
        "modelo": u.get("taxi_modelo") or "", "cor": u.get("taxi_cor") or "",
        "plate": u.get("taxi_plate") or "", "ano": u.get("taxi_ano"), "portas": u.get("taxi_portas"),
        "cnh_number": u.get("taxi_cnh_number") or "", "cnh_validade": u.get("taxi_cnh_validade") or "",
        "ear": bool(u.get("taxi_ear")), "photo_3x4_url": u.get("taxi_photo_3x4_url") or "",
        "profile": _public_driver(u),
    }


class ProfileInput(BaseModel):
    vehicle: Optional[str] = None
    plate: Optional[str] = None
    vehicle_type: Optional[str] = None  # "carro" | "moto"


@router.post("/driver/profile")
async def driver_profile(payload: ProfileInput, user=Depends(deliverer_only)):
    upd = {}
    if payload.vehicle is not None:
        upd["taxi_vehicle"] = payload.vehicle
    if payload.plate is not None:
        upd["taxi_plate"] = payload.plate.upper()
    if payload.vehicle_type in ("carro", "moto"):
        upd["taxi_vehicle_type"] = payload.vehicle_type
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
    return {"ok": True}


class TaxiRegisterInput(BaseModel):
    photo_3x4_url: str
    cnh: Optional[str] = ""
    cnh_number: str
    cnh_validade: str
    ear: bool
    vehicle_type: str  # carro | moto
    modelo: str
    cor: str
    placa: str
    ano: int
    portas: int


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
    vt = payload.vehicle_type if payload.vehicle_type in ("carro", "moto") else "carro"
    if vt == "carro" and payload.portas < MIN_DOORS:
        raise HTTPException(status_code=400, detail=f"O veículo precisa ter no mínimo {MIN_DOORS} portas.")
    year = datetime.now(timezone.utc).year
    if year - int(payload.ano) > MAX_VEHICLE_AGE:
        raise HTTPException(status_code=400, detail=f"Regra OFF360: veículo com no máximo {MAX_VEHICLE_AGE} anos de fabricação.")
    upd = {
        "taxi_registered": True, "taxi_status": "em_analise",
        "taxi_photo_3x4_url": payload.photo_3x4_url,
        "taxi_cnh": payload.cnh or "", "taxi_cnh_number": payload.cnh_number,
        "taxi_cnh_validade": payload.cnh_validade, "taxi_ear": True,
        "taxi_vehicle_type": vt, "taxi_modelo": payload.modelo, "taxi_cor": payload.cor,
        "taxi_plate": payload.placa.upper(), "taxi_ano": int(payload.ano), "taxi_portas": int(payload.portas),
        "taxi_vehicle": payload.modelo, "taxi_region": "campinas",
    }
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    admins = await db.users.find({"role": "admin"}).to_list(50)
    for a in admins:
        await create_notification(a["id"], "admin", "taxi_new_driver", "Novo cadastro 360Taxi",
                                  f"{user.get('name')} enviou cadastro para análise.", "/admin/taxi-drivers")
    return {"ok": True, "status": "em_analise"}


# ==================== ADMIN — APROVAÇÃO DE MOTORISTAS ====================
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
    if not u.get("taxi_online") or not u.get("taxi_location"):
        return []
    # FILA: mostra solicitações mesmo com corrida ativa (motorista escolhe depois).
    cfg = await taxi_settings()
    loc = u["taxi_location"]
    rides = await db.taxi_rides.find({"status": "searching"}).sort("created_at", -1).to_list(50)
    out = []
    for r in rides:
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
    if r["status"] != "searching":
        raise HTTPException(status_code=409, detail="Esta corrida não está mais disponível.")
    u = await db.users.find_one({"id": user["id"]})
    loc = u.get("taxi_location")
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
    if r["status"] != "searching":
        raise HTTPException(status_code=409, detail="Esta corrida não está mais disponível.")
    amt = round(float(payload.amount), 2)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Informe um valor válido.")
    u = await db.users.find_one({"id": user["id"]})
    loc = u.get("taxi_location")
    pickup = geo.route(loc, r["origin"]) if loc else None
    offer = _offer_obj(u, amt, pickup)
    await db.taxi_rides.update_one({"id": rid}, {"$pull": {"driver_offers": {"driver_id": user["id"]}}})
    await db.taxi_rides.update_one({"id": rid}, {"$push": {"driver_offers": offer}})
    await create_notification(r["consumer_id"], "consumer", "taxi_offer_new", "Nova oferta",
                              f"{u.get('name')} propôs R$ {amt:.2f}", "/taxi")
    return {"ok": True, "amount": amt}


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
    pickup = geo.route(loc, r["origin"]) if loc else None
    code = f"{random.randint(0, 9999):04d}"
    upd = {"driver_id": payload.driver_id, "agreed_price": off["amount"], "status": "accepted",
           "boarding_code": code, "accepted_at": now_iso(),
           "driver_vehicle_type": d.get("taxi_vehicle_type") or "carro"}
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
    await db.taxi_rides.update_one({"id": rid}, {"$set": {
        "status": "completed", "final_price": final, "completed_at": now_iso(),
    }})
    await db.users.update_one({"id": user["id"]}, {"$inc": {"taxi_rides_count": 1}})
    if r.get("consumer_id"):
        await db.users.update_one({"id": r["consumer_id"]}, {"$inc": {"rider_rides_count": 1}})
    await create_notification(r["consumer_id"], "consumer", "taxi_completed", "Você chegou! 🏁",
                              f"Obrigado por ir de 360Taxi. Valor: R$ {final:.2f}", "/taxi")
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
async def drivers_nearby(lat: float, lng: float, vehicle_type: Optional[str] = None, user=Depends(consumer_only)):
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
        dvt = d.get("taxi_vehicle_type") or "carro"
        if vehicle_type in ("carro", "moto") and dvt != vehicle_type:
            continue
        loc = d.get("taxi_location")
        if not loc:
            continue
        if geo.haversine_km(lat, lng, loc["lat"], loc["lng"]) > cfg["taxi_search_radius_km"]:
            continue
        out.append({"lat": round(loc["lat"], 3), "lng": round(loc["lng"], 3),
                    "vehicle_type": dvt, "favorite": d["id"] in favorites})  # sem id/nome (privacidade)
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
