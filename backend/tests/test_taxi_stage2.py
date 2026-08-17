"""Backend tests for 360Taxi Stage 2:
- Sorted offers by pickup proximity
- Double-accept protection (409)
- 1 active ride per driver (offers hides new)
- Interrupted ride after boarding
- Consumer + driver history
- Public /track endpoint (no consumer_id leak)
- Admin PUT /settings persists taxi_* and /quote reflects new per_km
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

CONSUMER = {"email": "paulo.silva.dn.06@gmail.com", "password": "Test123!"}
DRIVER1 = {"email": "fabricio@gmail.com", "password": "Test123!"}
DRIVER2 = {"email": "qa_lk_d1@off360.com", "password": "Test123!"}
ADMIN = {"email": "paulo.silva.dn.0006@gmail.com", "password": "Test123!"}

CENTRO = {"lat": -22.7326, "lng": -47.3306, "address": "Centro"}
SHOPPING = {"lat": -22.755, "lng": -47.345, "address": "Shopping"}
RODOVIARIA = {"lat": -22.740, "lng": -47.340, "address": "Rodoviária"}


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
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


@pytest.fixture(scope="module")
def admin():
    return _login(**ADMIN)


def _cleanup_consumer(s):
    r = s.get(f"{BASE_URL}/api/taxi/rides/active", timeout=10)
    if r.status_code == 200 and r.json():
        s.post(f"{BASE_URL}/api/taxi/rides/{r.json()['id']}/cancel", json={"reason": "cleanup"}, timeout=10)


def _offline(s):
    s.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": False}, timeout=10)


@pytest.fixture(autouse=True)
def _reset_state(consumer, driver1, driver2):
    _cleanup_consumer(consumer)
    _offline(driver1)
    _offline(driver2)
    yield
    _cleanup_consumer(consumer)
    _offline(driver1)
    _offline(driver2)


# --------- 1) offers sorted by pickup distance ---------
def test_offers_sorted_by_proximity(consumer, driver1):
    # driver at Centro
    r = driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                     json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    assert r.status_code == 200

    # Create 1st ride from a farther origin
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                      json={"origin": SHOPPING, "destination": CENTRO}, timeout=20)
    assert r.status_code == 200, r.text
    rid_far = r.json()["id"]

    # cancel first (consumer only 1 active) then create nearer
    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid_far}/cancel", json={"reason": "swap"}, timeout=10)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    assert r.status_code == 200
    rid_near = r.json()["id"]

    r = driver1.get(f"{BASE_URL}/api/taxi/driver/offers", timeout=15)
    assert r.status_code == 200
    offers = r.json()
    assert len(offers) >= 1
    # each offer must include enrichment fields
    top = offers[0]
    for k in ("pickup_distance_km", "pickup_eta_min", "driver_earning",
              "trip_distance_km", "trip_duration_min", "destination"):
        assert k in top, f"missing {k}"
    # sorted asc by pickup_distance_km
    dists = [o["pickup_distance_km"] for o in offers]
    assert dists == sorted(dists)
    # near ride should be at top
    assert offers[0]["id"] == rid_near


# --------- 2) double-accept: 2nd driver gets 409, offer disappears ---------
def test_double_accept_prevented(consumer, driver1, driver2):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    driver2.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7310, "lng": -47.3290}, timeout=15)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    assert r.status_code == 200
    rid = r.json()["id"]

    # both see it
    o1 = driver1.get(f"{BASE_URL}/api/taxi/driver/offers", timeout=15).json()
    o2 = driver2.get(f"{BASE_URL}/api/taxi/driver/offers", timeout=15).json()
    assert any(o["id"] == rid for o in o1)
    assert any(o["id"] == rid for o in o2)

    # driver1 accepts
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    assert r.status_code == 200, r.text

    # driver2 tries -> 409
    r = driver2.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    assert r.status_code == 409, r.text

    # ride not in driver2 offers anymore
    o2b = driver2.get(f"{BASE_URL}/api/taxi/driver/offers", timeout=15).json()
    assert not any(o["id"] == rid for o in o2b)

    # driver1 has active; his offers empty (1 active per driver)
    o1b = driver1.get(f"{BASE_URL}/api/taxi/driver/offers", timeout=15).json()
    assert o1b == []

    # cleanup: cancel
    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "cleanup"}, timeout=10)


# --------- 3) Interrupted ride after boarding ---------
def test_interrupted_ride_after_boarding(consumer, driver1):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    rid = r.json()["id"]
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    assert r.status_code == 200
    code = r.json()["boarding_code"]
    driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/arrived", timeout=15)
    r = driver1.post(f"{BASE_URL}/api/taxi/rides/{rid}/board", json={"code": code}, timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "in_progress"

    # consumer interrupts (cancel while in_progress)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel",
                      json={"reason": "motorista rude"}, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "interrupted"
    assert d["final_price"] is not None and d["final_price"] > 0  # min_fare charged, not zero

    # appears in histories (consumer + driver) as interrupted
    hc = consumer.get(f"{BASE_URL}/api/taxi/rides/history", timeout=15).json()
    match = [r for r in hc if r["id"] == rid]
    assert match and match[0]["status"] == "interrupted"
    assert match[0].get("cancel_reason") == "motorista rude"

    hd = driver1.get(f"{BASE_URL}/api/taxi/driver/rides/history", timeout=15).json()
    match_d = [r for r in hd if r["id"] == rid]
    assert match_d and match_d[0]["status"] == "interrupted"


# --------- 4) Public track: no consumer_id leaked ---------
def test_public_track_no_leak(consumer, driver1):
    driver1.post(f"{BASE_URL}/api/taxi/driver/online",
                 json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    ride = r.json()
    token = ride["share_token"]

    # unauthenticated call
    r = requests.get(f"{BASE_URL}/api/taxi/track/{token}", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "status" in d and "origin" in d and "destination" in d
    assert "consumer_id" not in d
    assert "consumer_name" not in d
    assert "consumer_photo" not in d
    assert "boarding_code" not in d

    consumer.post(f"{BASE_URL}/api/taxi/rides/{ride['id']}/cancel", json={"reason": "cleanup"}, timeout=10)


# --------- 5) Admin PUT /settings persists taxi_* and quote reflects ---------
def test_admin_settings_persist_and_quote_reflects(admin, consumer):
    # get current
    r = admin.get(f"{BASE_URL}/api/admin/settings", timeout=15)
    assert r.status_code == 200
    orig = r.json()
    orig_km = orig.get("taxi_per_km") or 2.5

    new_km = 3.0 if orig_km != 3.0 else 3.5
    r = admin.put(f"{BASE_URL}/api/admin/settings",
                  json={"taxi_per_km": new_km, "taxi_min_fare": 8.0}, timeout=15)
    assert r.status_code == 200, r.text

    # confirm persisted
    r = admin.get(f"{BASE_URL}/api/admin/settings", timeout=15)
    assert r.json().get("taxi_per_km") == new_km

    # quote reflects
    r = consumer.post(f"{BASE_URL}/api/taxi/quote",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    assert r.status_code == 200
    q1 = r.json()

    # bump again and recompute
    r = admin.put(f"{BASE_URL}/api/admin/settings",
                  json={"taxi_per_km": new_km + 2.0}, timeout=15)
    assert r.status_code == 200
    r = consumer.post(f"{BASE_URL}/api/taxi/quote",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    q2 = r.json()
    assert q2["suggested_price"] > q1["suggested_price"], f"{q2} vs {q1}"

    # restore
    admin.put(f"{BASE_URL}/api/admin/settings", json={"taxi_per_km": orig_km}, timeout=15)
