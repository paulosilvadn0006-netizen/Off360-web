"""OFF 360 refactor tests: multi-establishment merchant, per-establishment
subscription/discount gating, admin overview counters, admin subscriptions
table, per-establishment activation isolation, single-button consumer activation.
"""
import os
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

CONSUMER = {"email": "consumidor@off360.com", "password": "senha123"}
MERCHANT = {"email": "empresario@off360.com", "password": "senha123"}
ADMIN = {"email": "paulo.silva.dn.0006@gmail.com", "password": "Off360Admin!2026"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.cookies.get("access_token")
    assert tok
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def consumer_h():
    return _login(CONSUMER)


@pytest.fixture(scope="module")
def merchant_h():
    return _login(MERCHANT)


@pytest.fixture(scope="module")
def admin_h():
    return _login(ADMIN)


# ---------------- Admin overview counters ----------------
def test_overview_total_users_equals_consumers_plus_merchants(admin_h):
    r = requests.get(f"{API}/admin/overview", headers=admin_h, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ["total_users", "total_consumers", "total_merchants",
              "total_establishments", "active_establishments",
              "pending_establishments", "suspended_establishments"]:
        assert k in d, f"missing key {k}"
    assert d["total_users"] == d["total_consumers"] + d["total_merchants"]
    # establishments should be counted separately, NOT part of total_users
    assert d["total_establishments"] >= 0


# ---------------- Merchant multi-establishment ----------------
def test_merchant_list_establishments(merchant_h):
    r = requests.get(f"{API}/merchant/establishments", headers=merchant_h, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["limit"] == 10
    assert "count" in d
    assert isinstance(d["establishments"], list)
    assert d["count"] == len(d["establishments"])


def test_merchant_create_establishment_pending_null_discount(merchant_h):
    unique = uuid.uuid4().hex[:6]
    r = requests.post(f"{API}/merchant/establishments", headers=merchant_h,
                      json={"fantasy_name": f"TEST_Est_{unique}",
                            "neighborhood": "Centro", "city": "SP"}, timeout=15)
    if r.status_code == 400 and "Limite" in r.text:
        pytest.skip("merchant already at 10-establishment limit")
    assert r.status_code == 200, r.text
    est = r.json()
    assert est["subscription_status"] == "pending"
    assert est["discount_configured"] is False
    assert est.get("discount_percent") in (None, 0) or est["discount_percent"] is None
    assert est["approval_status"] == "pending"
    # Store for later tests
    pytest.new_est_id = est["id"]
    pytest.new_est_qr = est["qr_token"]


def test_merchant_discount_range_validation(merchant_h):
    eid = getattr(pytest, "new_est_id", None)
    if not eid:
        pytest.skip("no new est created")
    # too low
    r = requests.put(f"{API}/merchant/establishment/{eid}", headers=merchant_h,
                     json={"discount_percent": 0}, timeout=15)
    assert r.status_code == 400
    # too high
    r = requests.put(f"{API}/merchant/establishment/{eid}", headers=merchant_h,
                     json={"discount_percent": 150}, timeout=15)
    assert r.status_code == 400


def test_merchant_set_valid_discount_flags_configured(merchant_h):
    eid = getattr(pytest, "new_est_id", None)
    if not eid:
        pytest.skip("no new est created")
    r = requests.put(f"{API}/merchant/establishment/{eid}", headers=merchant_h,
                     json={"discount_percent": 12}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    est = body["establishment"]
    assert est["discount_percent"] == 12
    assert est["discount_configured"] is True


# ---------------- QR gating ----------------
def test_scan_blocked_when_establishment_subscription_not_active(consumer_h):
    """Newly-created establishment: subscription pending -> scan should be blocked."""
    qr = getattr(pytest, "new_est_qr", None)
    if not qr:
        pytest.skip("no new est qr")
    r = requests.post(f"{API}/consumer/scan", headers=consumer_h,
                     json={"qr_token": qr}, timeout=15)
    # Requirement: 400 with message about "não está ativo"
    assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"
    assert "ativo" in r.text.lower()


def test_transaction_blocked_when_discount_not_configured(consumer_h, admin_h):
    """Even after admin activates the est, if discount is still not configured,
    creating a transaction must return 400 with configure-discount message."""
    eid = getattr(pytest, "new_est_id", None)
    if not eid:
        pytest.skip("no new est")
    # Reset discount_configured=False on the new est to simulate not-configured
    # (admin update path) then activate.
    r = requests.put(f"{API}/admin/establishments/{eid}", headers=admin_h,
                     json={"approval_status": "approved", "subscription_status": "active"}, timeout=15)
    assert r.status_code == 200
    # Force discount_configured=False and discount_percent=null via mongo-ish path -
    # we don't have such endpoint; skip if impossible. Use PUT admin_update which
    # doesn't touch discount_configured, so we can't unset. So test the OTHER
    # est owned by merchant: create a fresh one without configuring discount.
    unique = uuid.uuid4().hex[:6]
    m_h = _login(MERCHANT)
    r2 = requests.post(f"{API}/merchant/establishments", headers=m_h,
                       json={"fantasy_name": f"TEST_NoDisc_{unique}"}, timeout=15)
    if r2.status_code != 200:
        pytest.skip("cannot create another est (limit)")
    new_eid = r2.json()["id"]
    # Admin activates the subscription (approve + active) but discount stays unconfigured
    r3 = requests.post(f"{API}/admin/establishments/{new_eid}/activate", headers=admin_h, timeout=15)
    assert r3.status_code == 200
    activated = r3.json()
    assert activated["subscription_status"] == "active"
    assert activated["approval_status"] == "approved"
    # Now create transaction as consumer -> should be blocked with configure message
    r4 = requests.post(f"{API}/consumer/transactions", headers=consumer_h,
                       json={"establishment_id": new_eid, "gross_amount": 100.0}, timeout=15)
    assert r4.status_code == 400
    assert "Configure" in r4.text or "configure" in r4.text.lower() or "desconto" in r4.text.lower()


# ---------------- Per-establishment activation isolation ----------------
def test_activate_establishment_isolation(merchant_h, admin_h):
    # Ensure merchant has at least 2 ests
    r = requests.get(f"{API}/merchant/establishments", headers=merchant_h, timeout=15)
    ests = r.json()["establishments"]
    if len(ests) < 2:
        pytest.skip("need >=2 ests for isolation test")
    # pick a pending one and an active/other one
    pend = next((e for e in ests if e["subscription_status"] != "active"), None)
    other = next((e for e in ests if e["id"] != (pend or {}).get("id")), None)
    if not pend or not other:
        pytest.skip("need pending + other est")
    before_other_status = other["subscription_status"]
    r = requests.post(f"{API}/admin/establishments/{pend['id']}/activate", headers=admin_h, timeout=15)
    assert r.status_code == 200
    activated = r.json()
    assert activated["subscription_status"] == "active"
    assert activated["approval_status"] == "approved"
    assert activated.get("next_due")
    # verify other est unchanged
    r2 = requests.get(f"{API}/merchant/establishments", headers=merchant_h, timeout=15)
    ests2 = r2.json()["establishments"]
    other2 = next(e for e in ests2 if e["id"] == other["id"])
    assert other2["subscription_status"] == before_other_status
    # audit
    r3 = requests.get(f"{API}/admin/audit", headers=admin_h, timeout=15)
    logs = r3.json()
    assert any(l.get("action_type") == "activate_establishment" and l.get("record") == pend["id"] for l in logs)


def test_suspend_establishment_isolation(merchant_h, admin_h):
    r = requests.get(f"{API}/merchant/establishments", headers=merchant_h, timeout=15)
    ests = r.json()["establishments"]
    active = [e for e in ests if e["subscription_status"] == "active"]
    if len(active) < 1:
        pytest.skip("no active est")
    target = active[0]
    others_before = {e["id"]: e["subscription_status"] for e in ests if e["id"] != target["id"]}
    r = requests.post(f"{API}/admin/establishments/{target['id']}/suspend", headers=admin_h, timeout=15)
    assert r.status_code == 200
    r2 = requests.get(f"{API}/merchant/establishments", headers=merchant_h, timeout=15)
    ests2 = r2.json()["establishments"]
    t2 = next(e for e in ests2 if e["id"] == target["id"])
    assert t2["subscription_status"] == "suspended"
    for eid, st in others_before.items():
        cur = next(e for e in ests2 if e["id"] == eid)
        assert cur["subscription_status"] == st, f"other est {eid} changed!"
    # re-activate to restore
    requests.post(f"{API}/admin/establishments/{target['id']}/activate", headers=admin_h, timeout=15)


# ---------------- Admin subscriptions table ----------------
def test_admin_subscriptions_table(admin_h):
    r = requests.get(f"{API}/admin/subscriptions", headers=admin_h, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ["rows", "total", "prices_configured"]:
        assert k in d
    assert isinstance(d["rows"], list)
    kinds = {r["kind"] for r in d["rows"]}
    assert "consumer" in kinds
    assert "establishment" in kinds
    est_row = next(r for r in d["rows"] if r["kind"] == "establishment")
    for k in ["subscriber_name", "merchant_name", "email", "status", "next_due", "value"]:
        assert k in est_row


def test_admin_subscriptions_filter_type(admin_h):
    r = requests.get(f"{API}/admin/subscriptions?type=consumer", headers=admin_h, timeout=15)
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert all(x["kind"] == "consumer" for x in rows)
    r2 = requests.get(f"{API}/admin/subscriptions?type=establishment", headers=admin_h, timeout=15)
    assert r2.status_code == 200
    assert all(x["kind"] == "establishment" for x in r2.json()["rows"])


def test_admin_subscriptions_filter_status(admin_h):
    r = requests.get(f"{API}/admin/subscriptions?status=active", headers=admin_h, timeout=15)
    assert r.status_code == 200
    assert all(x["status"] == "active" for x in r.json()["rows"])


# ---------------- Consumer activation single-button ----------------
def test_activate_consumer_endpoint(admin_h):
    # register fresh consumer
    email = f"test_act_{uuid.uuid4().hex[:6]}@off360.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": "Test Activate", "email": email, "phone": "+5511900002222",
        "password": "senha123", "role": "consumer",
    }, timeout=15)
    assert r.status_code == 200
    cid = r.json()["id"]
    # activate
    r2 = requests.post(f"{API}/admin/consumers/{cid}/activate", headers=admin_h, timeout=15)
    assert r2.status_code == 200
    d = r2.json()
    assert d["account_status"] == "active"
    assert d["subscription_status"] == "active"
    assert d.get("subscription_start")
    assert d.get("next_due")
    # audit
    r3 = requests.get(f"{API}/admin/audit", headers=admin_h, timeout=15)
    assert any(l.get("action_type") == "activate_consumer" and l.get("record") == cid for l in r3.json())


# ---------------- Tamires preserved ----------------
def test_tamires_preserved_not_in_catalog(admin_h, consumer_h):
    r = requests.get(f"{API}/admin/establishments", headers=admin_h, timeout=15)
    ests = r.json()
    tam = next((e for e in ests if "THAMIRES" in (e.get("fantasy_name") or "").upper()
                or "TAMIRES" in (e.get("fantasy_name") or "").upper()), None)
    assert tam, "Tamires establishment missing"
    assert tam.get("discount_configured") is False
    assert tam.get("discount_percent") in (None, 0)
    # not in consumer catalog
    r2 = requests.get(f"{API}/consumer/establishments", headers=consumer_h, timeout=15)
    catalog = r2.json()
    assert not any(e["id"] == tam["id"] for e in catalog)


# ---------------- Merchant dashboard consolidated vs single ----------------
def test_merchant_dashboard_consolidated_and_single(merchant_h):
    r = requests.get(f"{API}/merchant/dashboard?establishment_id=all", headers=merchant_h, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["view"] == "all"
    assert "totals" in d
    for k in ["establishments", "active", "pending", "monthly_value"]:
        assert k in d["totals"]
    assert isinstance(d.get("per_establishment"), list)

    # single
    ests = requests.get(f"{API}/merchant/establishments", headers=merchant_h).json()["establishments"]
    if ests:
        r2 = requests.get(f"{API}/merchant/dashboard?establishment_id={ests[0]['id']}", headers=merchant_h, timeout=15)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["view"] == "single"
        assert d2["selected"] and d2["selected"]["id"] == ests[0]["id"]


# ---------------- Merchant 10-est limit ----------------
def test_merchant_10_est_limit_returns_400(merchant_h):
    # try creating up to limit; if already >=10, verify 400
    r = requests.get(f"{API}/merchant/establishments", headers=merchant_h, timeout=15)
    cur = r.json()["count"]
    limit = r.json()["limit"]
    assert limit == 10
    if cur < 10:
        pytest.skip(f"merchant has {cur}<10 ests; skipping limit test")
    r2 = requests.post(f"{API}/merchant/establishments", headers=merchant_h,
                      json={"fantasy_name": "TEST_over_limit"}, timeout=15)
    assert r2.status_code == 400
