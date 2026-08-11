"""Iteration 12 — Sponsored Story metrics & viewer wiring (12s timer, dedup, click kinds).

Covers backend endpoints used by StoryViewer:
- POST /api/consumer/stories/{sid}/view (dedup 10s via register_view)
- POST /api/consumer/stories/{sid}/click {kind: story|establishment}
- GET  /api/consumer/home returns enriched establishment fields on sponsored group.
Uses QA_AUTOMATED_ prefix. Never touches real accounts.
"""
import os
import uuid
import time
import requests
import pytest

def _load_frontend_env():
    p = "/app/frontend/.env"
    try:
        with open(p) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env()).rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "paulo.silva.dn.0006@gmail.com"
ADMIN_PASSWORD = "Off360Admin!2026"


def _sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(s, email, password):
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()


def _register(s, role, name, email, password, phone="11999999999"):
    r = s.post(f"{API}/auth/register", json={
        "role": role, "name": name, "email": email, "password": password,
        "phone": phone, "city": "São Paulo", "neighborhood": "QA_AUTOMATED_bairro"
    })
    assert r.status_code == 200, f"register {role} {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def scenario():
    """Build merchant+establishment+story+active boost + activated consumer."""
    tag = uuid.uuid4().hex[:8]
    merchant_email = f"qa_automated_{tag}_m@testoff360.com"
    consumer_email = f"qa_automated_{tag}_c@testoff360.com"
    pwd = "QaPass@2026"

    # 1) merchant registers & creates establishment
    m = _sess()
    _register(m, "merchant", f"QA_AUTOMATED_ Merchant {tag}", merchant_email, pwd)
    r = m.post(f"{API}/merchant/establishments", json={
        "fantasy_name": f"QA_AUTOMATED_ Estab {tag}",
        "description": "QA sponsored story test",
        "neighborhood": "Centro", "city": "São Paulo",
        "whatsapp": "11999999999",
        "discount_percent": 20, "discount_rules": "Segunda a sexta",
    })
    assert r.status_code == 200, r.text
    est = r.json()
    eid = est["id"]

    # add discount_min_purchase / max_cap via update
    r = m.put(f"{API}/merchant/establishment/{eid}", json={
        "discount_min_purchase": 50, "discount_max_cap": 100
    })
    assert r.status_code == 200, r.text

    # 2) admin approves + activates establishment
    a = _sess()
    _login(a, ADMIN_EMAIL, ADMIN_PASSWORD)
    r = a.post(f"{API}/admin/establishments/{eid}/activate")
    assert r.status_code == 200, r.text

    # 3) merchant creates story
    r = m.post(f"{API}/merchant/stories", json={
        "establishment_id": eid, "category": "offer",
        "title": f"QA_AUTOMATED_ Story {tag}",
        "text": "Descrição QA", "media_type": "image"
    })
    assert r.status_code == 200, r.text
    sid = r.json()["id"]

    # 4) merchant creates boost
    r = m.post(f"{API}/merchant/boosts", json={
        "establishment_id": eid, "story_id": sid,
        "region": "Centro", "category": "offer", "notes": "QA_AUTOMATED_"
    })
    assert r.status_code == 200, r.text
    bid = r.json()["id"]

    # 5) admin approve + activate boost
    r = a.post(f"{API}/admin/boosts/{bid}/approve")
    assert r.status_code == 200, r.text
    r = a.post(f"{API}/admin/boosts/{bid}/activate", json={"priority": 5})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"

    # 6) consumer registers, admin activates subscription
    c = _sess()
    consumer = _register(c, "consumer", f"QA_AUTOMATED_ Consumer {tag}", consumer_email, pwd)
    r = a.post(f"{API}/admin/consumers/{consumer['id']}/activate")
    assert r.status_code == 200, r.text
    # relogin consumer to refresh cookie/state
    _login(c, consumer_email, pwd)

    yield {
        "tag": tag, "merchant": m, "admin": a, "consumer": c,
        "eid": eid, "sid": sid, "bid": bid,
    }


# --- Home returns sponsored group with enriched fields ---
def test_home_sponsored_group_enriched(scenario):
    c = scenario["consumer"]
    r = c.get(f"{API}/consumer/home")
    assert r.status_code == 200, r.text
    data = r.json()
    groups = data.get("stories", [])
    assert groups, "no story groups"
    # sponsored one must be first
    g = groups[0]
    assert g.get("sponsored") is True
    est = g["establishment"]
    for key in ("fantasy_name", "category_name", "neighborhood",
                "discount_percent", "discount_min_purchase",
                "discount_max_cap", "discount_rules", "action_buttons"):
        assert key in est, f"missing {key} in establishment payload"
    assert est["discount_percent"] == 20
    assert est["discount_min_purchase"] == 50
    assert est["discount_max_cap"] == 100
    # story flagged sponsored
    assert any(s.get("sponsored") for s in g["stories"])


# --- View dedup ---
def test_view_dedup_within_10s(scenario):
    c = scenario["consumer"]
    sid = scenario["sid"]
    bid = scenario["bid"]
    a = scenario["admin"]

    # baseline
    r = a.get(f"{API}/admin/boosts")
    b0 = next(b for b in r.json() if b["id"] == bid)
    v0 = b0["metrics"]["views"]

    r1 = c.post(f"{API}/consumer/stories/{sid}/view"); assert r1.status_code == 200
    r2 = c.post(f"{API}/consumer/stories/{sid}/view"); assert r2.status_code == 200

    r = a.get(f"{API}/admin/boosts")
    b1 = next(b for b in r.json() if b["id"] == bid)
    assert b1["metrics"]["views"] == v0 + 1, f"expected dedup: v0={v0} v1={b1['metrics']['views']}"
    assert b1["metrics"]["unique_viewers"] >= 1


# --- Click kinds increment the right metric ---
def test_click_establishment_increments_establishment_clicks(scenario):
    c = scenario["consumer"]
    sid = scenario["sid"]
    bid = scenario["bid"]
    a = scenario["admin"]

    r = a.get(f"{API}/admin/boosts")
    m0 = next(b for b in r.json() if b["id"] == bid)["metrics"]
    est0 = m0.get("establishment_clicks", 0)
    sc0 = m0.get("story_clicks", 0)

    r = c.post(f"{API}/consumer/stories/{sid}/click", json={"kind": "establishment"})
    assert r.status_code == 200, r.text

    r = a.get(f"{API}/admin/boosts")
    m1 = next(b for b in r.json() if b["id"] == bid)["metrics"]
    assert m1["establishment_clicks"] == est0 + 1
    # bump_metric also increments story_clicks
    assert m1["story_clicks"] == sc0 + 1


def test_click_story_kind(scenario):
    c = scenario["consumer"]
    sid = scenario["sid"]
    bid = scenario["bid"]
    a = scenario["admin"]

    r = a.get(f"{API}/admin/boosts")
    sc0 = next(b for b in r.json() if b["id"] == bid)["metrics"]["story_clicks"]

    r = c.post(f"{API}/consumer/stories/{sid}/click", json={"kind": "story"})
    assert r.status_code == 200, r.text

    r = a.get(f"{API}/admin/boosts")
    sc1 = next(b for b in r.json() if b["id"] == bid)["metrics"]["story_clicks"]
    assert sc1 == sc0 + 1


# --- Empty metrics includes establishment_clicks ---
def test_empty_metrics_shape(scenario):
    a = scenario["admin"]
    bid = scenario["bid"]
    r = a.get(f"{API}/admin/boosts")
    m = next(b for b in r.json() if b["id"] == bid)["metrics"]
    for k in ("views", "unique_viewers", "story_clicks", "establishment_clicks",
              "whatsapp_clicks", "button_clicks", "requests_from_story"):
        assert k in m, f"missing metric {k}"


def test_cleanup(scenario):
    """Best-effort cleanup of QA_AUTOMATED_ data."""
    a = scenario["admin"]
    bid = scenario["bid"]
    eid = scenario["eid"]
    a.post(f"{API}/admin/boosts/{bid}/end")
    a.post(f"{API}/admin/establishments/{eid}/suspend")
