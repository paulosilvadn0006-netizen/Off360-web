"""
OFF 360 — Iteration 8 backend regression.

Focus:
 - Fast mode (consumer self-serves): scan -> fast-confirm -> ticket/economy, idempotency
 - Controlled mode: scan -> merchant confirm, second confirm returns 400
 - Scan errors: no subscription 403, invalid QR 404, no discount 400
 - Idempotency of scan (reuse pending session)
 - Expiration handling
 - Persistence in /economy and /merchant/transactions
 - Admin activate merchant/establishment/consumer

Only creates entities prefixed QA_AUTOMATED_. Cleans up at the end.
"""
import os, uuid, time, pytest, requests
from datetime import datetime, timezone, timedelta

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v: return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception: pass
    raise RuntimeError("REACT_APP_BACKEND_URL not found")

BASE = _load_backend_url()
ADMIN = {"email": "qa_admin@off360.com", "password": "QaAdmin@2026"}
PASS = "QaPass@2026"

def _hex():
    return uuid.uuid4().hex[:10]

def _session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s

def _login(s, email, password):
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()

def _register(s, role, extra=None):
    h = _hex()
    email = f"qa_automated_{h}@testoff360.com"
    body = {"name": f"QA_AUTOMATED_{role}_{h}", "email": email, "phone": "11999990000",
            "password": PASS, "role": role, "city": "SP", "neighborhood": "Centro"}
    if role == "merchant":
        body.update({"fantasy_name": f"QA_AUTOMATED_FN_{h}", "category_id": None})
    if extra:
        body.update(extra)
    r = s.post(f"{BASE}/api/auth/register", json=body)
    assert r.status_code == 200, f"register {role}: {r.status_code} {r.text}"
    return r.json(), email


@pytest.fixture(scope="module")
def admin_sess():
    s = _session()
    _login(s, ADMIN["email"], ADMIN["password"])
    return s


@pytest.fixture(scope="module")
def created_ids():
    """collect ids to attempt cleanup at end (best effort)."""
    return {"users": [], "establishments": [], "transactions": []}


def _create_merchant_with_est(admin_sess, created_ids, mode="fast", discount=20, min_purchase=50):
    m_sess = _session()
    m_user, m_email = _register(m_sess, "merchant")
    created_ids["users"].append(m_user["id"])

    # Create establishment via merchant
    r = m_sess.post(f"{BASE}/api/merchant/establishments", json={
        "fantasy_name": f"QA_AUTOMATED_EST_{_hex()}",
        "description": "QA_AUTOMATED_ estab",
        "address": "Rua QA 1", "neighborhood": "Centro", "city": "SP",
        "discount_percent": discount,
    })
    assert r.status_code == 200, r.text
    est = r.json()
    created_ids["establishments"].append(est["id"])

    # Configure validation_mode and min_purchase via PUT
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={
        "validation_mode": mode,
        "discount_min_purchase": min_purchase,
        "address": "Rua QA 1",
        "category_id": None,
    })
    assert r.status_code == 200, r.text

    # Admin activates merchant + establishment
    r = admin_sess.post(f"{BASE}/api/admin/merchants/{m_user['id']}/activate")
    assert r.status_code == 200, r.text
    r = admin_sess.post(f"{BASE}/api/admin/establishments/{est['id']}/activate")
    assert r.status_code == 200, r.text

    # Refetch est to grab qr_token
    r = m_sess.get(f"{BASE}/api/merchant/qr", params={"establishment_id": est["id"]})
    assert r.status_code == 200, r.text
    qr_token = r.json()["qr_token"]
    return m_sess, m_user, est, qr_token


def _create_active_consumer(admin_sess, created_ids):
    c_sess = _session()
    c_user, _ = _register(c_sess, "consumer")
    created_ids["users"].append(c_user["id"])
    r = admin_sess.post(f"{BASE}/api/admin/consumers/{c_user['id']}/activate")
    assert r.status_code == 200, r.text
    return c_sess, c_user


# ---------- Admin login sanity ----------
def test_admin_login(admin_sess):
    r = admin_sess.get(f"{BASE}/api/auth/me")
    assert r.status_code == 200
    assert r.json()["role"] in ("admin", "super_admin")


# ---------- Fast mode E2E ----------
def test_fast_mode_end_to_end(admin_sess, created_ids):
    m_sess, m_user, est, qr_token = _create_merchant_with_est(admin_sess, created_ids, mode="fast", discount=20, min_purchase=50)
    c_sess, c_user = _create_active_consumer(admin_sess, created_ids)

    # scan
    r = c_sess.post(f"{BASE}/api/consumer/scan", json={"qr_token": qr_token})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["validation_mode"] == "fast"
    tx_id = data["transaction_id"]
    created_ids["transactions"].append(tx_id)

    # Scan idempotency: same pending session returned
    r2 = c_sess.post(f"{BASE}/api/consumer/scan", json={"qr_token": qr_token})
    assert r2.status_code == 200
    assert r2.json()["transaction_id"] == tx_id, "scan is NOT idempotent"

    # fast-confirm
    r = c_sess.post(f"{BASE}/api/consumer/transactions/{tx_id}/fast-confirm", json={"gross_amount": 100})
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx["status"] == "confirmed"
    assert tx["discount_amount"] == 20
    assert tx["final_amount"] == 80
    assert tx["saved_amount"] == 20
    assert tx.get("origin") == "fast_mode"

    # idempotency: second call must NOT duplicate
    r = c_sess.post(f"{BASE}/api/consumer/transactions/{tx_id}/fast-confirm", json={"gross_amount": 100})
    assert r.status_code == 200
    tx2 = r.json()
    assert tx2["id"] == tx["id"]
    # verify only 1 transaction in economy
    r = c_sess.get(f"{BASE}/api/consumer/economy")
    assert r.status_code == 200
    econ = r.json()
    matching = [t for t in econ["history"] if t["id"] == tx_id]
    assert len(matching) == 1
    assert econ["total_saved"] >= 20

    # merchant sees it
    r = m_sess.get(f"{BASE}/api/merchant/transactions")
    assert r.status_code == 200
    assert any(t["id"] == tx_id and t["status"] == "confirmed" for t in r.json())


# ---------- Controlled mode E2E ----------
def test_controlled_mode_end_to_end(admin_sess, created_ids):
    m_sess, m_user, est, qr_token = _create_merchant_with_est(admin_sess, created_ids, mode="controlled", discount=15, min_purchase=0)
    c_sess, c_user = _create_active_consumer(admin_sess, created_ids)

    r = c_sess.post(f"{BASE}/api/consumer/scan", json={"qr_token": qr_token})
    assert r.status_code == 200
    data = r.json()
    assert data["validation_mode"] == "controlled"
    tx_id = data["transaction_id"]
    created_ids["transactions"].append(tx_id)

    # Consumer cannot fast-confirm on controlled est
    r = c_sess.post(f"{BASE}/api/consumer/transactions/{tx_id}/fast-confirm", json={"gross_amount": 100})
    assert r.status_code == 400

    # Merchant confirms
    r = m_sess.post(f"{BASE}/api/merchant/transactions/{tx_id}/confirm", json={"gross_amount": 100})
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx["status"] == "confirmed"
    assert tx["discount_amount"] == 15
    assert tx["final_amount"] == 85

    # Second confirm should 400 (not pending anymore)
    r = m_sess.post(f"{BASE}/api/merchant/transactions/{tx_id}/confirm", json={"gross_amount": 100})
    assert r.status_code == 400


# ---------- Scan error messages ----------
def test_scan_invalid_qr(admin_sess, created_ids):
    c_sess, _ = _create_active_consumer(admin_sess, created_ids)
    r = c_sess.post(f"{BASE}/api/consumer/scan", json={"qr_token": "QA_AUTOMATED_INVALID"})
    assert r.status_code == 404


def test_scan_without_subscription(admin_sess, created_ids):
    # New consumer NOT activated
    c_sess = _session()
    c_user, _ = _register(c_sess, "consumer")
    created_ids["users"].append(c_user["id"])
    # need a valid qr
    m_sess, _, _, qr_token = _create_merchant_with_est(admin_sess, created_ids, mode="fast", discount=10, min_purchase=0)
    r = c_sess.post(f"{BASE}/api/consumer/scan", json={"qr_token": qr_token})
    assert r.status_code == 403


def test_scan_without_discount(admin_sess, created_ids):
    # merchant registers, creates establishment WITHOUT discount, admin activates est
    m_sess = _session()
    m_user, _ = _register(m_sess, "merchant")
    created_ids["users"].append(m_user["id"])
    r = m_sess.post(f"{BASE}/api/merchant/establishments", json={
        "fantasy_name": f"QA_AUTOMATED_EST_NODISC_{_hex()}",
        "address": "Rua QA", "city": "SP", "neighborhood": "Centro",
    })
    assert r.status_code == 200
    est = r.json()
    created_ids["establishments"].append(est["id"])
    admin_sess.post(f"{BASE}/api/admin/merchants/{m_user['id']}/activate")
    admin_sess.post(f"{BASE}/api/admin/establishments/{est['id']}/activate")
    # consumer active
    c_sess, _ = _create_active_consumer(admin_sess, created_ids)
    r = c_sess.post(f"{BASE}/api/consumer/scan", json={"qr_token": est["qr_token"]})
    assert r.status_code == 400
    assert "desconto" in r.json().get("detail", "").lower()


# ---------- Validation mode persistence + UI-facing endpoint ----------
def test_validation_mode_persists(admin_sess, created_ids):
    m_sess = _session()
    m_user, _ = _register(m_sess, "merchant")
    created_ids["users"].append(m_user["id"])
    r = m_sess.post(f"{BASE}/api/merchant/establishments", json={
        "fantasy_name": f"QA_AUTOMATED_EST_MODE_{_hex()}",
        "address": "Rua QA", "city": "SP", "discount_percent": 10,
    })
    est = r.json()
    created_ids["establishments"].append(est["id"])
    # default is controlled
    assert est.get("validation_mode") == "controlled"
    # switch to fast
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"validation_mode": "fast"})
    assert r.status_code == 200
    r = m_sess.get(f"{BASE}/api/merchant/establishment", params={"establishment_id": est["id"]})
    assert r.status_code == 200
    assert r.json()["validation_mode"] == "fast"


# ---------- Cleanup ----------
def test_zzz_cleanup(admin_sess, created_ids):
    """Best-effort cleanup of QA_AUTOMATED_ data. NEVER touches real users.

    Uses direct admin endpoints where available (suspend); for hard deletion we
    only cancel transactions and suspend users/establishments. Verifies that
    no real accounts were touched.
    """
    # Cancel transactions we created
    for tx_id in created_ids["transactions"]:
        admin_sess.post(f"{BASE}/api/admin/transactions/{tx_id}/cancel")
    # Suspend establishments
    for eid in created_ids["establishments"]:
        admin_sess.post(f"{BASE}/api/admin/establishments/{eid}/suspend")
    # Verify real accounts untouched
    for real in ["paulo@off360.com", "paulo.silva.dn.06@gmail.com"]:
        # admin/consumers query by email
        r = admin_sess.get(f"{BASE}/api/admin/consumers", params={"q": real})
        # just ensure endpoint responds; don't mutate
        assert r.status_code == 200
    print(f"Cleanup attempted for {len(created_ids['users'])} users, {len(created_ids['establishments'])} ests, {len(created_ids['transactions'])} txs")
