"""Backend tests for 360Taxi Stage 3:
- Driver cancel BEFORE boarding => ride returns to pool (status=searching, driver_id=None)
- Driver cancel AFTER boarding (in_progress) => interrupted, final_price=min_fare
- Driver cancel WITHOUT reason => 400
- /drivers/nearby: online available appears (rounded coords), busy is filtered out, offline is filtered out
- Driver location updates change pickup_eta (accepted) and remaining_eta/remaining_dist (in_progress)
- Public /taxi/track after interrupted => active=false, final_price>0, cancel_reason present
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

CONSUMER = {"email": "paulo.silva.dn.06@gmail.com", "password": "Test123!"}
DRIVER1 = {"email": "fabricio@gmail.com", "password": "Test123!"}
DRIVER2 = {"email": "qa_lk_d1@off360.com", "password": "Test123!"}

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
def driver1():
    return _login(**DRIVER1)


@pytest.fixture(scope="module")
def driver2():
    return _login(**DRIVER2)


def _cleanup_consumer(s):
    r = s.get(f"{BASE_URL}/api/taxi/rides/active", timeout=10)
    if r.status_code == 200 and r.json():
        s.post(f"{BASE_URL}/api/taxi/rides/{r.json()['id']}/cancel", json={"reason": "cleanup"}, timeout=10)


def _offline(s):
    s.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": False}, timeout=10)


@pytest.fixture(autouse=True)
def _reset(consumer, driver1, driver2):
    _cleanup_consumer(consumer)
    _offline(driver1); _offline(driver2)
    yield
    _cleanup_consumer(consumer)
    _offline(driver1); _offline(driver2)


# ---------- 1) drivers/nearby ----------
def test_nearby_online_available(consumer, driver1, driver2):
    # both offline first -> nearby=0
    r = consumer.get(f"{BASE_URL}/api/taxi/drivers/nearby",
                     params={"lat": CENTRO["lat"], "lng": CENTRO["lng"]}, timeout=15)
    assert r.status_code == 200
    base_count = len(r.json())

    # driver1 online near centro
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r = consumer.get(f"{BASE_URL}/api/taxi/drivers/nearby",
                     params={"lat": CENTRO["lat"], "lng": CENTRO["lng"]}, timeout=15)
    assert r.status_code == 200
    lst = r.json()
    assert len(lst) == base_count + 1
    top = lst[-1]
    # rounded to ~3 decimals, no id/name leak
    assert {"lat", "lng"}.issubset(set(top.keys()))
    # stage4: also returns vehicle_type + favorite; no id/name leak
    assert "id" not in top and "name" not in top
    assert round(top["lat"], 3) == top["lat"]
    assert round(top["lng"], 3) == top["lng"]


def test_nearby_hides_busy_driver(consumer, driver1):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r0 = consumer.get(f"{BASE_URL}/api/taxi/drivers/nearby",
                     params={"lat": CENTRO["lat"], "lng": CENTRO["lng"]}, timeout=15).json()
    n0 = len(r0)
    # create + accept -> driver becomes busy
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    assert r.status_code == 200
    r1 = consumer.get(f"{BASE_URL}/api/taxi/drivers/nearby",
                     params={"lat": CENTRO["lat"], "lng": CENTRO["lng"]}, timeout=15).json()
    assert len(r1) == n0 - 1
    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "cleanup"}, timeout=10)


def test_nearby_hides_offline_driver(consumer, driver1):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    n1 = len(consumer.get(f"{BASE_URL}/api/taxi/drivers/nearby",
                          params={"lat": CENTRO["lat"], "lng": CENTRO["lng"]}, timeout=15).json())
    _offline(driver1)
    n2 = len(consumer.get(f"{BASE_URL}/api/taxi/drivers/nearby",
                          params={"lat": CENTRO["lat"], "lng": CENTRO["lng"]}, timeout=15).json())
    assert n2 == n1 - 1


# ---------- 2) driver-cancel BEFORE boarding -> back to pool ----------
def test_driver_cancel_pre_boarding_returns_to_pool(consumer, driver1):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    assert r.status_code == 200

    # cancel with reason
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-cancel",
                    json={"reason": "Emergencia veiculo"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "searching"

    # consumer active shows searching (no driver)
    ra = consumer.get(f"{BASE_URL}/api/taxi/rides/active", timeout=15)
    assert ra.status_code == 200
    active = ra.json()
    assert active and active["id"] == rid
    assert active["status"] == "searching"
    assert active.get("driver_id") in (None, "")
    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "cleanup"}, timeout=10)


# ---------- 3) driver-cancel POST-boarding => interrupted with min_fare ----------
def test_driver_cancel_post_boarding_interrupted(consumer, driver1):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    code = r.json()["boarding_code"]
    driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/arrived", timeout=15)
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/board", json={"code": code}, timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "in_progress"

    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-cancel",
                    json={"reason": "Passageiro rude"}, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "interrupted"
    assert d["final_price"] > 0

    # public track reflects
    ride = consumer.get(f"{BASE_URL}/api/taxi/rides/history", timeout=15).json()
    match = [x for x in ride if x["id"] == rid]
    assert match and match[0]["status"] == "interrupted"
    assert match[0].get("cancel_reason") == "Passageiro rude"

    token = match[0]["share_token"]
    r = requests.get(f"{BASE_URL}/api/taxi/track/{token}", timeout=15)
    assert r.status_code == 200
    tk = r.json()
    assert tk["status"] == "interrupted"
    assert tk["active"] is False
    assert tk["final_price"] and tk["final_price"] > 0
    assert tk["cancel_reason"] == "Passageiro rude"


# ---------- 4) driver-cancel without reason => 400 ----------
def test_driver_cancel_requires_reason(consumer, driver1):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)

    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-cancel",
                    json={"reason": ""}, timeout=15)
    assert r.status_code == 400, r.text
    # cleanup
    driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-cancel",
                json={"reason": "cleanup"}, timeout=15)


# ---------- 5) driver location updates ETA (accepted -> pickup_eta) ----------
def test_live_eta_pickup_updates(consumer, driver1):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    assert r.status_code == 200
    pickup_eta_1 = r.json().get("pickup_eta_min")

    # Move driver much farther
    driver1.post(f"{BASE_URL}/api/taxi/driver/location",
                json={"lat": -22.60, "lng": -47.20}, timeout=15)
    active = consumer.get(f"{BASE_URL}/api/taxi/rides/active", timeout=15).json()
    pickup_eta_2 = active.get("pickup_eta_min")
    assert pickup_eta_1 is not None and pickup_eta_2 is not None
    assert pickup_eta_2 > pickup_eta_1

    # complete cleanup
    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "cleanup"}, timeout=10)


# ---------- 6) in_progress remaining eta present ----------
def test_live_remaining_eta_in_progress(consumer, driver1):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    code = r.json()["boarding_code"]
    driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/arrived", timeout=15)
    driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/board", json={"code": code}, timeout=15)

    # simulate driver movement -> in_progress must update remaining_*
    driver1.post(f"{BASE_URL}/api/taxi/driver/location",
                json={"lat": -22.740, "lng": -47.330}, timeout=15)
    active = consumer.get(f"{BASE_URL}/api/taxi/rides/active", timeout=15).json()
    assert active is not None
    assert active.get("remaining_distance_km") is not None
    assert active.get("remaining_eta_min") is not None

    # cleanup: interrupt
    driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-cancel",
                json={"reason": "cleanup"}, timeout=15)
