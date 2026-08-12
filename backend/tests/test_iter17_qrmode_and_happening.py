"""
Iteration 17 — QR Mode selector sync + Story ajustes finais.
Focus:
  1) GET /merchant/qr retorna validation_mode.
  2) PUT /merchant/establishment/{eid} {validation_mode} altera valor e reflete em ambos GETs.
  3) Persistência após novo login.
  4) Regressão happening: now (com happening_info) / soon / outside.
  5) Regressão moderação (rejected/review/approved).
Dados QA_AUTOMATED_ / qa_automated_ removidos ao final.
"""
import os, uuid, requests, pytest
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "paulo.silva.dn.0006@gmail.com"
ADMIN_PASSWORD = "Off360Admin!2026"
QA_PASS = "QaPass@2026"


def _hex(): return uuid.uuid4().hex[:10]

def _client():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"}); return s

def _login(email, password):
    s = _client()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return s

def _register(role, extra=None):
    s = _client()
    email = f"qa_automated_{_hex()}@testoff360.com"
    payload = {"name": f"QA_AUTOMATED_{role[:3].upper()}_{_hex()[:4]}",
               "email": email, "phone": "11999990000",
               "password": QA_PASS, "role": role,
               "city": "São Paulo", "neighborhood": "Centro"}
    if extra: payload.update(extra)
    r = s.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, f"register {role}: {r.status_code} {r.text}"
    return s, r.json(), email


@pytest.fixture(scope="module")
def admin(): return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def env(admin):
    cats = admin.get(f"{API}/admin/categories").json()
    assert cats, "sem categorias"
    cat = cats[0]["id"]
    m_sess, m_user, m_email = _register("merchant", {"fantasy_name": f"QA_AUTOMATED_M17_{_hex()[:4]}", "category_id": cat})
    admin.post(f"{API}/admin/merchants/{m_user['id']}/activate")
    r = m_sess.post(f"{API}/merchant/establishments", json={
        "fantasy_name": f"QA_AUTOMATED_EST17_{_hex()[:4]}",
        "category_id": cat, "discount_percent": 15,
        "address": "Rua QA, 17", "neighborhood": "Centro", "city": "São Paulo",
        "lat": -23.55, "lng": -46.63})
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    admin.post(f"{API}/admin/establishments/{eid}/activate")
    c_sess, c_user, c_email = _register("consumer")
    admin.post(f"{API}/admin/consumers/{c_user['id']}/activate")
    c_sess = _login(c_email, QA_PASS)
    return {"admin": admin, "m": m_sess, "m_email": m_email, "eid": eid, "c": c_sess}


# ------------------ QR MODE ------------------
class TestQrMode:
    def test_qr_returns_validation_mode(self, env):
        r = env["m"].get(f"{API}/merchant/qr")
        assert r.status_code == 200, r.text
        j = r.json()
        assert "validation_mode" in j, "GET /merchant/qr deve retornar validation_mode"
        assert j["validation_mode"] in ("controlled", "fast")

    def test_switch_to_fast_and_persist(self, env):
        eid = env["eid"]
        r = env["m"].put(f"{API}/merchant/establishment/{eid}", json={"validation_mode": "fast"})
        assert r.status_code == 200, r.text
        # reflect in /merchant/qr
        q = env["m"].get(f"{API}/merchant/qr").json()
        assert q["validation_mode"] == "fast"
        # reflect in /merchant/establishment
        e = env["m"].get(f"{API}/merchant/establishment").json()
        assert e.get("validation_mode") == "fast"

    def test_switch_back_to_controlled_and_relogin_persist(self, env):
        eid = env["eid"]
        env["m"].put(f"{API}/merchant/establishment/{eid}", json={"validation_mode": "controlled"})
        # Re-login e revalidar
        s2 = _login(env["m_email"], QA_PASS)
        q = s2.get(f"{API}/merchant/qr").json()
        assert q["validation_mode"] == "controlled", f"persistência falhou: {q}"


# ------------------ HAPPENING FLOW ------------------
def _new_story(env, category="offer", title="QA_AUTOMATED_S"):
    r = env["m"].post(f"{API}/merchant/stories", json={
        "establishment_id": env["eid"], "category": category,
        "title": title, "text": "promo"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _mk_boost(env, ds_min, de_min, title="QA_AUTOMATED_TITLE"):
    sid = _new_story(env, category="event", title=f"QA_AUTOMATED_STORY_{_hex()[:4]}")
    tz = timezone(timedelta(hours=-3))
    now_br = datetime.now(tz)
    start = now_br + timedelta(minutes=ds_min)
    end = now_br + timedelta(minutes=de_min)
    payload = {"establishment_id": env["eid"], "story_id": sid, "region": "Centro/SP",
               "happening_title": title,
               "happening_date": start.strftime("%Y-%m-%d"),
               "happening_start": start.strftime("%H:%M"),
               "happening_end": end.strftime("%H:%M")}
    r = env["m"].post(f"{API}/merchant/boosts", json=payload)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    env["admin"].post(f"{API}/admin/boosts/{bid}/approve")
    env["admin"].post(f"{API}/admin/boosts/{bid}/activate", json={"priority": 5})
    return sid, bid


class TestHappening:
    def test_now_with_full_info(self, env):
        title = "APROVEITE A PROMOÇÃO"
        sid, _ = _mk_boost(env, -10, +50, title=title)
        data = env["c"].get(f"{API}/consumer/home").json()
        g = next((g for g in data["stories"] if any(s["id"] == sid for s in g["stories"])), None)
        assert g is not None, "grupo do story não encontrado"
        assert g.get("sponsored") is True
        assert g.get("happening") == "now"
        info = g.get("happening_info") or {}
        assert info.get("title") == title
        assert info.get("region") == "Centro/SP"
        assert info.get("date") and info.get("start") and info.get("end")

    def test_outside_window_returns_none(self):
        from routes_boosts import happening_status
        tz = timezone(timedelta(hours=-3))
        past = datetime.now(tz) - timedelta(hours=3)
        end = past + timedelta(hours=1)
        b = {"happening_date": past.strftime("%Y-%m-%d"),
             "happening_start": past.strftime("%H:%M"),
             "happening_end": end.strftime("%H:%M")}
        assert happening_status(b) is None

    def test_soon_status(self):
        from routes_boosts import happening_status
        tz = timezone(timedelta(hours=-3))
        soon = datetime.now(tz) + timedelta(minutes=30)
        end = soon + timedelta(hours=1)
        b = {"happening_date": soon.strftime("%Y-%m-%d"),
             "happening_start": soon.strftime("%H:%M"),
             "happening_end": end.strftime("%H:%M")}
        assert happening_status(b) == "soon"

    def test_now_status(self):
        from routes_boosts import happening_status
        tz = timezone(timedelta(hours=-3))
        s = datetime.now(tz) - timedelta(minutes=5)
        e = datetime.now(tz) + timedelta(minutes=30)
        b = {"happening_date": s.strftime("%Y-%m-%d"),
             "happening_start": s.strftime("%H:%M"),
             "happening_end": e.strftime("%H:%M")}
        assert happening_status(b) == "now"


# ------------------ MODERATION REGRESSION ------------------
class TestModerationRegression:
    def test_rejected(self, env):
        sid = _new_story(env, title=f"QA_AUTOMATED_BLK_{_hex()[:4]}")
        # substituir texto por termo bloqueado via update? mais simples: criar boost e ler decisão baseada em story
        # Estratégia: criar novo story com termo bloqueado direto
        r = env["m"].post(f"{API}/merchant/stories", json={
            "establishment_id": env["eid"], "category": "offer",
            "title": "QA_AUTOMATED_BLK", "text": "oferecemos pornografia explicita"})
        assert r.status_code == 200
        sid2 = r.json()["id"]
        b = env["m"].post(f"{API}/merchant/boosts", json={
            "establishment_id": env["eid"], "story_id": sid2}).json()
        assert b["status"] == "rejected"
        assert b.get("reject_reason")
        assert b["moderation"]["decision"] == "rejected"

    def test_review(self, env):
        r = env["m"].post(f"{API}/merchant/stories", json={
            "establishment_id": env["eid"], "category": "offer",
            "title": "QA_AUTOMATED_REV", "text": "cura garantida para tudo"})
        sid = r.json()["id"]
        b = env["m"].post(f"{API}/merchant/boosts", json={
            "establishment_id": env["eid"], "story_id": sid}).json()
        assert b["status"] == "awaiting"
        assert b["moderation"]["decision"] == "review"

    def test_clean(self, env):
        r = env["m"].post(f"{API}/merchant/stories", json={
            "establishment_id": env["eid"], "category": "offer",
            "title": "QA_AUTOMATED_OK", "text": "aproveite o happy hour"})
        sid = r.json()["id"]
        b = env["m"].post(f"{API}/merchant/boosts", json={
            "establishment_id": env["eid"], "story_id": sid}).json()
        assert b["status"] == "awaiting"
        assert b["moderation"]["decision"] == "approved"


# ------------------ CLEANUP ------------------
def test_zz_cleanup(env):
    from pymongo import MongoClient
    from dotenv import dotenv_values
    envf = dotenv_values("/app/backend/.env")
    mongo_url = os.environ.get("MONGO_URL") or envf.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME") or envf.get("DB_NAME")
    cli = MongoClient(mongo_url); db = cli[db_name]
    PROTECTED = {"paulo@off360.com", "paulo.silva.dn.0006@gmail.com"}
    qa_users = list(db.users.find({"email": {"$regex": "^qa_automated_"}}))
    uids = [u["id"] for u in qa_users if u.get("email") not in PROTECTED]
    if uids:
        qa_ests = list(db.establishments.find({"$or": [
            {"owner_id": {"$in": uids}},
            {"fantasy_name": {"$regex": "^QA_AUTOMATED_"}}]}))
        eids = [e["id"] for e in qa_ests if e.get("fantasy_name") != "HP Higienização de Sofá"]
        if eids:
            db.stories.delete_many({"establishment_id": {"$in": eids}})
            db.boosts.delete_many({"establishment_id": {"$in": eids}})
            db.transactions.delete_many({"establishment_id": {"$in": eids}})
            db.ratings.delete_many({"establishment_id": {"$in": eids}})
            db.establishments.delete_many({"id": {"$in": eids}})
        db.interest_events.delete_many({"user_id": {"$in": uids}})
        db.notifications.delete_many({"recipient_id": {"$in": uids}})
        db.tickets.delete_many({"consumer_id": {"$in": uids}})
        db.users.delete_many({"id": {"$in": uids}})
    db.stories.delete_many({"title": {"$regex": "^QA_AUTOMATED_"}})
    db.boosts.delete_many({"happening_title": {"$regex": "^QA_AUTOMATED_"}})
    for e in ("paulo@off360.com", "paulo.silva.dn.0006@gmail.com"):
        assert db.users.find_one({"email": e}) is not None, f"conta REAL {e} sumiu!"
    print(f"[CLEANUP] {len(uids)} QA_AUTOMATED_ users removed")
