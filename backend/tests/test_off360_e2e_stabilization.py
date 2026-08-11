"""OFF 360 e2e stabilization tests (iteration 4).

Covers:
- Role isolation (403) across consumer/merchant/admin endpoints
- Scan gating fix (subscription_status + discount_configured now enforced at /scan)
- Forced password change gate for demo admin (login response flags must_change_password
  and JWT still returned, but change is NOT completed to preserve reproducibility).
- Full transaction happy-path: consumer scan -> create tx -> merchant confirm -> polling
- Data preservation: Tamires / VETERINARIA - DR THAMIRES MARIANE untouched.
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

CONSUMER = {"email": "consumidor@off360.com", "password": "senha123"}
MERCHANT = {"email": "empresario@off360.com", "password": "senha123"}
ADMIN_OWNER = {"email": "paulo.silva.dn.0006@gmail.com", "password": "Off360Admin!2026"}
ADMIN_DEMO = {"email": "admin@off360.com", "password": "OffAdmin@Temp1"}


def _login(creds, expect=200):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == expect, f"login {creds['email']} -> {r.status_code}: {r.text}"
    if r.status_code != 200:
        return None, r
    tok = r.cookies.get("access_token") or r.json().get("access_token")
    assert tok, f"no token for {creds['email']}"
    return {"Authorization": f"Bearer {tok}"}, r


@pytest.fixture(scope="module")
def consumer_h():
    h, _ = _login(CONSUMER); return h


@pytest.fixture(scope="module")
def merchant_h():
    h, _ = _login(MERCHANT); return h


@pytest.fixture(scope="module")
def admin_h():
    h, _ = _login(ADMIN_OWNER); return h


# ------------------ Role isolation (403) ------------------
def test_consumer_cannot_access_merchant_routes(consumer_h):
    for path in ["/merchant/establishments", "/merchant/dashboard",
                 "/merchant/transactions", "/merchant/qr"]:
        r = requests.get(f"{API}{path}", headers=consumer_h, timeout=15)
        assert r.status_code in (401, 403), f"{path} -> {r.status_code}"


def test_consumer_cannot_access_admin_routes(consumer_h):
    for path in ["/admin/overview", "/admin/establishments",
                 "/admin/subscriptions", "/admin/consumers"]:
        r = requests.get(f"{API}{path}", headers=consumer_h, timeout=15)
        assert r.status_code in (401, 403), f"{path} -> {r.status_code}"


def test_merchant_cannot_access_consumer_routes(merchant_h):
    for path in ["/consumer/establishments", "/consumer/economy",
                 "/consumer/transactions/any"]:
        r = requests.get(f"{API}{path}", headers=merchant_h, timeout=15)
        assert r.status_code in (401, 403, 404), f"{path} -> {r.status_code}"
    # scan post
    r = requests.post(f"{API}/consumer/scan", headers=merchant_h,
                      json={"qr_token": "x"}, timeout=15)
    assert r.status_code in (401, 403)


def test_merchant_cannot_access_admin_routes(merchant_h):
    for path in ["/admin/overview", "/admin/establishments", "/admin/audit"]:
        r = requests.get(f"{API}{path}", headers=merchant_h, timeout=15)
        assert r.status_code in (401, 403), f"{path} -> {r.status_code}"


def test_admin_cannot_access_consumer_routes(admin_h):
    r = requests.get(f"{API}/consumer/establishments", headers=admin_h, timeout=15)
    assert r.status_code in (401, 403), r.status_code


def test_admin_cannot_access_merchant_routes(admin_h):
    r = requests.get(f"{API}/merchant/establishments", headers=admin_h, timeout=15)
    assert r.status_code in (401, 403), r.status_code


# ------------------ Registration flow ------------------
def test_register_consumer_ok():
    u = uuid.uuid4().hex[:6]
    email = f"TEST_cons_{u}@off360.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": f"TEST_Cons_{u}", "email": email, "phone": "+5511900000000",
        "password": "senha123", "role": "consumer",
    }, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["role"] == "consumer"
    # can login
    h, _ = _login({"email": email, "password": "senha123"})
    r2 = requests.get(f"{API}/auth/me", headers=h, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["email"] == email.lower()


def test_register_merchant_creates_pending_establishment():
    u = uuid.uuid4().hex[:6]
    email = f"TEST_merch_{u}@off360.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": f"TEST_Merch_{u}", "email": email, "phone": "+5511900000001",
        "password": "senha123", "role": "merchant",
        "fantasy_name": f"TEST_Store_{u}",
    }, timeout=15)
    assert r.status_code == 200, r.text
    h, _ = _login({"email": email, "password": "senha123"})
    r2 = requests.get(f"{API}/merchant/establishments", headers=h, timeout=15)
    assert r2.status_code == 200
    ests = r2.json()["establishments"]
    assert len(ests) >= 1
    assert any(e["approval_status"] == "pending" for e in ests)


# ------------------ Scan gating (fix verification) ------------------
def _get_qr(merchant_h, fantasy_substring):
    r = requests.get(f"{API}/merchant/establishments", headers=merchant_h, timeout=15)
    for e in r.json()["establishments"]:
        if fantasy_substring.lower() in (e.get("fantasy_name") or "").lower():
            # Fetch full est with qr_token via admin? Use merchant qr endpoint
            r2 = requests.get(f"{API}/merchant/qr?establishment_id={e['id']}",
                              headers=merchant_h, timeout=15)
            if r2.status_code == 200:
                return e, r2.json().get("qr_token")
    return None, None


def test_scan_configured_est_returns_200(consumer_h, merchant_h):
    e, qr = _get_qr(merchant_h, "Grão Nobre")
    assert qr, "Cafeteria Grão Nobre QR not found"
    r = requests.post(f"{API}/consumer/scan", headers=consumer_h,
                      json={"qr_token": qr}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["establishment"]["discount_percent"] == 15


def test_scan_no_discount_est_returns_400_configure_message(consumer_h, merchant_h):
    e, qr = _get_qr(merchant_h, "Unidade Teste 2")
    assert qr, "Unidade Teste 2 QR not found"
    r = requests.post(f"{API}/consumer/scan", headers=consumer_h,
                      json={"qr_token": qr}, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    assert "Configure" in r.text or "configure" in r.text.lower()


def test_scan_invalid_qr_returns_404(consumer_h):
    r = requests.post(f"{API}/consumer/scan", headers=consumer_h,
                      json={"qr_token": "nonexistent-qr-xxx"}, timeout=15)
    assert r.status_code == 404


# ------------------ Full transaction happy path ------------------
def test_full_transaction_flow(consumer_h, merchant_h):
    e, qr = _get_qr(merchant_h, "Grão Nobre")
    assert qr
    # Scan
    rs = requests.post(f"{API}/consumer/scan", headers=consumer_h,
                       json={"qr_token": qr}, timeout=15)
    assert rs.status_code == 200
    eid = rs.json()["establishment"]["id"]
    pct = rs.json()["establishment"]["discount_percent"]
    # Create tx
    gross = 100.0
    rt = requests.post(f"{API}/consumer/transactions", headers=consumer_h,
                       json={"establishment_id": eid, "gross_amount": gross}, timeout=15)
    assert rt.status_code == 200, rt.text
    tx = rt.json()
    expected_disc = round(gross * pct / 100, 2)
    assert tx["discount_amount"] == expected_disc
    assert tx["final_amount"] == round(gross - expected_disc, 2)
    assert tx["status"] == "awaiting_confirmation"
    tx_id = tx["id"]
    # Merchant confirms
    rc = requests.post(f"{API}/merchant/transactions/{tx_id}/confirm",
                       headers=merchant_h, timeout=15)
    assert rc.status_code == 200, rc.text
    # Consumer polls
    rg = requests.get(f"{API}/consumer/transactions/{tx_id}", headers=consumer_h, timeout=15)
    assert rg.status_code == 200
    assert rg.json()["status"] == "confirmed"


# ------------------ Forced password change (demo admin) ------------------
def test_demo_admin_login_flags_must_change_password():
    """Login should return must_change_password=True; DO NOT complete change."""
    r = requests.post(f"{API}/auth/login", json=ADMIN_DEMO, timeout=30)
    if r.status_code == 401:
        pytest.skip("demo admin temp password already consumed (needs seed reset)")
    assert r.status_code == 200, r.text
    d = r.json()
    # Field may be must_change_password or password_change_required
    assert (d.get("must_change_password") is True
            or d.get("password_change_required") is True
            or d.get("user", {}).get("must_change_password") is True), \
        f"must_change_password flag missing: {d}"


# ------------------ Data preservation ------------------
def test_tamires_veterinaria_preserved(admin_h):
    r = requests.get(f"{API}/admin/establishments", headers=admin_h, timeout=15)
    assert r.status_code == 200
    ests = r.json()
    tam = next((e for e in ests if "THAMIRES" in (e.get("fantasy_name") or "").upper()
                or "TAMIRES" in (e.get("fantasy_name") or "").upper()
                or "VETERINARIA" in (e.get("fantasy_name") or "").upper()
                or "VETERINÁRIA" in (e.get("fantasy_name") or "").upper()), None)
    assert tam is not None, "Tamires / VETERINÁRIA - DR THAMIRES MARIANE MISSING!"
    assert tam.get("discount_configured") is False
    assert tam.get("discount_percent") in (None, 0)


# ------------------ Merchant discount validation ------------------
def test_discount_validation_out_of_range(merchant_h):
    r = requests.get(f"{API}/merchant/establishments", headers=merchant_h, timeout=15)
    eid = r.json()["establishments"][0]["id"]
    for pct in [0, -5, 101, 150]:
        rr = requests.put(f"{API}/merchant/establishment/{eid}", headers=merchant_h,
                          json={"discount_percent": pct}, timeout=15)
        assert rr.status_code == 400, f"pct={pct} accepted (got {rr.status_code})"
