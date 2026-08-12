"""Iteration 14 — ajustes Fase 1:
- BOMBANDO ranking coletivo (fav_count*3 + views + interest weights) desc, sem limitar.
- Curtidas coletivas (fav_count) em cards; POST /favorites/{id} retorna {is_favorite, fav_count}.
- Avaliação 1..5 via POST /establishments/{id}/rate; upsert (não duplica); média/contagem reais.
- my_rating persistente no detail; stars fora de 1..5 => 400.
- Prova social exposta em _est_public (fav_count, rating_avg, rating_count).
- perto: distance_km presente quando lat/lng; sem geo => sem distância.

Prefixo QA_AUTOMATED_. Cleanup no final via fixture teardown.
"""
import os
import uuid
import requests
import pytest


def _load_frontend_env():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
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
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()


def _register(s, role, name, email, password, neighborhood="Centro", city="São Paulo",
              fantasy_name=None, category_id=None):
    body = {
        "role": role, "name": name, "email": email, "password": password,
        "phone": "11999999999", "city": city, "neighborhood": neighborhood,
    }
    if fantasy_name: body["fantasy_name"] = fantasy_name
    if category_id: body["category_id"] = category_id
    r = s.post(f"{API}/auth/register", json=body)
    assert r.status_code == 200, f"register {role}: {r.status_code} {r.text}"
    return r.json()


def _create_est(m, fantasy, discount, neighborhood="Centro", lat=None, lng=None):
    payload = {
        "fantasy_name": fantasy, "description": "QA_AUTOMATED_",
        "neighborhood": neighborhood, "city": "São Paulo",
        "whatsapp": "11999999999",
        "discount_percent": discount, "discount_rules": "QA",
    }
    if lat is not None: payload["lat"] = lat
    if lng is not None: payload["lng"] = lng
    r = m.post(f"{API}/merchant/establishments", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def env():
    tag = uuid.uuid4().hex[:8]
    pwd = "QaPass@2026"

    # merchant precisa de fantasy_name no register
    merchant_email = f"qa_automated_{tag}_m@testoff360.com"
    c1_email = f"qa_automated_{tag}_c1@testoff360.com"
    c2_email = f"qa_automated_{tag}_c2@testoff360.com"

    m = _sess()
    _register(m, "merchant", f"QA_AUTOMATED_ Merch {tag}", merchant_email, pwd,
              fantasy_name=f"QA_AUTOMATED_ Loja {tag}")

    e1 = _create_est(m, f"QA_AUTOMATED_ E1 {tag}", 30, "Centro", lat=-23.55, lng=-46.633)
    e2 = _create_est(m, f"QA_AUTOMATED_ E2 {tag}", 15, "Pinheiros", lat=-23.567, lng=-46.693)
    e3 = _create_est(m, f"QA_AUTOMATED_ E3 {tag}", 50, "Vila Mariana")

    a = _sess()
    _login(a, ADMIN_EMAIL, ADMIN_PASSWORD)
    for e in (e1, e2, e3):
        r = a.post(f"{API}/admin/establishments/{e['id']}/activate")
        assert r.status_code == 200, r.text

    c1 = _sess()
    cu1 = _register(c1, "consumer", f"QA_AUTOMATED_ C1 {tag}", c1_email, pwd, neighborhood="Centro")
    a.post(f"{API}/admin/consumers/{cu1['id']}/activate")
    _login(c1, c1_email, pwd)

    c2 = _sess()
    cu2 = _register(c2, "consumer", f"QA_AUTOMATED_ C2 {tag}", c2_email, pwd, neighborhood="Centro")
    a.post(f"{API}/admin/consumers/{cu2['id']}/activate")
    _login(c2, c2_email, pwd)

    yield {
        "tag": tag, "m": m, "a": a, "c1": c1, "c2": c2,
        "e1": e1["id"], "e2": e2["id"], "e3": e3["id"],
        "c1_email": c1_email, "c2_email": c2_email, "pwd": pwd,
        "c1_id": cu1["id"], "c2_id": cu2["id"],
    }

    # Cleanup direto no Mongo (users, ests, ratings, interest_events, stories QA_AUTOMATED_)
    import asyncio, sys
    sys.path.insert(0, "/app/backend")
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = None
    db_name = None
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith("MONGO_URL="): mongo_url = line.split("=",1)[1].strip().strip('"')
            if line.startswith("DB_NAME="): db_name = line.split("=",1)[1].strip().strip('"')

    async def _clean():
        cli = AsyncIOMotorClient(mongo_url)
        db = cli[db_name]
        est_ids = [e1["id"], e2["id"], e3["id"]]
        user_ids = [cu1["id"], cu2["id"]]
        await db.ratings.delete_many({"establishment_id": {"$in": est_ids}})
        await db.ratings.delete_many({"user_id": {"$in": user_ids}})
        await db.interest_events.delete_many({"establishment_id": {"$in": est_ids}})
        await db.interest_events.delete_many({"user_id": {"$in": user_ids}})
        await db.stories.delete_many({"establishment_id": {"$in": est_ids}})
        await db.transactions.delete_many({"establishment_id": {"$in": est_ids}})
        await db.establishments.delete_many({"id": {"$in": est_ids}})
        # remover merchant
        await db.users.delete_many({"email": merchant_email})
        await db.users.delete_many({"id": {"$in": user_ids}})
        cli.close()
    asyncio.get_event_loop().run_until_complete(_clean())


# ---------- FAV COUNT COLETIVO ----------
def test_favcount_two_consumers_collective(env):
    c1, c2 = env["c1"], env["c2"]
    eid = env["e2"]

    # Estado inicial
    r0 = c1.get(f"{API}/consumer/establishments/{eid}")
    assert r0.status_code == 200
    base = r0.json().get("fav_count", 0)

    # c1 favorita
    r = c1.post(f"{API}/consumer/favorites/{eid}")
    assert r.status_code == 200
    j = r.json()
    assert j["is_favorite"] is True
    assert j["fav_count"] == base + 1, f"esperava {base+1}, veio {j['fav_count']}"

    # c2 favorita o MESMO -> fav_count deve virar base+2
    r = c2.post(f"{API}/consumer/favorites/{eid}")
    assert r.status_code == 200
    j = r.json()
    assert j["is_favorite"] is True
    assert j["fav_count"] == base + 2, f"coletivo esperado base+2, veio {j['fav_count']}"

    # c1 desfavorita -> base+1
    r = c1.post(f"{API}/consumer/favorites/{eid}")
    assert r.json()["fav_count"] == base + 1

    # Persistência: c1 relogin, fav_count coletivo mantém em base+1 (c2 ainda tem)
    c1b = _sess()
    _login(c1b, env["c1_email"], env["pwd"])
    rd = c1b.get(f"{API}/consumer/establishments/{eid}")
    assert rd.status_code == 200
    assert rd.json()["fav_count"] == base + 1
    assert rd.json()["is_favorite"] is False  # c1 já desfavoritou

    # c2 relogin: is_favorite True
    c2b = _sess()
    _login(c2b, env["c2_email"], env["pwd"])
    rd2 = c2b.get(f"{API}/consumer/establishments/{eid}")
    assert rd2.json()["is_favorite"] is True
    assert rd2.json()["fav_count"] == base + 1

    # cleanup: c2 desfavorita
    c2b.post(f"{API}/consumer/favorites/{eid}")


# ---------- RATINGS ----------
def test_rate_upsert_avg_count(env):
    c1, c2 = env["c1"], env["c2"]
    eid = env["e3"]  # E3 limpo

    # c1 = 4
    r = c1.post(f"{API}/consumer/establishments/{eid}/rate", json={"stars": 4})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["my_rating"] == 4
    assert j["rating_count"] == 1
    assert j["rating_avg"] == 4.0

    # c2 = 5 -> avg 4.5, count 2
    r = c2.post(f"{API}/consumer/establishments/{eid}/rate", json={"stars": 5})
    assert r.status_code == 200
    j = r.json()
    assert j["rating_count"] == 2
    assert j["rating_avg"] == 4.5

    # c1 muda para 2 -> avg (2+5)/2=3.5, count SEM aumentar (2)
    r = c1.post(f"{API}/consumer/establishments/{eid}/rate", json={"stars": 2})
    assert r.status_code == 200
    j = r.json()
    assert j["my_rating"] == 2
    assert j["rating_count"] == 2, f"count deveria ficar em 2 (upsert), veio {j['rating_count']}"
    assert j["rating_avg"] == 3.5

    # Detail expõe my_rating e prova social
    d = c1.get(f"{API}/consumer/establishments/{eid}")
    assert d.status_code == 200
    body = d.json()
    assert body["my_rating"] == 2
    assert body["rating_count"] == 2
    assert body["rating_avg"] == 3.5

    # Persistência após logout/login de c1
    c1b = _sess()
    _login(c1b, env["c1_email"], env["pwd"])
    d2 = c1b.get(f"{API}/consumer/establishments/{eid}")
    assert d2.json()["my_rating"] == 2


def test_rate_invalid_stars_400(env):
    c1 = env["c1"]
    eid = env["e1"]
    for bad in (0, 6, -1, 10):
        r = c1.post(f"{API}/consumer/establishments/{eid}/rate", json={"stars": bad})
        assert r.status_code == 400, f"stars={bad} deveria ser 400, veio {r.status_code}"


# ---------- SOCIAL PROOF nos rows/detail ----------
def test_social_proof_fields_in_est_public(env):
    c1 = env["c1"]
    r = c1.get(f"{API}/consumer/discover", params={"filter": "novidades"})
    assert r.status_code == 200
    items = r.json()["items"]
    ours = next((i for i in items if i["id"] == env["e3"]), None)
    assert ours is not None
    assert "fav_count" in ours
    assert "rating_avg" in ours
    assert "rating_count" in ours
    # E3 tem rating_count = 2 (test anterior)
    assert ours["rating_count"] == 2
    assert ours["rating_avg"] == 3.5


# ---------- BOMBANDO ranking coletivo ----------
def test_bombando_ranking_collective(env):
    c1 = env["c1"]
    # Gera engajamento em e1: c1 favorita
    c1.post(f"{API}/consumer/favorites/{env['e1']}")
    # c2 também
    env["c2"].post(f"{API}/consumer/favorites/{env['e1']}")

    r = c1.get(f"{API}/consumer/discover", params={"filter": "bombando"})
    assert r.status_code == 200
    body = r.json()
    assert body["filter"] == "bombando"
    items = body["items"]
    # Não limita a 3/5/6 — accept qualquer len; garantir que retorna nossos 3
    ours = [i for i in items if i["id"] in (env["e1"], env["e2"], env["e3"])]
    assert len(ours) == 3
    # Score de e1 = fav_count(2)*3 + ... > e3 (rating não conta) -> e1 deve estar no topo entre nossos
    ids_order = [i["id"] for i in items if i["id"] in (env["e1"], env["e2"], env["e3"])]
    assert ids_order[0] == env["e1"], f"esperava e1 primeiro no bombando, ordem={ids_order}"

    # cleanup: desfavoritar
    c1.post(f"{API}/consumer/favorites/{env['e1']}")
    env["c2"].post(f"{API}/consumer/favorites/{env['e1']}")


# ---------- PERTO distance_km ----------
def test_perto_with_geo_returns_distance(env):
    c1 = env["c1"]
    r = c1.get(f"{API}/consumer/discover", params={"filter": "perto", "lat": -23.55, "lng": -46.633})
    assert r.status_code == 200
    items = r.json()["items"]
    e1_row = next(i for i in items if i["id"] == env["e1"])
    assert e1_row.get("distance_km") is not None
    assert e1_row["distance_km"] < 1.0


def test_perto_without_geo_no_distance(env):
    c1 = env["c1"]
    r = c1.get(f"{API}/consumer/discover", params={"filter": "perto"})
    assert r.status_code == 200
    items = r.json()["items"]
    for i in items:
        assert i.get("distance_km") is None, f"sem geo não deve ter distance_km, veio {i.get('distance_km')} em {i['id']}"
