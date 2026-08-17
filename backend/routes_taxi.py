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
                  create_notification, get_settings)
import geo

router = APIRouter(prefix="/api/taxi", tags=["taxi"])
consumer_only = require_role("consumer")
deliverer_only = require_role("deliverer")

TAXI_DEFAULTS = {
    "taxi_base_fare": 5.0,
    "taxi_min_fare": 8.0,
    "taxi_per_km": 2.5,
    "taxi_per_min": 0.5,
    "taxi_include_pickup": True,      # considera deslocamento motorista->consumidor no valor
    "taxi_max_negotiations": 3,       # limite de rodadas de negociação
    "taxi_search_radius_km": 12.0,    # raio para o motorista ver solicitações
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
    return {
        "id": u.get("id"), "name": u.get("name"), "photo_url": u.get("photo_url"),
        "rating": avg, "rating_count": cnt, "rides_count": u.get("taxi_rides_count") or 0,
        "vehicle": u.get("taxi_vehicle") or u.get("vehicle") or "carro",
        "plate": u.get("taxi_plate") or "",
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
        "boarding_code": None, "share_token": new_id(),
        "rating": None, "emergency": False,
        "status": "searching",
        "created_at": now_iso(), "accepted_at": None, "arrived_at": None,
        "started_at": None, "completed_at": None,
    }
    await db.taxi_rides.insert_one(dict(ride))
    return strip_id(ride)


@router.get("/rides/active")
async def consumer_active(user=Depends(consumer_only)):
    r = await db.taxi_rides.find_one({"consumer_id": user["id"], "status": {"$in": list(ACTIVE_STATUSES)}})
    if not r:
        return None
    driver = await db.users.find_one({"id": r["driver_id"]}) if r.get("driver_id") else None
    return _ride_out(r, driver)


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
    return {
        "status": r["status"], "origin": r["origin"], "destination": r["destination"],
        "trip_geometry": r.get("trip_geometry"), "driver_location": r.get("driver_location"),
        "driver_name": (driver or {}).get("name") if driver else None,
        "eta_min": r.get("pickup_eta_min") if r["status"] in ("accepted", "arrived") else r.get("trip_duration_min"),
    }


# ==================== MOTORISTA (360Taxi) ====================
class OnlineInput(BaseModel):
    online: bool
    lat: Optional[float] = None
    lng: Optional[float] = None


@router.post("/driver/online")
async def driver_online(payload: OnlineInput, user=Depends(deliverer_only)):
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
        await db.taxi_rides.update_one({"id": ride["id"]}, {"$set": upd})
    return {"ok": True}


@router.get("/driver/status")
async def driver_status(user=Depends(deliverer_only)):
    u = await db.users.find_one({"id": user["id"]})
    return {
        "online": bool(u.get("taxi_online")),
        "location": u.get("taxi_location"),
        "vehicle": u.get("taxi_vehicle") or u.get("vehicle") or "carro",
        "plate": u.get("taxi_plate") or "",
        "profile": _public_driver(u),
    }


class ProfileInput(BaseModel):
    vehicle: Optional[str] = None
    plate: Optional[str] = None


@router.post("/driver/profile")
async def driver_profile(payload: ProfileInput, user=Depends(deliverer_only)):
    upd = {}
    if payload.vehicle is not None:
        upd["taxi_vehicle"] = payload.vehicle
    if payload.plate is not None:
        upd["taxi_plate"] = payload.plate.upper()
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
    return {"ok": True}


@router.get("/driver/offers")
async def driver_offers(user=Depends(deliverer_only)):
    u = await db.users.find_one({"id": user["id"]})
    if not u.get("taxi_online") or not u.get("taxi_location"):
        return []
    # 1 corrida ativa por vez: se já tem corrida, não mostra novas ofertas
    active = await db.taxi_rides.find_one({"driver_id": user["id"], "status": {"$in": ["negotiating", "accepted", "arrived", "in_progress"]}})
    if active:
        return []
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
        item["driver_earning"] = r["current_price"]  # 100% ao motorista (comissão 0)
        out.append(item)
    out.sort(key=lambda x: x["pickup_distance_km"])  # mais próximos primeiro
    return out


@router.get("/driver/rides/active")
async def driver_active(user=Depends(deliverer_only)):
    r = await db.taxi_rides.find_one({"driver_id": user["id"], "status": {"$in": ["negotiating", "accepted", "arrived", "in_progress"]}})
    if not r:
        return None
    return strip_id(r)


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
    r = await _get_ride(rid)
    if r["status"] not in ("searching", "negotiating"):
        raise HTTPException(status_code=409, detail="Esta corrida não está mais disponível.")
    if r["status"] == "negotiating" and r.get("driver_id") not in (None, user["id"]):
        raise HTTPException(status_code=409, detail="Corrida em negociação com outro motorista.")
    await _guard_one_active(user["id"], rid)
    u = await db.users.find_one({"id": user["id"]})
    loc = u.get("taxi_location")
    pickup = geo.route(loc, r["origin"]) if loc else None
    code = f"{random.randint(0, 9999):04d}"
    upd = {
        "driver_id": user["id"], "agreed_price": r["current_price"], "status": "accepted",
        "boarding_code": code, "accepted_at": now_iso(),
    }
    if pickup:
        upd["driver_location"] = loc
        upd["pickup_distance_km"] = pickup["distance_km"]
        upd["pickup_eta_min"] = pickup["duration_min"]
    # trava atômica: só aceita se ainda estiver disponível
    res = await db.taxi_rides.update_one(
        {"id": rid, "status": {"$in": ["searching", "negotiating"]}}, {"$set": upd})
    if res.modified_count == 0:
        raise HTTPException(status_code=409, detail="Esta corrida já foi aceita.")
    await create_notification(r["consumer_id"], "consumer", "taxi_driver_found", "Motorista encontrado!",
                              f"{u.get('name')} aceitou sua corrida.", "/taxi")
    return strip_id(await _get_ride(rid))


@router.post("/rides/{rid}/driver-offer")
async def driver_offer(rid: str, payload: OfferInput, user=Depends(deliverer_only)):
    r = await _get_ride(rid)
    if r["status"] not in ("searching", "negotiating"):
        raise HTTPException(status_code=409, detail="Esta corrida não está mais disponível.")
    if r["status"] == "negotiating" and r.get("driver_id") not in (None, user["id"]):
        raise HTTPException(status_code=409, detail="Corrida em negociação com outro motorista.")
    await _guard_one_active(user["id"], rid)
    cfg = await taxi_settings()
    if r.get("negotiation_count", 0) >= cfg["taxi_max_negotiations"]:
        raise HTTPException(status_code=400, detail="Limite de negociações atingido.")
    amt = round(float(payload.amount), 2)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Informe um valor válido.")
    u = await db.users.find_one({"id": user["id"]})
    loc = u.get("taxi_location")
    pickup = geo.route(loc, r["origin"]) if loc else None
    offers = r.get("offers", []) + [{"by": "driver", "amount": amt, "at": now_iso()}]
    upd = {"driver_id": user["id"], "current_price": amt, "status": "negotiating",
           "offers": offers, "negotiation_count": len(offers)}
    if pickup:
        upd["pickup_distance_km"] = pickup["distance_km"]
        upd["pickup_eta_min"] = pickup["duration_min"]
    res = await db.taxi_rides.update_one(
        {"id": rid, "status": {"$in": ["searching", "negotiating"]}}, {"$set": upd})
    if res.modified_count == 0:
        raise HTTPException(status_code=409, detail="Esta corrida não está mais disponível.")
    await create_notification(r["consumer_id"], "consumer", "taxi_counter", "Contraproposta do motorista",
                              f"{u.get('name')} propôs R$ {amt:.2f}", "/taxi")
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
    await create_notification(r["consumer_id"], "consumer", "taxi_completed", "Você chegou! 🏁",
                              f"Obrigado por ir de 360Taxi. Valor: R$ {final:.2f}", "/taxi")
    return strip_id(await _get_ride(rid))


# perfil público do motorista (consumidor pode consultar)
@router.get("/driver/{driver_id}/profile")
async def public_driver_profile(driver_id: str, user=Depends(consumer_only)):
    u = await db.users.find_one({"id": driver_id, "role": "deliverer"})
    if not u:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")
    return _public_driver(u)
