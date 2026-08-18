"""Backend tests for 360Taxi Stage 4 (FINAL):
- Driver profile vehicle_type set/get (carro/moto)
- /drivers/nearby filters by vehicle_type (moto vs carro) and returns vehicle_type + favorite
- driver_vehicle_type persisted in ride on accept, public_track returns it
- Chat messages: GET/POST /rides/{id}/messages (both participants)
- Favorite: after consumer rates >=8, driver appears with favorite=true on nearby
- Admin emergency: /admin/emergencies lists rides where emergency was triggered
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

CONSUMER = {"email": "paulo.silva.dn.06@gmail.com", "password": "Test123!"}
DRIVER_CAR = {"email": "fabricio@gmail.com", "password": "Test123!"}
DRIVER_MOTO = {"email": "qa_lk_d1@off360.com", "password": "Test123!"}
ADMIN = {"email": "paulo.silva.dn.0006@gmail.com", "password": "Test123!"}

CENTRO = {"lat": -22.7326, "lng": -47.3306, "address": "Centro"}
SHOPPING = {"lat": -22.755, "lng": -47.345, "address": "Shopping"}


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def consumer():
    return _login(**CONSUMER)


@pytest.fixture(scope="module")
def dcar():
    return _login(**DRIVER_CAR)


@pytest.fixture(scope="module")
def dmoto():
    return _login(**DRIVER_MOTO)


@pytest.fixture(scope="module")
def admin():
    return _login(**ADMIN)


def _cleanup_consumer(s):
    r = s.get(f"{BASE_URL}/api/taxi/rides/active", timeout=10)
    if r.status_code == 200 and r.json():
        s.post(f"{BASE_URL}/api/taxi/rides/{r.json()['id']}/cancel", json={"reason": "cleanup"}, timeout=10)


def _offline(s):
    s.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": False}, timeout=10)


def _set_vt(s, vt):
    s.post(f"{BASE_URL}/api/taxi/driver/profile", json={"vehicle_type": vt}, timeout=10)


@pytest.fixture(autouse=True)
def _reset(consumer, dcar, dmoto):
    _cleanup_consumer(consumer)
    _offline(dcar); _offline(dmoto)
    yield
    _cleanup_consumer(consumer)
    _offline(dcar); _offline(dmoto)


# ---------- 1) Driver profile vehicle_type ----------
def test_driver_profile_vehicle_type_persist(dcar):
    _set_vt(dcar, "moto")
    r = dcar.get(f"{BASE_URL}/api/taxi/driver/status", timeout=10)
    assert r.status_code == 200
    assert r.json().get("vehicle_type") == "moto"
    # revert
    _set_vt(dcar, "carro")
    r = dcar.get(f"{BASE_URL}/api/taxi/driver/status", timeout=10)
    assert r.json().get("vehicle_type") == "carro"


# ---------- 2) nearby filters by vehicle_type ----------
def test_nearby_filters_by_vehicle_type(consumer, dcar, dmoto):
    _set_vt(dcar, "carro"); _set_vt(dmoto, "moto")
    dcar.post(f"{BASE_URL}/api/taxi/driver/online",
              json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=10)
    dmoto.post(f"{BASE_URL}/api/taxi/driver/online",
               json={"online": True, "lat": -22.7307, "lng": -47.3287}, timeout=10)

    r = consumer.get(f"{BASE_URL}/api/taxi/drivers/nearby",
                     params={"lat": CENTRO["lat"], "lng": CENTRO["lng"], "vehicle_type": "moto"}, timeout=15)
    assert r.status_code == 200
    lst = r.json()
    assert len(lst) >= 1
    assert all(x.get("vehicle_type") == "moto" for x in lst)
    assert all("vehicle_type" in x and "favorite" in x for x in lst)

    r = consumer.get(f"{BASE_URL}/api/taxi/drivers/nearby",
                     params={"lat": CENTRO["lat"], "lng": CENTRO["lng"], "vehicle_type": "carro"}, timeout=15)
    assert r.status_code == 200
    lst2 = r.json()
    assert len(lst2) >= 1
    assert all(x.get("vehicle_type") == "carro" for x in lst2)


# ---------- 3) driver_vehicle_type persisted on ride ----------
def test_driver_vehicle_type_on_accept_and_public_track(consumer, dmoto):
    _set_vt(dmoto, "moto")
    dmoto.post(f"{BASE_URL}/api/taxi/driver/online",
               json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=10)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                      json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    share = r.json()["share_token"]
    r = dmoto.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    assert r.status_code == 200

    active = consumer.get(f"{BASE_URL}/api/taxi/rides/active", timeout=10).json()
    assert active.get("driver_vehicle_type") == "moto"

    tk = requests.get(f"{BASE_URL}/api/taxi/track/{share}", timeout=10).json()
    assert tk.get("driver_vehicle_type") == "moto"

    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "cleanup"}, timeout=10)


# ---------- 4) chat messages bidirectional ----------
def test_ride_chat_messages(consumer, dcar):
    _set_vt(dcar, "carro")
    dcar.post(f"{BASE_URL}/api/taxi/driver/online",
              json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=10)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                      json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    dcar.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)

    # consumer sends
    r = consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/messages",
                      json={"text": "Estou saindo agora"}, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "Estou saindo agora"
    assert r.json()["by_role"] == "consumer"

    # driver sees
    r = dcar.get(f"{BASE_URL}/api/taxi/rides/{rid}/messages", timeout=10)
    assert r.status_code == 200
    msgs = r.json()
    assert any(m["text"] == "Estou saindo agora" and m["by_role"] == "consumer" for m in msgs)

    # driver replies
    r = dcar.post(f"{BASE_URL}/api/taxi/rides/{rid}/messages",
                  json={"text": "Chego em 2 min"}, timeout=10)
    assert r.status_code == 200

    # consumer sees both
    msgs = consumer.get(f"{BASE_URL}/api/taxi/rides/{rid}/messages", timeout=10).json()
    assert len(msgs) >= 2
    assert any(m["by_role"] == "deliverer" for m in msgs)

    # empty rejected
    r = consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/messages", json={"text": " "}, timeout=10)
    assert r.status_code == 400

    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "cleanup"}, timeout=10)


def test_chat_only_participants(consumer, dcar, dmoto):
    _set_vt(dcar, "carro")
    dcar.post(f"{BASE_URL}/api/taxi/driver/online",
              json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=10)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                      json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    dcar.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)

    # a non-participant driver should NOT read
    r = dmoto.get(f"{BASE_URL}/api/taxi/rides/{rid}/messages", timeout=10)
    assert r.status_code == 403

    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "cleanup"}, timeout=10)


# ---------- 5) favorite driver after rating >=8 ----------
def test_favorite_driver_after_high_rating(consumer, dcar):
    _set_vt(dcar, "carro")
    dcar.post(f"{BASE_URL}/api/taxi/driver/online",
              json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=10)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                      json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    r = dcar.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    code = r.json()["boarding_code"]
    dcar.post(f"{BASE_URL}/api/taxi/rides/{rid}/arrived", timeout=10)
    dcar.post(f"{BASE_URL}/api/taxi/rides/{rid}/board", json={"code": code}, timeout=10)
    dcar.post(f"{BASE_URL}/api/taxi/rides/{rid}/complete", timeout=10)

    # rate 9
    r = consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/rate", json={"score": 9}, timeout=10)
    assert r.status_code == 200

    # driver back online (nearby again) -> should be favorite
    dcar.post(f"{BASE_URL}/api/taxi/driver/online",
              json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=10)
    lst = consumer.get(f"{BASE_URL}/api/taxi/drivers/nearby",
                       params={"lat": CENTRO["lat"], "lng": CENTRO["lng"]}, timeout=15).json()
    assert any(x.get("favorite") is True for x in lst), f"expected a favorite driver in {lst}"


# ---------- 6) admin emergencies list ----------
def test_admin_emergencies_lists(consumer, dcar, admin):
    _set_vt(dcar, "carro")
    dcar.post(f"{BASE_URL}/api/taxi/driver/online",
              json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=10)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                      json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    dcar.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)

    # trigger emergency
    r = consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/emergency", timeout=10)
    assert r.status_code == 200

    r = admin.get(f"{BASE_URL}/api/taxi/admin/emergencies", timeout=15)
    assert r.status_code == 200, r.text
    lst = r.json()
    entry = next((x for x in lst if x["id"] == rid), None)
    assert entry is not None
    assert entry.get("consumer_name")
    assert entry.get("driver_name")
    assert entry.get("emergency_at")
    assert entry.get("origin") and entry.get("destination")

    # non-admin cannot access
    r = consumer.get(f"{BASE_URL}/api/taxi/admin/emergencies", timeout=10)
    assert r.status_code in (401, 403)

    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "cleanup"}, timeout=10)
