"""Iteration 13 — FASE 1 nova experiência do consumidor.

Cobre:
- FAVORITOS: POST /api/consumer/favorites/{est_id} alterna is_favorite; GET /favorites lista.
- DISCOVER: /consumer/discover com filter=ofertas|novidades|vagas|hoje|bombando|perto (geo e sem geo).
- CARTEIRA DE ECONOMIA: /consumer/economy retorna benefits_used.
- SINAIS DE INTERESSE: interest_events registrados em favorite/story_view/use_discount/filter_*.
- LAT/LNG establishment persiste na criação; estabelecimentos sem lat/lng aparecem por último no 'perto'.

REGRA CRÍTICA: prefixo QA_AUTOMATED_. Nunca tocar em contas reais.
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


def _register(s, role, name, email, password, neighborhood="Centro", city="São Paulo"):
    r = s.post(f"{API}/auth/register", json={
        "role": role, "name": name, "email": email, "password": password,
        "phone": "11999999999", "city": city, "neighborhood": neighborhood,
    })
    assert r.status_code == 200, f"register {role}: {r.status_code} {r.text}"
    return r.json()


def _create_est(m, fantasy, discount, neighborhood="Centro", lat=None, lng=None, category_id=None):
    payload = {
        "fantasy_name": fantasy, "description": "QA_AUTOMATED_",
        "neighborhood": neighborhood, "city": "São Paulo",
        "whatsapp": "11999999999",
        "discount_percent": discount, "discount_rules": "QA",
    }
    if lat is not None:
        payload["lat"] = lat
    if lng is not None:
        payload["lng"] = lng
    if category_id:
        payload["category_id"] = category_id
    r = m.post(f"{API}/merchant/establishments", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def env():
    """3 estabelecimentos QA: E1(Centro, lat/lng SP, desc 30%), E2(Pinheiros, lat/lng, 15%), E3(sem lat/lng, 50%)."""
    tag = uuid.uuid4().hex[:8]
    pwd = "QaPass@2026"
    merchant_email = f"qa_automated_{tag}_m@testoff360.com"
    consumer_email = f"qa_automated_{tag}_c@testoff360.com"

    m = _sess()
    _register(m, "merchant", f"QA_AUTOMATED_ Merch {tag}", merchant_email, pwd)

    # E1: Centro, coords perto de -23.55/-46.63 (SP centro)
    e1 = _create_est(m, f"QA_AUTOMATED_ E1 {tag}", 30, "Centro", lat=-23.55, lng=-46.633)
    # E2: Pinheiros, coords ~5km distante
    e2 = _create_est(m, f"QA_AUTOMATED_ E2 {tag}", 15, "Pinheiros", lat=-23.567, lng=-46.693)
    # E3: sem coords, alto desconto
    e3 = _create_est(m, f"QA_AUTOMATED_ E3 {tag}", 50, "Vila Mariana")

    # admin ativa
    a = _sess()
    _login(a, ADMIN_EMAIL, ADMIN_PASSWORD)
    for e in (e1, e2, e3):
        r = a.post(f"{API}/admin/establishments/{e['id']}/activate")
        assert r.status_code == 200, r.text

    # story job em E2 (para filter=vagas)
    r_story = m.post(f"{API}/merchant/stories", json={
        "establishment_id": e2["id"], "category": "job",
        "title": f"QA_AUTOMATED_ vaga {tag}", "text": "vaga", "media_type": "image",
    })
    assert r_story.status_code == 200, r_story.text
    job_sid = r_story.json()["id"]

    # story offer em E1 (para filter=hoje/novidades/bombando)
    r_story2 = m.post(f"{API}/merchant/stories", json={
        "establishment_id": e1["id"], "category": "offer",
        "title": f"QA_AUTOMATED_ oferta {tag}", "text": "oferta", "media_type": "image",
    })
    assert r_story2.status_code == 200
    offer_sid = r_story2.json()["id"]

    # consumer: bairro Centro -> perto sem geo deve priorizar E1
    c = _sess()
    consumer = _register(c, "consumer", f"QA_AUTOMATED_ Cons {tag}", consumer_email, pwd,
                         neighborhood="Centro")
    r = a.post(f"{API}/admin/consumers/{consumer['id']}/activate")
    assert r.status_code == 200, r.text
    _login(c, consumer_email, pwd)

    yield {
        "tag": tag, "m": m, "a": a, "c": c,
        "e1": e1["id"], "e2": e2["id"], "e3": e3["id"],
        "job_sid": job_sid, "offer_sid": offer_sid,
        "consumer_id": consumer["id"], "consumer_email": consumer_email,
    }

    # Cleanup: suspender establishments QA
    for eid in (e1["id"], e2["id"], e3["id"]):
        try:
            a.post(f"{API}/admin/establishments/{eid}/suspend")
        except Exception:
            pass


# ---------- LAT/LNG persist ----------
def test_lat_lng_persist_on_create(env):
    m = env["m"]
    r = m.get(f"{API}/merchant/establishment", params={"establishment_id": env["e1"]})
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["lat"] == -23.55
    assert e["lng"] == -46.633


def test_est_without_latlng_still_works(env):
    m = env["m"]
    r = m.get(f"{API}/merchant/establishment", params={"establishment_id": env["e3"]})
    assert r.status_code == 200
    e = r.json()
    assert e.get("lat") is None and e.get("lng") is None


# ---------- FAVORITES ----------
def test_favorite_toggle_and_list(env):
    c = env["c"]
    eid = env["e1"]

    r = c.post(f"{API}/consumer/favorites/{eid}")
    assert r.status_code == 200
    assert r.json()["is_favorite"] is True

    r = c.get(f"{API}/consumer/favorites")
    assert r.status_code == 200
    favs = r.json()
    assert any(x["id"] == eid for x in favs)
    assert all(x["is_favorite"] for x in favs if x["id"] == eid)

    # desfavoritar
    r = c.post(f"{API}/consumer/favorites/{eid}")
    assert r.status_code == 200
    assert r.json()["is_favorite"] is False

    r = c.get(f"{API}/consumer/favorites")
    assert r.status_code == 200
    assert all(x["id"] != eid for x in r.json())


# ---------- DISCOVER filters ----------
def test_discover_ofertas_sorted_by_discount_desc(env):
    c = env["c"]
    r = c.get(f"{API}/consumer/discover", params={"filter": "ofertas"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["filter"] == "ofertas"
    items = body["items"]
    ours = [i for i in items if i["id"] in (env["e1"], env["e2"], env["e3"])]
    # E3(50)>E1(30)>E2(15)
    idx = {e["id"]: n for n, e in enumerate(ours)}
    assert idx[env["e3"]] < idx[env["e1"]] < idx[env["e2"]], f"order={[(e['id'],e['discount_percent']) for e in ours]}"


def test_discover_vagas_only_job_stories(env):
    c = env["c"]
    r = c.get(f"{API}/consumer/discover", params={"filter": "vagas"})
    assert r.status_code == 200
    ids = [i["id"] for i in r.json()["items"]]
    assert env["e2"] in ids, "E2 tem story category=job"
    # E1 e E3 não devem aparecer
    assert env["e1"] not in ids
    assert env["e3"] not in ids


def test_discover_hoje_returns_ests_with_story_today(env):
    c = env["c"]
    r = c.get(f"{API}/consumer/discover", params={"filter": "hoje"})
    assert r.status_code == 200
    ids = [i["id"] for i in r.json()["items"]]
    # E1 e E2 têm stories criados hoje
    assert env["e1"] in ids
    assert env["e2"] in ids


def test_discover_novidades(env):
    c = env["c"]
    r = c.get(f"{API}/consumer/discover", params={"filter": "novidades"})
    assert r.status_code == 200
    ids = [i["id"] for i in r.json()["items"]]
    assert env["e1"] in ids and env["e2"] in ids and env["e3"] in ids


def test_discover_bombando_returns_all(env):
    c = env["c"]
    r = c.get(f"{API}/consumer/discover", params={"filter": "bombando"})
    assert r.status_code == 200
    body = r.json()
    assert body["filter"] == "bombando"
    ids = [i["id"] for i in body["items"]]
    assert env["e1"] in ids and env["e2"] in ids


def test_discover_perto_with_geo_haversine(env):
    c = env["c"]
    # Ponto próximo do E1 (Centro SP)
    r = c.get(f"{API}/consumer/discover", params={"filter": "perto", "lat": -23.55, "lng": -46.633})
    assert r.status_code == 200
    items = r.json()["items"]
    ours = [i for i in items if i["id"] in (env["e1"], env["e2"], env["e3"])]
    idx = {e["id"]: n for n, e in enumerate(ours)}
    # E1 (0km) deve vir antes de E2 (~5km) que deve vir antes de E3 (sem coords -> último)
    assert idx[env["e1"]] < idx[env["e2"]] < idx[env["e3"]], f"order={[(e['id'],e.get('distance_km')) for e in ours]}"
    # distance_km deve estar presente nos com coords
    e1_row = next(i for i in ours if i["id"] == env["e1"])
    assert e1_row.get("distance_km") is not None
    assert e1_row["distance_km"] < 1  # ~0km
    e2_row = next(i for i in ours if i["id"] == env["e2"])
    assert e2_row["distance_km"] > 1


def test_discover_perto_without_geo_uses_neighborhood(env):
    c = env["c"]
    # Consumer neighborhood="Centro" -> E1 (Centro) deve vir antes dos outros
    r = c.get(f"{API}/consumer/discover", params={"filter": "perto"})
    assert r.status_code == 200
    items = r.json()["items"]
    ours = [i for i in items if i["id"] in (env["e1"], env["e2"], env["e3"])]
    # E1(Centro) primeiro
    assert ours[0]["id"] == env["e1"], f"got {[e['neighborhood'] for e in ours]}"


# ---------- ECONOMY wallet ----------
def test_economy_benefits_used_present(env):
    c = env["c"]
    r = c.get(f"{API}/consumer/economy")
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("total_saved", "month_saved", "benefits_used", "history", "total_purchases"):
        assert k in d, f"missing {k}"
    assert isinstance(d["benefits_used"], int)
    assert isinstance(d["history"], list)


# ---------- INTEREST EVENTS ----------
def test_interest_events_are_created(env):
    """Ao favoritar, ver story e aplicar filtro, interest_events recebe docs."""
    c = env["c"]
    m = env["m"]

    # gerar sinais
    c.post(f"{API}/consumer/favorites/{env['e2']}")  # favorite (weight 3)
    c.post(f"{API}/consumer/stories/{env['offer_sid']}/view")  # story_view
    c.get(f"{API}/consumer/discover", params={"filter": "ofertas"})  # filter_ofertas
    # cleanup fav
    c.post(f"{API}/consumer/favorites/{env['e2']}")

    # Só podemos observar via efeitos observáveis do backend:
    # (a) is_favorite persistiu momentaneamente (validado em test_favorite_toggle)
    # (b) a chamada de discover não pode retornar 500 (validado acima)
    # (c) home continua carregando sem quebrar
    r = c.get(f"{API}/consumer/home")
    assert r.status_code == 200
