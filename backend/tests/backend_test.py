"""OFF 360 backend end-to-end tests.

Covers: auth register/login/me, role isolation, consumer home/catalog,
QR + transaction flow, merchant dashboard/pending/confirm/stories/est-update,
admin overview/approve/settings/consumer-update.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://off360-preview.preview.emergentagent.com"
API = f"{BASE_URL}/api"

CONSUMER = {"email": "consumidor@off360.com", "password": "senha123"}
MERCHANT = {"email": "empresario@off360.com", "password": "senha123"}
ADMIN = {"email": "paulo.silva.dn.0006@gmail.com", "password": "Off360Admin!2026"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {creds['email']}: {r.status_code} {r.text}"
    # Grab bearer from cookie for Authorization header usage
    token = r.cookies.get("access_token")
    assert token, "no access_token cookie"
    return {"Authorization": f"Bearer {token}"}, r.json()


@pytest.fixture(scope="module")
def consumer_auth():
    return _login(CONSUMER)


@pytest.fixture(scope="module")
def merchant_auth():
    return _login(MERCHANT)


@pytest.fixture(scope="module")
def admin_auth():
    return _login(ADMIN)


# ---------------- health ----------------
def test_health():
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code == 200
    assert r.json().get("status") == "healthy"


# ---------------- auth ----------------
def test_register_new_consumer():
    email = f"test_c_{uuid.uuid4().hex[:8]}@off360.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": "Test Consumer", "email": email, "phone": "+5511900000000",
        "password": "senha123", "role": "consumer", "city": "SP", "neighborhood": "Centro",
    }, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["email"] == email
    assert data["role"] == "consumer"
    assert data.get("subscription_status") == "pending"


def test_register_new_merchant():
    email = f"TEST_m_{uuid.uuid4().hex[:8]}@off360.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": "Test Merchant", "email": email, "phone": "+5511911111111",
        "password": "senha123", "role": "merchant", "fantasy_name": "TEST Loja",
    }, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["role"] == "merchant"


def test_login_and_me_consumer(consumer_auth):
    headers, _ = consumer_auth
    r = requests.get(f"{API}/auth/me", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["role"] == "consumer"


def test_login_and_me_merchant(merchant_auth):
    headers, _ = merchant_auth
    r = requests.get(f"{API}/auth/me", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["role"] == "merchant"


def test_login_and_me_admin(admin_auth):
    headers, _ = admin_auth
    r = requests.get(f"{API}/auth/me", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_login_invalid():
    r = requests.post(f"{API}/auth/login", json={"email": "consumidor@off360.com", "password": "wrong"}, timeout=15)
    assert r.status_code == 401


# ---------------- role isolation ----------------
def test_role_isolation_consumer_cannot_merchant(consumer_auth):
    headers, _ = consumer_auth
    r = requests.get(f"{API}/merchant/dashboard", headers=headers, timeout=15)
    assert r.status_code == 403


def test_role_isolation_consumer_cannot_admin(consumer_auth):
    headers, _ = consumer_auth
    r = requests.get(f"{API}/admin/overview", headers=headers, timeout=15)
    assert r.status_code == 403


def test_role_isolation_merchant_cannot_consumer(merchant_auth):
    headers, _ = merchant_auth
    r = requests.get(f"{API}/consumer/home", headers=headers, timeout=15)
    assert r.status_code == 403


def test_role_isolation_merchant_cannot_admin(merchant_auth):
    headers, _ = merchant_auth
    r = requests.get(f"{API}/admin/overview", headers=headers, timeout=15)
    assert r.status_code == 403


# ---------------- consumer ----------------
def test_consumer_home(consumer_auth):
    headers, _ = consumer_auth
    r = requests.get(f"{API}/consumer/home", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ["greeting_name", "subscription", "categories", "stories", "featured",
              "month_saved", "ticket_count"]:
        assert k in d, f"missing key {k}"
    assert isinstance(d["categories"], list) and len(d["categories"]) > 0


def test_consumer_catalog(consumer_auth):
    headers, _ = consumer_auth
    r = requests.get(f"{API}/consumer/establishments?sort=discount", headers=headers, timeout=15)
    assert r.status_code == 200
    ests = r.json()
    assert isinstance(ests, list) and len(ests) > 0
    # only approved returned - can't check approval_status field since not exposed, but count should be >=6
    assert len(ests) >= 1
    # discount sort verification
    ds = [e.get("discount_percent", 0) for e in ests]
    assert ds == sorted(ds, reverse=True)


def test_consumer_catalog_filter(consumer_auth):
    headers, _ = consumer_auth
    r = requests.get(f"{API}/consumer/establishments?q=Cafeteria", headers=headers, timeout=15)
    assert r.status_code == 200
    ests = r.json()
    assert any("Cafeteria" in (e.get("fantasy_name") or "") for e in ests)


# ---------------- QR + transaction full flow ----------------
def test_full_qr_and_transaction_flow(consumer_auth, merchant_auth):
    c_headers, _ = consumer_auth
    m_headers, _ = merchant_auth

    # merchant qr
    r = requests.get(f"{API}/merchant/qr", headers=m_headers, timeout=15)
    assert r.status_code == 200
    qr_token = r.json()["qr_token"]
    assert qr_token

    # scan
    r = requests.post(f"{API}/consumer/scan", headers=c_headers, json={"qr_token": qr_token}, timeout=15)
    assert r.status_code == 200, r.text
    est = r.json()["establishment"]
    est_id = est["id"]
    discount_pct = est["discount_percent"]

    # create transaction
    gross = 100.0
    r = requests.post(f"{API}/consumer/transactions", headers=c_headers,
                      json={"establishment_id": est_id, "gross_amount": gross}, timeout=15)
    assert r.status_code == 200, r.text
    tx = r.json()
    tx_id = tx["id"]
    assert tx["status"] == "awaiting_confirmation"
    expected_discount = round(gross * discount_pct / 100, 2)
    assert tx["discount_amount"] == expected_discount
    assert tx["final_amount"] == round(gross - expected_discount, 2)

    # merchant sees pending
    r = requests.get(f"{API}/merchant/pending", headers=m_headers, timeout=15)
    assert r.status_code == 200
    pending_ids = [t["id"] for t in r.json()]
    assert tx_id in pending_ids

    # merchant transactions list - name leak check
    r = requests.get(f"{API}/merchant/transactions", headers=m_headers, timeout=15)
    assert r.status_code == 200
    for t in r.json():
        assert "consumer_name" not in t, "leak: full name exposed"
        assert "consumer_first_name" in t

    # confirm
    r = requests.post(f"{API}/merchant/transactions/{tx_id}/confirm", headers=m_headers, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"

    # consumer sees confirmed
    r = requests.get(f"{API}/consumer/transactions/{tx_id}", headers=c_headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "confirmed"


def test_scan_blocked_for_inactive_subscription(admin_auth, merchant_auth):
    """Register new consumer (pending), try scan -> 403."""
    a_headers, _ = admin_auth
    m_headers, _ = merchant_auth
    email = f"TEST_inactive_{uuid.uuid4().hex[:8]}@off360.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": "Inactive Consumer", "email": email, "phone": "+5511900001111",
        "password": "senha123", "role": "consumer",
    }, timeout=15)
    assert r.status_code == 200
    token = r.cookies.get("access_token")
    headers = {"Authorization": f"Bearer {token}"}

    qr_token = requests.get(f"{API}/merchant/qr", headers=m_headers).json()["qr_token"]
    r = requests.post(f"{API}/consumer/scan", headers=headers, json={"qr_token": qr_token}, timeout=15)
    assert r.status_code == 403


# ---------------- merchant ----------------
def test_merchant_dashboard(merchant_auth):
    headers, _ = merchant_auth
    r = requests.get(f"{API}/merchant/dashboard", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["establishment"]["fantasy_name"] == "Cafeteria Grão Nobre"
    for k in ["revenue", "discounts", "day_transactions", "chart", "recent"]:
        assert k in d


def test_merchant_stories_crud(merchant_auth):
    headers, _ = merchant_auth
    r = requests.post(f"{API}/merchant/stories", headers=headers, json={
        "category": "offer", "title": "TEST story", "text": "hello"
    }, timeout=15)
    assert r.status_code == 200
    sid = r.json()["id"]
    assert r.json()["expires_at"] > r.json()["created_at"]

    r = requests.get(f"{API}/merchant/stories", headers=headers, timeout=15)
    assert r.status_code == 200
    assert any(s["id"] == sid for s in r.json())

    r = requests.delete(f"{API}/merchant/stories/{sid}", headers=headers, timeout=15)
    assert r.status_code == 200


def test_merchant_est_update_discount_pending(merchant_auth):
    headers, _ = merchant_auth
    # Get current
    r = requests.get(f"{API}/merchant/establishment", headers=headers)
    cur = r.json()
    new_disc = (cur.get("discount_percent") or 15) + 5

    r = requests.put(f"{API}/merchant/establishment", headers=headers,
                     json={"discount_percent": new_disc, "description": "TEST updated"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("message") and "aprova" in body["message"].lower()
    # description should update but discount NOT
    assert body["establishment"]["description"] == "TEST updated"
    assert body["establishment"]["discount_percent"] == cur.get("discount_percent")


# ---------------- admin ----------------
def test_admin_overview(admin_auth):
    headers, _ = admin_auth
    r = requests.get(f"{API}/admin/overview", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ["total_consumers", "total_merchants", "pending_establishments",
              "total_transactions", "financial_volume"]:
        assert k in d
    assert d["total_consumers"] >= 1
    assert d["total_merchants"] >= 1


def test_admin_settings_update(admin_auth):
    headers, _ = admin_auth
    r = requests.put(f"{API}/admin/settings", headers=headers,
                     json={"consumer_plan_price": 19.9, "merchant_plan_price": 49.9,
                           "ticket_rule_type": "per_confirmed_purchase", "ticket_rule_value": 1}, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["consumer_plan_price"] == 19.9
    assert d["merchant_plan_price"] == 49.9


def test_admin_approve_establishment(admin_auth):
    headers, _ = admin_auth
    # find a pending est (from registered merchants in tests)
    r = requests.get(f"{API}/admin/establishments?status=pending", headers=headers)
    assert r.status_code == 200
    ests = r.json()
    if not ests:
        pytest.skip("no pending establishments to approve")
    eid = ests[0]["id"]
    r = requests.post(f"{API}/admin/establishments/{eid}/approve", headers=headers,
                      json={"approval_status": "approved"}, timeout=15)
    assert r.status_code == 200

    # verify audit log
    r = requests.get(f"{API}/admin/audit", headers=headers, timeout=15)
    assert r.status_code == 200
    logs = r.json()
    assert any(l.get("action_type") == "approve_establishment" and l.get("record") == eid for l in logs)


def test_admin_update_consumer_subscription(admin_auth):
    headers, _ = admin_auth
    r = requests.get(f"{API}/admin/consumers", headers=headers, timeout=15)
    assert r.status_code == 200
    consumers = r.json()
    # pick a TEST_ consumer
    target = next((c for c in consumers if c["email"].startswith("test_")), None)
    if not target:
        pytest.skip("no test consumer available")
    r = requests.put(f"{API}/admin/consumers/{target['id']}", headers=headers,
                     json={"subscription_status": "active"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["subscription_status"] == "active"
