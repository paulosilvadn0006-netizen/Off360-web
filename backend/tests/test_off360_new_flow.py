"""OFF 360 iteration 5 — new purchase flow tests.

New flow requirements:
- Consumer POST /api/consumer/scan with valid QR of a configured establishment
  must create a `pending_validation` session and return {transaction_id, ...}.
- No consumer endpoint accepts a gross_amount from consumer anymore.
- Merchant POST /api/merchant/transactions/{tx_id}/confirm with gross_amount:
    * < min_purchase => 400 with "compras a partir de R$ X.XX"
    * cap applied when gross*pct/100 > cap
- Blocks: unknown QR => 404 "QR Code inválido...", no discount => 400
  "não configurou as condições do desconto.", inactive consumer => 403
  "Sua assinatura não está ativa..."
- super_admin login redirects (must_change_password=True). We DO NOT complete
  the change to preserve the temporary password.
"""
import os
import re
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

CONSUMER = {"email": "consumidor@off360.com", "password": "senha123"}
MERCHANT = {"email": "empresario@off360.com", "password": "senha123"}
ADMIN_LEGACY = {"email": "paulo.silva.dn.0006@gmail.com", "password": "Off360Admin!2026"}
SUPER = {"email": "proprietario@off360.com", "password": "Off360!Prop#2f9K"}


def _login(creds, expect=200):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == expect, f"{creds['email']} -> {r.status_code}: {r.text}"
    if r.status_code != 200:
        return None, r
    tok = r.cookies.get("access_token") or r.json().get("access_token")
    return {"Authorization": f"Bearer {tok}"}, r


@pytest.fixture(scope="module")
def consumer_h():
    h, _ = _login(CONSUMER); return h


@pytest.fixture(scope="module")
def merchant_h():
    h, _ = _login(MERCHANT); return h


@pytest.fixture(scope="module")
def admin_h():
    h, _ = _login(ADMIN_LEGACY); return h


def _get_qr(merchant_h, fantasy_substring):
    r = requests.get(f"{API}/merchant/establishments", headers=merchant_h, timeout=15)
    for e in r.json()["establishments"]:
        if fantasy_substring.lower() in (e.get("fantasy_name") or "").lower():
            r2 = requests.get(f"{API}/merchant/qr?establishment_id={e['id']}",
                              headers=merchant_h, timeout=15)
            if r2.status_code == 200:
                return e, r2.json().get("qr_token")
    return None, None


# --------- super_admin login flag + must_change_password ---------
def test_super_admin_login_flags_password_change():
    r = requests.post(f"{API}/auth/login", json=SUPER, timeout=30)
    if r.status_code == 401:
        pytest.skip("super_admin temp password already consumed")
    assert r.status_code == 200, r.text
    d = r.json()
    flag = (d.get("must_change_password") or d.get("password_change_required")
            or d.get("user", {}).get("must_change_password"))
    assert flag is True, f"must_change_password flag missing: {d}"
    role = d.get("role") or (d.get("user") or {}).get("role")
    assert role == "super_admin", d


def test_super_admin_isolated_when_super_role_used(admin_h):
    """super_admin (or admin) can hit /admin/overview."""
    r = requests.get(f"{API}/admin/overview", headers=admin_h, timeout=15)
    assert r.status_code == 200


# --------- scan → creates pending_validation ---------
def test_scan_creates_pending_validation_session(consumer_h, merchant_h):
    _, qr = _get_qr(merchant_h, "Grão Nobre")
    assert qr, "Cafeteria Grão Nobre QR missing"
    r = requests.post(f"{API}/consumer/scan", headers=consumer_h,
                      json={"qr_token": qr}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "transaction_id" in d, d
    # Consumer can then fetch the transaction and see pending_validation
    tx_id = d["transaction_id"]
    rg = requests.get(f"{API}/consumer/transactions/{tx_id}", headers=consumer_h, timeout=15)
    assert rg.status_code == 200
    tx = rg.json()
    assert tx["status"] == "pending_validation"
    assert tx.get("gross_amount") in (None, 0)
    assert tx.get("transaction_code")
    assert tx.get("discount_percent") == 15


def test_scan_unknown_qr_returns_404(consumer_h):
    r = requests.post(f"{API}/consumer/scan", headers=consumer_h,
                      json={"qr_token": "nonexistent-qr-xxx"}, timeout=15)
    assert r.status_code == 404
    assert "QR Code inválido" in r.text or "não reconhecido" in r.text


def test_scan_no_discount_configured_returns_400(consumer_h, merchant_h):
    _, qr = _get_qr(merchant_h, "Unidade Teste 2")
    if not qr:
        # fallback to any TEST_NoDisc_ if present
        r = requests.get(f"{API}/merchant/establishments", headers=merchant_h).json()
        for e in r["establishments"]:
            if not e.get("discount_configured"):
                _, qr = _get_qr(merchant_h, e["fantasy_name"])
                break
    assert qr, "no unconfigured est available"
    r = requests.post(f"{API}/consumer/scan", headers=consumer_h,
                      json={"qr_token": qr}, timeout=15)
    assert r.status_code == 400, r.text
    assert "configurou" in r.text.lower() or "configure" in r.text.lower()


# --------- merchant confirm: min_purchase / cap ---------
def _make_pending_tx(consumer_h, merchant_h):
    _, qr = _get_qr(merchant_h, "Grão Nobre")
    r = requests.post(f"{API}/consumer/scan", headers=consumer_h,
                      json={"qr_token": qr}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["transaction_id"]


def test_confirm_below_min_purchase_returns_400(consumer_h, merchant_h):
    # Configure a min_purchase on Grão Nobre for this test
    r = requests.get(f"{API}/merchant/establishments", headers=merchant_h).json()
    est = next(e for e in r["establishments"] if "grão nobre" in (e.get("fantasy_name") or "").lower())
    original_min = est.get("discount_min_purchase")
    original_cap = est.get("discount_max_cap")
    try:
        requests.put(f"{API}/merchant/establishment/{est['id']}", headers=merchant_h,
                     json={"discount_min_purchase": 50.0, "discount_max_cap": None}, timeout=15)
        tx_id = _make_pending_tx(consumer_h, merchant_h)
        r = requests.post(f"{API}/merchant/transactions/{tx_id}/confirm",
                          headers=merchant_h, json={"gross_amount": 20.0}, timeout=15)
        assert r.status_code == 400, r.text
        # message contains R$ 50
        assert re.search(r"R\$\s*50", r.text), r.text
    finally:
        requests.put(f"{API}/merchant/establishment/{est['id']}", headers=merchant_h,
                     json={"discount_min_purchase": original_min,
                           "discount_max_cap": original_cap}, timeout=15)


def test_confirm_cap_applied(consumer_h, merchant_h):
    r = requests.get(f"{API}/merchant/establishments", headers=merchant_h).json()
    est = next(e for e in r["establishments"] if "grão nobre" in (e.get("fantasy_name") or "").lower())
    original_min = est.get("discount_min_purchase")
    original_cap = est.get("discount_max_cap")
    try:
        requests.put(f"{API}/merchant/establishment/{est['id']}", headers=merchant_h,
                     json={"discount_min_purchase": 0, "discount_max_cap": 5.0}, timeout=15)
        tx_id = _make_pending_tx(consumer_h, merchant_h)
        # 200 * 15% = 30, but cap = 5
        r = requests.post(f"{API}/merchant/transactions/{tx_id}/confirm",
                          headers=merchant_h, json={"gross_amount": 200.0}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["discount_amount"] == 5.0, d
        assert d["final_amount"] == 195.0, d
        assert d["status"] == "confirmed"
    finally:
        requests.put(f"{API}/merchant/establishment/{est['id']}", headers=merchant_h,
                     json={"discount_min_purchase": original_min,
                           "discount_max_cap": original_cap}, timeout=15)


def test_confirm_happy_path_transitions_consumer_view(consumer_h, merchant_h):
    tx_id = _make_pending_tx(consumer_h, merchant_h)
    # Confirm
    r = requests.post(f"{API}/merchant/transactions/{tx_id}/confirm",
                      headers=merchant_h, json={"gross_amount": 100.0}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "confirmed"
    assert d["gross_amount"] == 100.0
    # Consumer polls
    rg = requests.get(f"{API}/consumer/transactions/{tx_id}", headers=consumer_h, timeout=15)
    assert rg.status_code == 200
    assert rg.json()["status"] == "confirmed"


# --------- role isolation quick spot-check ---------
def test_merchant_forbidden_on_consumer_scan(merchant_h):
    r = requests.post(f"{API}/consumer/scan", headers=merchant_h,
                      json={"qr_token": "x"}, timeout=15)
    assert r.status_code in (401, 403)


def test_consumer_forbidden_on_merchant_confirm(consumer_h):
    r = requests.post(f"{API}/merchant/transactions/anytx/confirm",
                      headers=consumer_h, json={"gross_amount": 1.0}, timeout=15)
    assert r.status_code in (401, 403)


# --------- persistence: consumer economy survives across sessions ---------
def test_consumer_economy_persists(consumer_h):
    r1 = requests.get(f"{API}/consumer/economy", headers=consumer_h, timeout=15)
    assert r1.status_code == 200
    d1 = r1.json()
    # Re-login and re-check
    h2, _ = _login(CONSUMER)
    r2 = requests.get(f"{API}/consumer/economy", headers=h2, timeout=15)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2.get("total_saved") == d1.get("total_saved")
