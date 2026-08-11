"""Tests for the forced password change flow on the demo admin account.

NOTE: The demo admin temporary password is consumed by this suite. After a successful
run, admin@off360.com password becomes NovaSenha@2026.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend .env parsed manually if env var isn't exported to pytest process
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

DEMO_EMAIL = "admin@off360.com"
DEMO_TEMP_PW = "OffAdmin@Temp1"
NEW_PW = "NovaSenha@2026"

OWNER_EMAIL = "paulo.silva.dn.0006@gmail.com"
OWNER_PW = "Off360Admin!2026"

CONSUMER_EMAIL = "consumidor@off360.com"
CONSUMER_PW = "senha123"

MERCHANT_EMAIL = "empresario@off360.com"
MERCHANT_PW = "senha123"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    return s, r


# --- Demo admin forced password change flow ---

@pytest.mark.order(1)
def test_demo_admin_login_returns_must_change_password():
    s, r = _login(DEMO_EMAIL, DEMO_TEMP_PW)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["role"] == "admin"
    assert data["email"] == DEMO_EMAIL
    assert data.get("account_status") == "active"
    # /auth/me
    me = s.get(f"{BASE_URL}/api/auth/me")
    assert me.status_code == 200
    body = me.json()
    assert body.get("must_change_password") is True, f"expected must_change_password=True, got {body}"


@pytest.mark.order(2)
def test_change_password_wrong_current_returns_400():
    s, r = _login(DEMO_EMAIL, DEMO_TEMP_PW)
    assert r.status_code == 200
    resp = s.post(f"{BASE_URL}/api/auth/change-password",
                  json={"current_password": "wrong-pass", "new_password": NEW_PW})
    assert resp.status_code == 400, resp.text


@pytest.mark.order(3)
def test_change_password_too_short_returns_400():
    s, r = _login(DEMO_EMAIL, DEMO_TEMP_PW)
    assert r.status_code == 200
    resp = s.post(f"{BASE_URL}/api/auth/change-password",
                  json={"current_password": DEMO_TEMP_PW, "new_password": "abc"})
    assert resp.status_code == 400


@pytest.mark.order(4)
def test_change_password_same_as_current_returns_400():
    s, r = _login(DEMO_EMAIL, DEMO_TEMP_PW)
    assert r.status_code == 200
    resp = s.post(f"{BASE_URL}/api/auth/change-password",
                  json={"current_password": DEMO_TEMP_PW, "new_password": DEMO_TEMP_PW})
    assert resp.status_code == 400


@pytest.mark.order(5)
def test_change_password_success_and_flag_cleared():
    s, r = _login(DEMO_EMAIL, DEMO_TEMP_PW)
    assert r.status_code == 200
    resp = s.post(f"{BASE_URL}/api/auth/change-password",
                  json={"current_password": DEMO_TEMP_PW, "new_password": NEW_PW})
    assert resp.status_code == 200, resp.text
    assert resp.json().get("ok") is True

    me = s.get(f"{BASE_URL}/api/auth/me")
    assert me.status_code == 200
    body = me.json()
    assert body.get("must_change_password") is False or body.get("must_change_password") is None


@pytest.mark.order(6)
def test_old_temp_password_now_fails():
    _, r = _login(DEMO_EMAIL, DEMO_TEMP_PW)
    assert r.status_code == 401


@pytest.mark.order(7)
def test_new_password_login_succeeds_and_admin_overview_accessible():
    s, r = _login(DEMO_EMAIL, NEW_PW)
    assert r.status_code == 200
    assert r.json()["role"] == "admin"
    ov = s.get(f"{BASE_URL}/api/admin/overview")
    assert ov.status_code == 200, ov.text
    data = ov.json()
    # Should be real DB metrics — assert some expected keys exist
    assert isinstance(data, dict) and len(data) > 0


# --- Owner admin still works ---

def test_owner_admin_login_and_overview():
    s, r = _login(OWNER_EMAIL, OWNER_PW)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "admin"
    assert not body.get("must_change_password")
    ov = s.get(f"{BASE_URL}/api/admin/overview")
    assert ov.status_code == 200


# --- Role isolation ---

def test_consumer_cannot_hit_admin_endpoints():
    s, r = _login(CONSUMER_EMAIL, CONSUMER_PW)
    assert r.status_code == 200
    assert r.json()["role"] == "consumer"
    ov = s.get(f"{BASE_URL}/api/admin/overview")
    assert ov.status_code == 403, f"consumer got {ov.status_code}"


def test_merchant_cannot_hit_admin_endpoints():
    s, r = _login(MERCHANT_EMAIL, MERCHANT_PW)
    assert r.status_code == 200
    assert r.json()["role"] == "merchant"
    ov = s.get(f"{BASE_URL}/api/admin/overview")
    assert ov.status_code == 403, f"merchant got {ov.status_code}"


def test_unauthenticated_admin_endpoint_rejected():
    r = requests.get(f"{BASE_URL}/api/admin/overview")
    assert r.status_code in (401, 403)
