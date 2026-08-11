"""OFF 360 — iteration 6 regression tests.

Covers the new-clean-DB flow: register (no auto-est), create first establishment
via the FULL payload, uploads (skipped — done via Emergent Object Storage),
scan pending consumer=>403, admin activations, and scan->confirm happy path.

Run:
  BASE_URL=$REACT_APP_BACKEND_URL pytest /app/backend/tests/test_off360_iter6.py -v
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://off360-preview.preview.emergentagent.com").rstrip("/")
QA = {"email": "qa_admin@off360.com", "password": "QaAdmin@2026"}


def _uid(prefix):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:6]}"


def _session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(s, email, password):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()


def _register(s, role, name=None):
    email = f"{_uid(role)}@testoff360.com"
    payload = {"role": role, "name": name or f"TEST {role}", "email": email, "phone": "11999999999",
               "password": "TestPass@2026", "city": "SP", "neighborhood": "Centro"}
    r = s.post(f"{BASE_URL}/api/auth/register", json=payload)
    assert r.status_code == 200, f"register {role}: {r.status_code} {r.text}"
    return r.json(), email


@pytest.fixture(scope="module")
def qa_admin():
    s = _session()
    _login(s, QA["email"], QA["password"])
    return s


# ---------- Consumer register + scan pending ----------
class TestConsumerScanPending:
    def test_register_consumer_and_scan_pending_returns_403(self, qa_admin):
        # Need an active/approved establishment for the 403 path to reach subscription check.
        # First: register merchant + create est + admin approve/activate.
        ms = _session()
        muser, memail = _register(ms, "merchant")

        # No auto-establishment
        r = ms.get(f"{BASE_URL}/api/merchant/establishments")
        assert r.status_code == 200
        body = r.json()
        est_list = body.get("establishments") if isinstance(body, dict) else body
        assert est_list == []

        # Create full establishment
        est_payload = {
            "fantasy_name": _uid("Est"),
            "category_id": None,
            "description": "Loja de teste",
            "address": "Rua Teste 100",
            "neighborhood": "Centro",
            "city": "SP",
            "hours": "09:00-18:00",
            "whatsapp": "11988887777",
            "discount_percent": 20,
            "discount_rules": "Válido de seg a sex",
        }
        rc = ms.post(f"{BASE_URL}/api/merchant/establishments", json=est_payload)
        assert rc.status_code == 200, rc.text
        est = rc.json()
        assert est["discount_configured"] is True
        assert est["discount_percent"] == 20
        eid = est["id"]

        # Admin: approve/activate merchant + establishment
        r1 = qa_admin.post(f"{BASE_URL}/api/admin/merchants/{muser['id']}/activate")
        assert r1.status_code == 200, r1.text
        r2 = qa_admin.post(f"{BASE_URL}/api/admin/establishments/{eid}/activate")
        assert r2.status_code == 200, r2.text

        qr_token = est["qr_token"]

        # New pending consumer
        cs = _session()
        cuser, _ = _register(cs, "consumer")
        assert cuser["subscription_status"] == "pending"

        rs = cs.post(f"{BASE_URL}/api/consumer/scan", json={"qr_token": qr_token})
        assert rs.status_code == 403, f"expected 403, got {rs.status_code} {rs.text}"

        # Admin activates consumer
        ra = qa_admin.post(f"{BASE_URL}/api/admin/consumers/{cuser['id']}/activate")
        assert ra.status_code == 200, ra.text

        # Scan now succeeds
        rs2 = cs.post(f"{BASE_URL}/api/consumer/scan", json={"qr_token": qr_token})
        assert rs2.status_code == 200, rs2.text
        data = rs2.json()
        assert "transaction_id" in data
        tx_id = data["transaction_id"]

        # Consumer views the transaction (BENEFIT screen)
        rt = cs.get(f"{BASE_URL}/api/consumer/transactions/{tx_id}")
        assert rt.status_code == 200
        tx = rt.json()
        assert tx["status"] == "pending_validation"
        assert tx["discount_percent"] == 20
        assert "transaction_code" in tx

        # Merchant confirms with value=100 -> discount 20, final 80
        rconf = ms.post(f"{BASE_URL}/api/merchant/transactions/{tx_id}/confirm", json={"gross_amount": 100})
        assert rconf.status_code == 200, rconf.text
        conf = rconf.json()
        assert conf["status"] == "confirmed"
        assert conf["discount_amount"] == 20
        assert conf["final_amount"] == 80

        # Consumer sees confirmed
        rt2 = cs.get(f"{BASE_URL}/api/consumer/transactions/{tx_id}")
        assert rt2.status_code == 200
        assert rt2.json()["status"] == "confirmed"


# ---------- Merchant register: NO auto establishment; add full flow ----------
class TestMerchantFirstEstablishment:
    def test_merchant_register_zero_establishments_and_add_full_form(self, qa_admin):
        ms = _session()
        muser, _ = _register(ms, "merchant")
        r = ms.get(f"{BASE_URL}/api/merchant/establishments")
        assert r.status_code == 200
        body = r.json()
        est_list = body.get("establishments") if isinstance(body, dict) else body
        assert isinstance(est_list, list)
        assert len(est_list) == 0

        # Full form
        payload = {
            "fantasy_name": _uid("FullEst"),
            "description": "Café artesanal",
            "address": "Av Central, 500",
            "neighborhood": "Vila Nova",
            "city": "SP",
            "hours": "Seg-Sex 08:00-20:00",
            "whatsapp": "11977776666",
            "instagram": "@testest",
            "discount_percent": 15,
            "discount_rules": "Apenas para consumo local",
        }
        rc = ms.post(f"{BASE_URL}/api/merchant/establishments", json=payload)
        assert rc.status_code == 200, rc.text
        est = rc.json()
        assert est["fantasy_name"] == payload["fantasy_name"]
        assert est["discount_percent"] == 15
        assert est["discount_configured"] is True
        assert est["approval_status"] == "pending"
        assert est["subscription_status"] == "pending"

        # List now 1/10
        r2 = ms.get(f"{BASE_URL}/api/merchant/establishments")
        body2 = r2.json()
        list2 = body2.get("establishments") if isinstance(body2, dict) else body2
        assert len(list2) == 1
        if isinstance(body2, dict):
            assert body2.get("limit") == 10
            assert body2.get("count") == 1

    def test_merchant_register_no_404_on_related_endpoints(self):
        ms = _session()
        _register(ms, "merchant")
        # These should NOT 404
        for path in ["/api/merchant/establishments", "/api/merchant/dashboard", "/api/merchant/subscription"]:
            r = ms.get(f"{BASE_URL}{path}")
            assert r.status_code != 404, f"{path} 404: {r.text}"


# ---------- Admin listing / activation buttons ----------
class TestAdminEndpoints:
    def test_admin_lists_merchants_consumers_establishments(self, qa_admin):
        for path in ["/api/admin/merchants", "/api/admin/consumers", "/api/admin/establishments"]:
            r = qa_admin.get(f"{BASE_URL}{path}")
            assert r.status_code == 200, f"{path} {r.status_code}"
            assert isinstance(r.json(), list)

    def test_admin_suspend_and_reactivate_merchant(self, qa_admin):
        ms = _session()
        muser, _ = _register(ms, "merchant")
        r1 = qa_admin.post(f"{BASE_URL}/api/admin/merchants/{muser['id']}/activate")
        assert r1.status_code == 200
        r2 = qa_admin.post(f"{BASE_URL}/api/admin/merchants/{muser['id']}/suspend")
        assert r2.status_code == 200
        r3 = qa_admin.post(f"{BASE_URL}/api/admin/merchants/{muser['id']}/activate")
        assert r3.status_code == 200


# ---------- Persistence: update establishment discount conditions and refetch ----------
class TestPersistence:
    def test_update_establishment_full_discount_conditions_persists(self, qa_admin):
        ms = _session()
        _register(ms, "merchant")
        payload = {
            "fantasy_name": _uid("PersistEst"),
            "description": "d",
            "address": "Rua X 1",
            "neighborhood": "b",
            "city": "SP",
            "hours": "9-18",
            "whatsapp": "11900000000",
            "discount_percent": 10,
        }
        rc = ms.post(f"{BASE_URL}/api/merchant/establishments", json=payload)
        assert rc.status_code == 200
        eid = rc.json()["id"]

        upd = {
            "discount_percent": 25,
            "discount_min_purchase": 50.0,
            "discount_max_cap": 30.0,
            "discount_participating": "Todos os produtos",
            "discount_excluded": "Bebidas alcoólicas",
            "discount_valid_days": "seg,ter,qua,qui,sex",
            "discount_valid_hours": "09:00-18:00",
            "discount_cumulative": False,
            "discount_observations": "Somente 1 desconto por CPF/dia",
        }
        r = ms.put(f"{BASE_URL}/api/merchant/establishment/{eid}", json=upd)
        assert r.status_code == 200, r.text

        r2 = ms.get(f"{BASE_URL}/api/merchant/establishment", params={"establishment_id": eid})
        assert r2.status_code == 200
        e = r2.json()
        for k, v in upd.items():
            assert e[k] == v, f"{k}: {e.get(k)} != {v}"
