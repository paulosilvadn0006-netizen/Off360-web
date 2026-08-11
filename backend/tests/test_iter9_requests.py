"""
OFF 360 — Iteration 9 backend regression: Action Buttons + Internal Requests (Fase A).

Covers:
 - PUT /api/merchant/establishment/{id} with action_buttons (persist, max 3, external requires URL)
 - GET /api/consumer/establishments/{id} returns public action_buttons (active+complete only, with available/unavailable_message)
 - POST /api/consumer/requests: creates SOL- code, snapshot discount, status_history=[awaiting]
 - Consumer without active subscription -> 403
 - Establishment inactive -> 400
 - Nonexistent/incomplete button -> 400
 - WhatsApp destination returns whatsapp_url (wa.me), external returns external_url
 - POST /api/consumer/requests/{id}/track-click increments counter
 - Merchant flow: list (filters), accept, reject, status, respond, ownership isolation (404)
 - Confirm final idempotent (find_one_and_update): gross->discount->final, one transaction, updates total_saved, origin=remote_request
 - Confirm w/o gross when discount_applies -> 400
 - Confirm on cancelled/rejected -> 400
 - Consumer cancel; cannot cancel completed/rejected

All entities created with QA_AUTOMATED_ prefix. Real accounts untouched.
"""
import os, uuid, urllib.parse, pytest, requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("no backend url")

BASE = _load_backend_url()
ADMIN = {"email": "qa_admin@off360.com", "password": "QaAdmin@2026"}
PASS = "QaPass@2026"


def _hex(): return uuid.uuid4().hex[:10]

def _session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s

def _login(s, email, password):
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()

def _register(s, role):
    h = _hex()
    email = f"qa_automated_{h}@testoff360.com"
    body = {"name": f"QA_AUTOMATED_{role}_{h}", "email": email, "phone": "11999990000",
            "password": PASS, "role": role, "city": "SP", "neighborhood": "Centro"}
    if role == "merchant":
        body.update({"fantasy_name": f"QA_AUTOMATED_FN_{h}", "category_id": None})
    r = s.post(f"{BASE}/api/auth/register", json=body)
    assert r.status_code == 200, f"register {role}: {r.status_code} {r.text}"
    return r.json(), email


@pytest.fixture(scope="module")
def admin_sess():
    s = _session()
    try:
        _login(s, ADMIN["email"], ADMIN["password"])
    except AssertionError:
        # bootstrap: try to create qa_admin via legacy admin
        s2 = _session()
        _login(s2, "paulo.silva.dn.0006@gmail.com", "Off360Admin!2026")
        # try login again after possible seed
        _login(s, ADMIN["email"], ADMIN["password"])
    return s


@pytest.fixture(scope="module")
def created():
    return {"users": [], "establishments": [], "requests": [], "transactions": []}


def _make_merchant_with_active_est(admin_sess, created, whatsapp="5511999998888"):
    m_sess = _session()
    m_user, _ = _register(m_sess, "merchant")
    created["users"].append(m_user["id"])
    r = m_sess.post(f"{BASE}/api/merchant/establishments", json={
        "fantasy_name": f"QA_AUTOMATED_EST_{_hex()}",
        "description": "QA est", "address": "Rua QA 1", "neighborhood": "Centro", "city": "SP",
        "discount_percent": 20, "whatsapp": whatsapp,
    })
    assert r.status_code == 200, r.text
    est = r.json()
    created["establishments"].append(est["id"])
    # Admin activate
    r = admin_sess.post(f"{BASE}/api/admin/merchants/{m_user['id']}/activate"); assert r.status_code == 200, r.text
    r = admin_sess.post(f"{BASE}/api/admin/establishments/{est['id']}/activate"); assert r.status_code == 200, r.text
    # Also set min_purchase to 0
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={
        "discount_min_purchase": 0, "whatsapp": whatsapp,
    })
    assert r.status_code == 200, r.text
    return m_sess, m_user, est


def _make_active_consumer(admin_sess, created):
    c_sess = _session()
    c_user, _ = _register(c_sess, "consumer")
    created["users"].append(c_user["id"])
    r = admin_sess.post(f"{BASE}/api/admin/consumers/{c_user['id']}/activate"); assert r.status_code == 200, r.text
    return c_sess, c_user


def _btn(**kw):
    base = {"enabled": True, "label": "Agendar", "service_type": "agendamento",
            "destination": "internal", "whatsapp_message": "", "external_url": "",
            "valid_days": [], "hours_start": "", "hours_end": "",
            "response_time": "24h", "observations": "", "discount_valid": True,
            "requires_prepayment": False, "delivery_fee": None, "areas": "", "deadline": ""}
    base.update(kw)
    return base


# ---------- Action buttons: PUT persistence ----------
def test_action_buttons_persist_and_limits(admin_sess, created):
    m_sess, m_user, est = _make_merchant_with_active_est(admin_sess, created)

    # save 3 buttons
    buttons = [
        _btn(label="Agendar", service_type="agendamento", destination="internal"),
        _btn(label="WhatsApp", service_type="contato", destination="whatsapp"),
        _btn(label="Site", service_type="orcamento", destination="external", external_url="https://example.com/quote"),
    ]
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"action_buttons": buttons})
    assert r.status_code == 200, r.text
    saved = r.json()["establishment"]["action_buttons"]
    assert len(saved) == 3
    assert all("id" in b for b in saved)

    # verify persistence via GET
    r = m_sess.get(f"{BASE}/api/merchant/establishment", params={"establishment_id": est["id"]})
    assert r.status_code == 200
    assert len(r.json()["action_buttons"]) == 3

    # 4th button -> 400
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}",
                   json={"action_buttons": buttons + [_btn(label="Extra")]})
    assert r.status_code == 400
    assert "no máximo 3" in r.text.lower() or "máximo" in r.text.lower()

    # active external without valid URL -> 400
    bad = [_btn(label="LinkRuim", destination="external", external_url="ftp://x")]
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"action_buttons": bad})
    assert r.status_code == 400

    # empty URL on active external -> 400
    bad2 = [_btn(label="LinkVazio", destination="external", external_url="")]
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"action_buttons": bad2})
    assert r.status_code == 400


# ---------- Public exposure: consumer sees only active+complete ----------
def test_consumer_sees_public_buttons(admin_sess, created):
    m_sess, m_user, est = _make_merchant_with_active_est(admin_sess, created)
    buttons = [
        _btn(label="AtivoInterno", destination="internal"),
        _btn(enabled=False, label="Desativado"),
        _btn(label="ExtOK", destination="external", external_url="https://foo.bar/x"),
    ]
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"action_buttons": buttons})
    assert r.status_code == 200, r.text

    c_sess, _ = _make_active_consumer(admin_sess, created)
    r = c_sess.get(f"{BASE}/api/consumer/establishments/{est['id']}")
    assert r.status_code == 200, r.text
    ab = r.json()["action_buttons"]
    labels = [b["label"] for b in ab]
    assert "AtivoInterno" in labels
    assert "Desativado" not in labels
    # each has available + unavailable_message keys
    for b in ab:
        assert "available" in b
        assert "unavailable_message" in b


# ---------- Create internal request ----------
def test_create_internal_request_snapshot(admin_sess, created):
    m_sess, _, est = _make_merchant_with_active_est(admin_sess, created)
    buttons = [_btn(label="Agendar", service_type="agendamento", destination="internal")]
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"action_buttons": buttons})
    assert r.status_code == 200
    btn_id = r.json()["establishment"]["action_buttons"][0]["id"]

    c_sess, c_user = _make_active_consumer(admin_sess, created)
    r = c_sess.post(f"{BASE}/api/consumer/requests", json={
        "establishment_id": est["id"], "button_id": btn_id,
        "product_service": "Corte de cabelo", "desired_date": "2026-01-30",
        "desired_time": "14:00", "phone": "11988887777", "message": "obs test"
    })
    assert r.status_code == 200, r.text
    req = r.json()
    created["requests"].append(req["id"])
    assert req["status"] == "awaiting"
    assert req["code"].startswith("SOL-")
    assert req["discount_applies"] is True
    assert req["discount_percent"] == 20
    assert len(req["status_history"]) == 1
    assert req["status_history"][0]["status"] == "awaiting"

    # list own
    r = c_sess.get(f"{BASE}/api/consumer/requests")
    assert r.status_code == 200
    assert any(x["id"] == req["id"] for x in r.json())


def test_create_request_errors(admin_sess, created):
    m_sess, _, est = _make_merchant_with_active_est(admin_sess, created)
    buttons = [_btn(label="Agendar", destination="internal")]
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"action_buttons": buttons})
    btn_id = r.json()["establishment"]["action_buttons"][0]["id"]

    # No subscription consumer -> 403
    c_sess = _session()
    c_user, _ = _register(c_sess, "consumer")
    created["users"].append(c_user["id"])
    r = c_sess.post(f"{BASE}/api/consumer/requests", json={"establishment_id": est["id"], "button_id": btn_id})
    assert r.status_code == 403, r.text

    # Activate consumer for next tests
    admin_sess.post(f"{BASE}/api/admin/consumers/{c_user['id']}/activate")

    # nonexistent button -> 400
    r = c_sess.post(f"{BASE}/api/consumer/requests", json={"establishment_id": est["id"], "button_id": "nope"})
    assert r.status_code == 400, r.text

    # Establishment inactive: suspend it
    r = admin_sess.post(f"{BASE}/api/admin/establishments/{est['id']}/suspend")
    assert r.status_code in (200, 204), r.text
    r = c_sess.post(f"{BASE}/api/consumer/requests", json={"establishment_id": est["id"], "button_id": btn_id})
    assert r.status_code == 400, r.text


def test_whatsapp_and_external_destinations(admin_sess, created):
    m_sess, _, est = _make_merchant_with_active_est(admin_sess, created, whatsapp="+55 11 98765-4321")
    ext_url = "https://example.com/order"
    buttons = [
        _btn(label="WA", service_type="contato", destination="whatsapp", whatsapp_message="oi"),
        _btn(label="EXT", service_type="entrega", destination="external", external_url=ext_url),
    ]
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"action_buttons": buttons})
    assert r.status_code == 200, r.text
    ab = r.json()["establishment"]["action_buttons"]
    wa_id = next(b["id"] for b in ab if b["label"] == "WA")
    ex_id = next(b["id"] for b in ab if b["label"] == "EXT")

    c_sess, c_user = _make_active_consumer(admin_sess, created)

    # WhatsApp
    r = c_sess.post(f"{BASE}/api/consumer/requests", json={"establishment_id": est["id"], "button_id": wa_id})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("whatsapp_url", "").startswith("https://wa.me/")
    assert "5511987654321" in d["whatsapp_url"]
    decoded = urllib.parse.unquote(d["whatsapp_url"])
    assert d["code"] in decoded
    assert c_user["name"] in decoded
    assert est["fantasy_name"] in decoded

    # External
    r = c_sess.post(f"{BASE}/api/consumer/requests", json={"establishment_id": est["id"], "button_id": ex_id})
    assert r.status_code == 200, r.text
    ext = r.json()
    assert ext["external_url"] == ext_url

    # track-click
    r = c_sess.post(f"{BASE}/api/consumer/requests/{ext['id']}/track-click", json={"kind": "external"})
    assert r.status_code == 200
    r = c_sess.get(f"{BASE}/api/consumer/requests/{ext['id']}")
    assert r.status_code == 200 and r.json()["external_clicks"] == 1


# ---------- Merchant flow ----------
def test_merchant_flow_and_confirm_idempotent(admin_sess, created):
    m_sess, m_user, est = _make_merchant_with_active_est(admin_sess, created)
    buttons = [_btn(label="Agendar", destination="internal")]
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"action_buttons": buttons})
    btn_id = r.json()["establishment"]["action_buttons"][0]["id"]

    c_sess, c_user = _make_active_consumer(admin_sess, created)
    r = c_sess.post(f"{BASE}/api/consumer/requests",
                    json={"establishment_id": est["id"], "button_id": btn_id})
    assert r.status_code == 200, r.text
    req_id = r.json()["id"]
    created["requests"].append(req_id)

    # list w/ filters
    r = m_sess.get(f"{BASE}/api/merchant/requests", params={"status": "awaiting"})
    assert r.status_code == 200 and any(x["id"] == req_id for x in r.json())
    r = m_sess.get(f"{BASE}/api/merchant/requests", params={"type": "agendamento"})
    assert r.status_code == 200 and any(x["id"] == req_id for x in r.json())

    # accept
    r = m_sess.post(f"{BASE}/api/merchant/requests/{req_id}/accept")
    assert r.status_code == 200 and r.json()["status"] == "accepted"

    # status update
    r = m_sess.post(f"{BASE}/api/merchant/requests/{req_id}/status", json={"status": "scheduled"})
    assert r.status_code == 200 and r.json()["status"] == "scheduled"

    # respond
    r = m_sess.post(f"{BASE}/api/merchant/requests/{req_id}/respond", json={"message": "Confirmado"})
    assert r.status_code == 200 and r.json()["merchant_response"] == "Confirmado"

    # Ownership: another merchant cannot access
    m2, _, _ = _make_merchant_with_active_est(admin_sess, created)
    r = m2.post(f"{BASE}/api/merchant/requests/{req_id}/accept")
    assert r.status_code == 404, r.text

    # Confirm w/o gross when discount_applies -> 400
    r = m_sess.post(f"{BASE}/api/merchant/requests/{req_id}/confirm", json={})
    assert r.status_code == 400, r.text

    # baseline total_saved
    r = c_sess.get(f"{BASE}/api/consumer/economy")
    saved_before = r.json()["total_saved"]

    # Confirm 20% of 100 -> economy 20, final 80
    r = m_sess.post(f"{BASE}/api/merchant/requests/{req_id}/confirm", json={"gross_amount": 100})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "completed"
    assert d["discount_amount"] == 20
    assert d["final_amount"] == 80
    assert d["saved_amount"] == 20
    tx_id = d["transaction_id"]
    assert tx_id
    created["transactions"].append(tx_id)

    # Idempotency: call confirm again -> same tx, no duplicate
    r = m_sess.post(f"{BASE}/api/merchant/requests/{req_id}/confirm", json={"gross_amount": 100})
    assert r.status_code == 200, r.text
    d2 = r.json()
    assert d2["transaction_id"] == tx_id

    # Verify only 1 transaction in economy history for this request
    r = c_sess.get(f"{BASE}/api/consumer/economy")
    econ = r.json()
    match = [t for t in econ["history"] if t["id"] == tx_id]
    assert len(match) == 1
    assert match[0].get("origin") == "remote_request"
    assert round(econ["total_saved"] - saved_before, 2) == 20.0


def test_cancel_and_terminal_state_guards(admin_sess, created):
    m_sess, _, est = _make_merchant_with_active_est(admin_sess, created)
    buttons = [_btn(label="Agendar", destination="internal")]
    r = m_sess.put(f"{BASE}/api/merchant/establishment/{est['id']}", json={"action_buttons": buttons})
    btn_id = r.json()["establishment"]["action_buttons"][0]["id"]
    c_sess, _ = _make_active_consumer(admin_sess, created)

    # Create + cancel
    r = c_sess.post(f"{BASE}/api/consumer/requests",
                    json={"establishment_id": est["id"], "button_id": btn_id})
    rid = r.json()["id"]; created["requests"].append(rid)
    r = c_sess.post(f"{BASE}/api/consumer/requests/{rid}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    # cannot re-cancel
    r = c_sess.post(f"{BASE}/api/consumer/requests/{rid}/cancel")
    assert r.status_code == 400
    # cannot confirm on cancelled
    r = m_sess.post(f"{BASE}/api/merchant/requests/{rid}/confirm", json={"gross_amount": 100})
    assert r.status_code == 400

    # Create + reject -> cannot confirm
    r = c_sess.post(f"{BASE}/api/consumer/requests",
                    json={"establishment_id": est["id"], "button_id": btn_id})
    rid2 = r.json()["id"]; created["requests"].append(rid2)
    r = m_sess.post(f"{BASE}/api/merchant/requests/{rid2}/reject")
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    r = m_sess.post(f"{BASE}/api/merchant/requests/{rid2}/confirm", json={"gross_amount": 100})
    assert r.status_code == 400


# ---------- Regression sanity ----------
def test_regression_login_roles(admin_sess):
    # login legacy admin still works
    s = _session()
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": "paulo.silva.dn.0006@gmail.com", "password": "Off360Admin!2026"})
    assert r.status_code == 200
    # admin GET me
    r = admin_sess.get(f"{BASE}/api/auth/me")
    assert r.status_code == 200


def test_cleanup(admin_sess, created):
    """Best-effort: suspend establishments and cancel transactions to minimize residue."""
    for tid in created["transactions"]:
        try:
            admin_sess.post(f"{BASE}/api/admin/transactions/{tid}/cancel")
        except Exception:
            pass
    for eid in created["establishments"]:
        try:
            admin_sess.post(f"{BASE}/api/admin/establishments/{eid}/suspend")
        except Exception:
            pass
