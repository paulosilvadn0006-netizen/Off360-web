"""
Iteration 15 — FASE 2 backend tests (feed 'Para Você', Acontecendo Agora,
notificações inteligentes por favoritos com anti-spam e preferência).

REGRA CRÍTICA: apenas dados prefixados QA_AUTOMATED_. Cleanup ao final.
NÃO tocar em paulo@off360.com, paulo.silva.dn.0006@gmail.com, Pedro Silva ou HP Higienização de Sofá.
"""
import os
import uuid
import time
import requests
import pytest
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://off360-preview.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "paulo.silva.dn.0006@gmail.com"
ADMIN_PASSWORD = "Off360Admin!2026"
QA_PASS = "QaPass@2026"


def _hex():
    return uuid.uuid4().hex[:10]


def _client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(email, password):
    s = _client()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return s


def _register(role, extra=None):
    s = _client()
    email = f"qa_automated_{_hex()}@testoff360.com"
    payload = {
        "name": f"QA_AUTOMATED_{role[:3].upper()}_{_hex()[:4]}",
        "email": email, "phone": "11999990000",
        "password": QA_PASS, "role": role,
        "city": "São Paulo", "neighborhood": "Centro",
    }
    if extra:
        payload.update(extra)
    r = s.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, f"Register {role} failed: {r.status_code} {r.text}"
    u = r.json()
    return s, u, email


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def created_ids():
    # keeps track for cleanup
    return {"users": [], "ests": [], "boosts": [], "stories": []}


@pytest.fixture(scope="module")
def setup_env(admin, created_ids):
    """Cria 1 merchant + 2 establishments aprovados/ativos + 2 consumers ativados."""
    # categories: precisa de category_id
    cats = admin.get(f"{API}/admin/categories").json()
    assert cats, "sem categorias — impossível prosseguir"
    cat_a = cats[0]["id"]
    cat_b = cats[1]["id"] if len(cats) > 1 else cats[0]["id"]

    # merchant
    m_sess, m_user, m_email = _register("merchant", {
        "fantasy_name": "QA_AUTOMATED_MERCH", "category_id": cat_a,
    })
    admin.post(f"{API}/admin/merchants/{m_user['id']}/activate")
    created_ids["users"].append(m_user["id"])

    # 2 establishments
    est_ids = []
    for i, cid in enumerate([cat_a, cat_b]):
        r = m_sess.post(f"{API}/merchant/establishments", json={
            "fantasy_name": f"QA_AUTOMATED_EST_{i}_{_hex()[:4]}",
            "category_id": cid, "discount_percent": 20 + i,
            "address": "Rua Teste, 100", "neighborhood": "Centro", "city": "São Paulo",
            "lat": -23.55, "lng": -46.633,
        })
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        admin.post(f"{API}/admin/establishments/{eid}/activate")
        est_ids.append(eid)
        created_ids["ests"].append(eid)

    # 2 consumers
    c1_sess, c1, c1_email = _register("consumer")
    c2_sess, c2, c2_email = _register("consumer")
    admin.post(f"{API}/admin/consumers/{c1['id']}/activate")
    admin.post(f"{API}/admin/consumers/{c2['id']}/activate")
    created_ids["users"].extend([c1["id"], c2["id"]])

    # Re-login para pegar status atualizado (assinatura ativa)
    c1_sess = _login(c1_email, QA_PASS)
    c2_sess = _login(c2_email, QA_PASS)

    return {
        "admin": admin, "m": m_sess, "m_user": m_user,
        "c1": c1_sess, "c1_user": c1, "c1_email": c1_email,
        "c2": c2_sess, "c2_user": c2, "c2_email": c2_email,
        "est_ids": est_ids, "cat_a": cat_a, "cat_b": cat_b,
    }


# ---------------- FEED PARA VOCÊ ----------------
class TestFeedParaVoce:
    def test_new_consumer_has_no_signals(self, setup_env):
        """Consumidor NOVO sem histórico → for_you=false."""
        r = setup_env["c2"].get(f"{API}/consumer/home")
        assert r.status_code == 200
        data = r.json()
        # c2 pode ter sinais se algum teste anterior rodou; usar consumer fresco
        # aqui garantimos com um consumer totalmente novo
        s3, u3, e3 = _register("consumer")
        setup_env["admin"].post(f"{API}/admin/consumers/{u3['id']}/activate")
        s3 = _login(e3, QA_PASS)
        setup_env["c1"].headers  # keep-alive
        # register for cleanup
        r2 = s3.get(f"{API}/consumer/home")
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["for_you"] is False, f"consumidor NOVO deveria for_you=false, got {d2['for_you']}"

    def test_signals_generate_for_you_true(self, setup_env):
        """Após visitar estabelecimento, for_you=true e o est visitado sobe no featured."""
        c1 = setup_env["c1"]
        est_ids = setup_env["est_ids"]
        # gera sinais no est_ids[1] (peso 2 por visit)
        r = c1.get(f"{API}/consumer/establishments/{est_ids[1]}")
        assert r.status_code == 200
        # e favorita est_ids[1] (peso 3)
        c1.post(f"{API}/consumer/favorites/{est_ids[1]}")

        r = c1.get(f"{API}/consumer/home")
        assert r.status_code == 200
        d = r.json()
        assert d["for_you"] is True
        feat_ids = [e["id"] for e in d["featured"]]
        assert est_ids[1] in feat_ids
        # est visitado deve aparecer antes do não visitado (se ambos aparecerem)
        if est_ids[0] in feat_ids:
            assert feat_ids.index(est_ids[1]) < feat_ids.index(est_ids[0])


# ---------------- ACONTECENDO AGORA ----------------
class TestHappening:
    def _create_boost_now(self, setup_env, delta_start_min=-10, delta_end_min=+50):
        """Cria story + boost com horários relativos ao 'agora' em America/Sao_Paulo (-03:00)."""
        m = setup_env["m"]
        admin = setup_env["admin"]
        eid = setup_env["est_ids"][0]
        # Story primeiro
        st = m.post(f"{API}/merchant/stories", json={
            "establishment_id": eid, "category": "event",
            "title": "QA_AUTOMATED_HAPPENING", "text": "teste",
        })
        assert st.status_code == 200, st.text
        sid = st.json()["id"]

        tz = timezone(timedelta(hours=-3))
        now_br = datetime.now(tz)
        start = now_br + timedelta(minutes=delta_start_min)
        end = now_br + timedelta(minutes=delta_end_min)
        r = m.post(f"{API}/merchant/boosts", json={
            "establishment_id": eid, "story_id": sid,
            "happening_title": "QA_AUTOMATED_EVENT",
            "happening_date": start.strftime("%Y-%m-%d"),
            "happening_start": start.strftime("%H:%M"),
            "happening_end": end.strftime("%H:%M"),
        })
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        admin.post(f"{API}/admin/boosts/{bid}/approve")
        act = admin.post(f"{API}/admin/boosts/{bid}/activate", json={"priority": 5})
        assert act.status_code == 200, act.text
        return sid, bid

    def test_happening_now(self, setup_env):
        sid, bid = self._create_boost_now(setup_env, -10, +50)
        r = setup_env["c1"].get(f"{API}/consumer/home")
        assert r.status_code == 200
        data = r.json()
        # localizar o grupo que contém esse story
        g = next((g for g in data["stories"] if any(s["id"] == sid for s in g["stories"])), None)
        assert g is not None
        assert g.get("happening") == "now", f"expected 'now', got {g.get('happening')}"
        # cleanup marker
        setup_env.setdefault("_boosts", []).append(bid)
        setup_env.setdefault("_stories", []).append(sid)

    def test_happening_soon(self, setup_env):
        # início ~30min à frente
        sid, bid = self._create_boost_now(setup_env, +30, +90)
        r = setup_env["c1"].get(f"{API}/consumer/home")
        data = r.json()
        g = next((g for g in data["stories"] if any(s["id"] == sid for s in g["stories"])), None)
        assert g is not None
        assert g.get("happening") == "soon", f"expected 'soon', got {g.get('happening')}"
        setup_env.setdefault("_boosts", []).append(bid)
        setup_env.setdefault("_stories", []).append(sid)

    def test_happening_none_outside(self, setup_env):
        # janela no passado — apenas verifica que happening_status devolve None diretamente
        from routes_boosts import happening_status
        tz = timezone(timedelta(hours=-3))
        past = datetime.now(tz) - timedelta(hours=4)
        b = {"happening_date": past.strftime("%Y-%m-%d"),
             "happening_start": (past - timedelta(hours=1)).strftime("%H:%M"),
             "happening_end": past.strftime("%H:%M")}
        assert happening_status(b) is None

    def test_happening_crosses_midnight(self, setup_env):
        """Evento com fim < início contabiliza como em andamento (cruza meia-noite)."""
        m = setup_env["m"]
        admin = setup_env["admin"]
        eid = setup_env["est_ids"][0]
        st = m.post(f"{API}/merchant/stories", json={
            "establishment_id": eid, "category": "event",
            "title": "QA_AUTOMATED_MIDNIGHT", "text": "teste",
        }).json()
        sid = st["id"]
        tz = timezone(timedelta(hours=-3))
        now_br = datetime.now(tz)
        # start = 30min atrás; end = start + 30min mas com strings 'HH:MM' invertidas cruzando meia-noite:
        # criamos start=now-30min e end=(start-1h) para simular fim<início — o helper somará +1 dia.
        start = now_br - timedelta(minutes=30)
        end = start - timedelta(hours=1)
        r = m.post(f"{API}/merchant/boosts", json={
            "establishment_id": eid, "story_id": sid,
            "happening_title": "QA_AUTOMATED_CROSS_MID",
            "happening_date": start.strftime("%Y-%m-%d"),
            "happening_start": start.strftime("%H:%M"),
            "happening_end": end.strftime("%H:%M"),
        })
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        admin.post(f"{API}/admin/boosts/{bid}/approve")
        admin.post(f"{API}/admin/boosts/{bid}/activate", json={"priority": 5})
        r2 = setup_env["c1"].get(f"{API}/consumer/home")
        g = next((g for g in r2.json()["stories"] if any(s["id"] == sid for s in g["stories"])), None)
        assert g is not None
        assert g.get("happening") == "now", f"cruzar meia-noite deveria dar 'now', got {g.get('happening')}"
        setup_env.setdefault("_boosts", []).append(bid)
        setup_env.setdefault("_stories", []).append(sid)


# ---------------- NOTIFICAÇÕES INTELIGENTES ----------------
class TestNotifications:
    def _count_fav_notifs(self, sess):
        r = sess.get(f"{API}/notifications")
        assert r.status_code == 200
        d = r.json()
        items = d.get("items") if isinstance(d, dict) else d
        if items is None:
            items = []
        return sum(1 for n in items if n.get("type") == "favorite_update")

    def test_favorite_receives_notif_for_offer(self, setup_env):
        m = setup_env["m"]
        c2 = setup_env["c2"]
        eid = setup_env["est_ids"][0]
        # c2 favorita
        r = c2.post(f"{API}/consumer/favorites/{eid}")
        assert r.status_code == 200
        before = self._count_fav_notifs(c2)
        # merchant publica offer story
        r = m.post(f"{API}/merchant/stories", json={
            "establishment_id": eid, "category": "offer",
            "title": "QA_AUTOMATED_OFFER_1", "text": "promo",
        })
        assert r.status_code == 200
        time.sleep(0.5)
        after = self._count_fav_notifs(c2)
        assert after == before + 1, f"deveria receber 1 nova notif favorite_update; before={before} after={after}"

    def test_antispam_within_6h(self, setup_env):
        m = setup_env["m"]
        c2 = setup_env["c2"]
        eid = setup_env["est_ids"][0]
        before = self._count_fav_notifs(c2)
        # 2º story relevante em <6h
        m.post(f"{API}/merchant/stories", json={
            "establishment_id": eid, "category": "offer",
            "title": "QA_AUTOMATED_OFFER_2", "text": "outra promo",
        })
        time.sleep(0.5)
        after = self._count_fav_notifs(c2)
        assert after == before, f"anti-spam deveria bloquear 2ª notif; before={before} after={after}"

    def test_irrelevant_category_no_notif(self, setup_env):
        m = setup_env["m"]
        c2 = setup_env["c2"]
        eid = setup_env["est_ids"][0]
        before = self._count_fav_notifs(c2)
        m.post(f"{API}/merchant/stories", json={
            "establishment_id": eid, "category": "news",
            "title": "QA_AUTOMATED_NEWS", "text": "irrelevante",
        })
        time.sleep(0.5)
        after = self._count_fav_notifs(c2)
        assert after == before, "categoria irrelevante NÃO deveria gerar notif"

    def test_non_favorite_no_notif(self, setup_env):
        m = setup_env["m"]
        # c1 não favoritou est_ids[0]; mas favoritou est_ids[1] anteriormente
        c1 = setup_env["c1"]
        eid = setup_env["est_ids"][0]
        # garantir que c1 não favorita est 0
        favs = c1.get(f"{API}/consumer/favorites").json()
        assert not any(f["id"] == eid for f in favs)
        before = self._count_fav_notifs(c1)
        m.post(f"{API}/merchant/stories", json={
            "establishment_id": eid, "category": "offer",
            "title": "QA_AUTOMATED_OFFER_NONFAV", "text": "x",
        })
        time.sleep(0.5)
        after = self._count_fav_notifs(c1)
        assert after == before

    def test_notify_preference_off_blocks(self, setup_env):
        """Após POST /consumer/notify-preference {enabled:false}, sem novas notifs."""
        c2 = setup_env["c2"]
        m = setup_env["m"]
        # Setup: outro est para bypassar dedup
        eid = setup_env["est_ids"][1]
        # c2 favorita est_ids[1] também
        c2.post(f"{API}/consumer/favorites/{eid}")
        # Desativa
        r = c2.post(f"{API}/consumer/notify-preference", json={"enabled": False})
        assert r.status_code == 200
        assert r.json()["notify_favorites"] is False
        before = self._count_fav_notifs(c2)
        m.post(f"{API}/merchant/stories", json={
            "establishment_id": eid, "category": "offer",
            "title": "QA_AUTOMATED_OFFER_BLOCKED", "text": "bloqueada",
        })
        time.sleep(0.5)
        after = self._count_fav_notifs(c2)
        assert after == before, "com notify_favorites=false não deveria receber"
        # Reativa
        c2.post(f"{API}/consumer/notify-preference", json={"enabled": True})


# ---------------- CLEANUP ----------------
def test_zz_cleanup(setup_env, created_ids):
    """Remove TODOS dados QA_AUTOMATED_ criados nesta run."""
    from pymongo import MongoClient
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    mongo_url = os.environ.get("MONGO_URL") or env.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME") or env.get("DB_NAME")
    cli = MongoClient(mongo_url)
    db = cli[db_name]

    PROTECTED_EMAILS = {"paulo@off360.com", "paulo.silva.dn.0006@gmail.com", "paulo.silva.dn.06@gmail.com"}

    # Delete users com prefix qa_automated_
    qa_users = list(db.users.find({"email": {"$regex": "^qa_automated_"}}))
    uids = [u["id"] for u in qa_users if u.get("email") not in PROTECTED_EMAILS]
    if uids:
        # ests dos merchants
        qa_ests = list(db.establishments.find({"$or": [
            {"owner_id": {"$in": uids}},
            {"fantasy_name": {"$regex": "^QA_AUTOMATED_"}},
        ]}))
        eids = [e["id"] for e in qa_ests if e.get("fantasy_name") not in ("HP Higienização de Sofá",)]
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

    # Extra safety: qualquer story/boost com título QA_AUTOMATED_ órfão
    db.stories.delete_many({"title": {"$regex": "^QA_AUTOMATED_"}})
    db.boosts.delete_many({"$or": [
        {"happening_title": {"$regex": "^QA_AUTOMATED_"}},
        {"story_title": {"$regex": "^QA_AUTOMATED_"}},
    ]})
    print(f"[CLEANUP] deleted {len(uids)} users QA_AUTOMATED_")
