"""E2E backend tests for the 360Taxi module.
Covers: quote, ride creation, driver online/offers/accept, boarding code (wrong+right),
complete, rate, and negotiation flow. Uses seeded QA accounts.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

CONSUMER = {"email": "paulo.silva.dn.06@gmail.com", "password": "Test123!"}
DRIVER = {"email": "fabricio@gmail.com", "password": "Test123!"}

CENTRO = {"lat": -22.7326, "lng": -47.3306, "address": "Centro"}
SHOPPING = {"lat": -22.755, "lng": -47.345, "address": "Shopping"}


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def consumer():
    return _login(**CONSUMER)


@pytest.fixture(scope="module")
def driver():
    return _login(**DRIVER)


@pytest.fixture(autouse=True)
def _cleanup_consumer_active(consumer):
    # cancel any active before each test
    r = consumer.get(f"{BASE_URL}/api/taxi/rides/active", timeout=10)
    if r.status_code == 200 and r.json():
        rid = r.json()["id"]
        consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", timeout=10)
    yield


def test_quote_returns_trip_and_price(consumer):
    r = consumer.post(f"{BASE_URL}/api/taxi/quote",
                      json={"origin": CENTRO, "destination": SHOPPING, "vehicle_type": "carro"}, timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert "trip" in d and "suggested_price" in d
    assert d["trip"]["distance_km"] > 0
    assert d["trip"]["duration_min"] > 0
    assert isinstance(d["trip"]["geometry"], list) and len(d["trip"]["geometry"]) >= 2
    assert d["suggested_price"] >= d["min_fare"]
    assert d["commission"] == 0


def test_full_ride_flow_with_wrong_and_correct_code(consumer, driver):
    # driver online at Centro nearby
    r = driver.post(f"{BASE_URL}/api/taxi/driver/online",
                    json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    assert r.status_code == 200

    # consumer creates ride (accept suggested)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                      json={"origin": CENTRO, "destination": SHOPPING, "vehicle_type": "carro"}, timeout=20)
    assert r.status_code == 200, r.text
    ride = r.json()
    rid = ride["id"]
    assert ride["status"] == "searching"

    # driver sees offer
    r = driver.get(f"{BASE_URL}/api/taxi/driver/offers", timeout=15)
    assert r.status_code == 200
    ids = [o["id"] for o in r.json()]
    assert rid in ids, f"driver should see ride {rid} in offers"

    # driver accepts
    r = driver.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=15)
    assert r.status_code == 200, r.text
    ride = r.json()
    assert ride["status"] == "accepted"
    assert ride["boarding_code"] and len(ride["boarding_code"]) == 4
    code = ride["boarding_code"]

    # driver arrived
    r = driver.post(f"{BASE_URL}/api/taxi/rides/{rid}/arrived", timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "arrived"

    # wrong code -> 400
    r = driver.post(f"{BASE_URL}/api/taxi/rides/{rid}/board", json={"code": "0000" if code != "0000" else "1111"}, timeout=15)
    assert r.status_code == 400

    # correct code -> in_progress
    r = driver.post(f"{BASE_URL}/api/taxi/rides/{rid}/board", json={"code": code}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "in_progress"

    # driver simulates location
    r = driver.post(f"{BASE_URL}/api/taxi/driver/location", json={"lat": -22.75, "lng": -47.34}, timeout=15)
    assert r.status_code == 200

    # complete
    r = driver.post(f"{BASE_URL}/api/taxi/rides/{rid}/complete", timeout=15)
    assert r.status_code == 200, r.text
    completed = r.json()
    assert completed["status"] == "completed"
    assert completed["final_price"] == completed["agreed_price"]

    # rate
    # need to fetch as consumer to know rating baseline
    before = driver.get(f"{BASE_URL}/api/taxi/driver/status", timeout=15).json()["profile"]
    r = consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/rate", json={"score": 9}, timeout=15)
    assert r.status_code == 200
    after = driver.get(f"{BASE_URL}/api/taxi/driver/status", timeout=15).json()["profile"]
    assert (after["rating_count"] or 0) == (before["rating_count"] or 0) + 1

    # invalid rating range
    r = consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/rate", json={"score": 4}, timeout=15)
    assert r.status_code == 400

    # take driver offline for cleanup
    driver.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": False}, timeout=10)


def test_negotiation_flow(consumer, driver):
    # driver online
    driver.post(f"{BASE_URL}/api/taxi/driver/online",
                json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)

    # consumer creates with low offer
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                      json={"origin": CENTRO, "destination": SHOPPING, "offer_price": 12.0}, timeout=20)
    assert r.status_code == 200
    rid = r.json()["id"]

    # driver counter-offers 16
    r = driver.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-offer", json={"amount": 16.0}, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "negotiating"
    assert d["current_price"] == 16.0

    # consumer accepts driver's price
    r = consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/accept-price", timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "accepted"

    # cleanup: cancel via consumer (ride is accepted -> can still cancel)
    consumer.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", timeout=10)
    driver.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": False}, timeout=10)


def test_public_track(consumer, driver):
    driver.post(f"{BASE_URL}/api/taxi/driver/online",
                json={"online": True, "lat": -22.7305, "lng": -47.3285}, timeout=15)
    r = consumer.post(f"{BASE_URL}/api/taxi/rides",
                     json={"origin": CENTRO, "destination": SHOPPING}, timeout=20)
    ride = r.json()
    token = ride["share_token"]
    # public endpoint (no auth)
    r = requests.get(f"{BASE_URL}/api/taxi/track/{token}", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] in ("searching", "accepted", "arrived", "in_progress")
    # cleanup
    consumer.post(f"{BASE_URL}/api/taxi/rides/{ride['id']}/cancel", timeout=10)
    driver.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": False}, timeout=10)
