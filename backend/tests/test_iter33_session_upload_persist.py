"""Tests for iter33: session stability, upload endpoint, and merchant image persistence."""
import os
import io
import time
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://off360-preview.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

MERCHANT_EMAIL = "alex@gmail.com"
MERCHANT_PASSWORD = "Test123!"


@pytest.fixture(scope="module")
def merchant_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": MERCHANT_EMAIL, "password": MERCHANT_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    # Cookies (httpOnly) should now be set
    assert "access_token" in s.cookies or any("access" in c.name for c in s.cookies), f"cookies={s.cookies}"
    return s


def test_login_sets_httponly_cookies(merchant_session):
    cookies = merchant_session.cookies
    names = {c.name for c in cookies}
    # both access_token and refresh_token cookies expected
    assert "access_token" in names, f"cookies={names}"
    assert "refresh_token" in names, f"cookies={names}"


def test_auth_me(merchant_session):
    r = merchant_session.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data.get("email") == MERCHANT_EMAIL
    assert data.get("role") == "merchant"


def test_refresh_returns_new_access_token(merchant_session):
    # Ensure refresh works with the refresh cookie
    r = merchant_session.post(f"{API}/auth/refresh", timeout=10)
    assert r.status_code == 200, r.text
    # After refresh, /auth/me still works
    r2 = merchant_session.get(f"{API}/auth/me", timeout=10)
    assert r2.status_code == 200


def test_auth_me_401_when_access_expired_but_refresh_recovers():
    """Simulate what the frontend does: drop the access_token cookie, then call /auth/me → 401,
    then call /auth/refresh (still have refresh cookie) → then /auth/me succeeds."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": MERCHANT_EMAIL, "password": MERCHANT_PASSWORD}, timeout=15)
    assert r.status_code == 200
    # Clear only the access cookie
    for c in list(s.cookies):
        if c.name == "access_token":
            s.cookies.clear(domain=c.domain, path=c.path, name=c.name)
    # /auth/me should now be 401
    r_me = s.get(f"{API}/auth/me", timeout=10)
    assert r_me.status_code == 401, f"expected 401 without access token, got {r_me.status_code}"
    # /auth/refresh should succeed with refresh cookie
    r_ref = s.post(f"{API}/auth/refresh", timeout=10)
    assert r_ref.status_code == 200, f"refresh should recover session, got {r_ref.status_code} {r_ref.text}"
    # /auth/me should now succeed again
    r_me2 = s.get(f"{API}/auth/me", timeout=10)
    assert r_me2.status_code == 200


def _upload_png(session, size_px=(600, 600)):
    # Minimal valid PNG bytes using PIL if available; else use tiny 1x1 (backend allows any image)
    try:
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", size_px, (200, 100, 50)).save(buf, format="PNG")
        buf.seek(0)
        data = buf.getvalue()
    except Exception:
        # 1x1 transparent PNG
        data = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
        )
    files = {"file": ("test.png", data, "image/png")}
    return session.post(f"{API}/upload", files=files, timeout=60)


def test_upload_returns_url(merchant_session):
    r = _upload_png(merchant_session, (600, 600))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "url" in data and data["url"].startswith("/api/files/")


def test_merchant_establishment_persists_logo_and_cover(merchant_session):
    # Upload two images
    r1 = _upload_png(merchant_session, (600, 600))
    assert r1.status_code == 200
    logo_url = r1.json()["url"]
    r2 = _upload_png(merchant_session, (1300, 730))
    assert r2.status_code == 200
    cover_url = r2.json()["url"]

    # Get current establishment
    rget = merchant_session.get(f"{API}/merchant/establishment", timeout=15)
    assert rget.status_code == 200, rget.text
    est = rget.json()
    eid = est["id"]

    # PUT with only the image fields plus required ones (minimal payload merges backend-side).
    payload = dict(est)
    payload["logo_url"] = logo_url
    payload["cover_url"] = cover_url
    # remove keys not allowed on write
    for k in ["id", "owner_id", "created_at", "updated_at", "activated_at", "discount_configured", "_id"]:
        payload.pop(k, None)

    rput = merchant_session.put(f"{API}/merchant/establishment/{eid}", json=payload, timeout=15)
    assert rput.status_code == 200, rput.text

    # GET again and verify persistence
    rget2 = merchant_session.get(f"{API}/merchant/establishment", params={"establishment_id": eid}, timeout=15)
    assert rget2.status_code == 200
    est2 = rget2.json()
    assert est2.get("logo_url") == logo_url
    assert est2.get("cover_url") == cover_url


def test_merchant_catalog_photo_persists(merchant_session):
    # Upload a photo
    r = _upload_png(merchant_session, (400, 400))
    assert r.status_code == 200
    photo_url = r.json()["url"]

    # Get establishment
    rget = merchant_session.get(f"{API}/merchant/establishment", timeout=15)
    est = rget.json()
    eid = est["id"]

    # Create catalog item
    body = {
        "establishment_id": eid, "name": "TEST_iter33_item", "description": "qa",
        "price": 12.5, "discount_percent": 0, "photo_url": photo_url, "active": True,
    }
    rc = merchant_session.post(f"{API}/merchant/catalog", json=body, timeout=15)
    assert rc.status_code in (200, 201), rc.text
    item = rc.json()
    item_id = item["id"]

    # GET and confirm photo_url persisted
    rlist = merchant_session.get(f"{API}/merchant/catalog", params={"establishment_id": eid}, timeout=15)
    assert rlist.status_code == 200
    found = next((x for x in rlist.json() if x["id"] == item_id), None)
    assert found is not None
    assert found.get("photo_url") == photo_url

    # Cleanup
    merchant_session.delete(f"{API}/merchant/catalog/{item_id}", timeout=10)
