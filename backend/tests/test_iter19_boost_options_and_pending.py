"""
Iteration 19 — 4 novas funcionalidades:
  A) DESTAQUE OPÇÃO 1 (story_source='active'): POST /merchant/boosts com story_id -> boost awaiting.
  B) DESTAQUE OPÇÃO 2 (story_source='new'): POST /merchant/boosts com media_url+title -> cria Story sponsored_only=True + boost awaiting.
     * Sponsored-only NÃO aparece em /consumer/home enquanto boost awaiting.
     * Após approve+activate: aparece SOMENTE como patrocinado (sponsored=true) e nunca como orgânico.
  C) MODO RÁPIDO: validation_mode='fast' -> /consumer/scan retorna 'fast'; /consumer/transactions/{id}/fast-confirm confirma; /merchant/pending NÃO lista; /merchant/pending-count = 0; sem notificação qr_scanned.
  D) MODO CONTROLADO: validation_mode='controlled' -> /consumer/scan cria pending; /merchant/pending lista; /merchant/pending-count reflete; /merchant/transactions/{id}/confirm zera pendência.
  E) Persistência: PUT /merchant/establishment/{eid} {validation_mode} reflete em /merchant/qr e /merchant/establishment.
  F) Categoria 'Bares e Baladas' presente em GET /api/categories.
Cleanup: remover qa_automated_* e QA_AUTOMATED_*. Nunca tocar contas REAIS ou boost_teccel_real.
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
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


def _register(role, extra=None):
    s = _client()
    email = f"qa_automated_{_hex()}@testoff360.com"
    payload = {"name": f"QA_AUTOMATED_{role[:3].upper()}_{_hex()[:4]}",
               "email": email, "phone": "11999990000",
               "password": QA_PASS, "role": role,
               "city": "Campinas", "neighborhood": "Centro"}
    if extra: payload.update(extra)
    r = s.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, f"register {role}: {r.status_code} {r.text}"
    return s, r.json(), email


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def env(admin):
    cats = admin.get(f"{API}/admin/categories").json()
    assert cats, "sem categorias"
    cat = cats[0]["id"]
    m_sess, m_user, m_email = _register("merchant", {"fantasy_name": f"QA_AUTOMATED_M19_{_hex()[:4]}", "category_id": cat})
    admin.post(f"{API}/admin/merchants/{m_user['id']}/activate")
    r = m_sess.post(f"{API}/merchant/establishments", json={
        "fantasy_name": f"QA_AUTOMATED_EST19_{_hex()[:4]}",
        "category_id": cat, "discount_percent": 15,
        "address": "Rua QA, 19", "neighborhood": "Centro", "city": "Campinas"})
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    admin.post(f"{API}/admin/establishments/{eid}/activate")
    c_sess, c_user, c_email = _register("consumer")
    admin.post(f"{API}/admin/consumers/{c_user['id']}/activate")
    c_sess = _login(c_email, QA_PASS)
    return {"admin": admin, "m": m_sess, "m_id": m_user["id"], "eid": eid,
            "c": c_sess, "c_id": c_user["id"], "m_email": m_email, "c_email": c_email}


# ---------- F) Categoria Bares e Baladas ----------
def test_categoria_bares_e_baladas(admin):
    r = admin.get(f"{API}/categories")
    assert r.status_code == 200
    names = [c["name"] for c in r.json()]
    assert "Bares e Baladas" in names, f"faltou categoria: {names}"
    b = next(c for c in r.json() if c["name"] == "Bares e Baladas")
    assert b.get("icon") == "Martini"
    # Preserva Lazer
    assert "Lazer" in names


# ---------- A) Destaque opção 1: story ativo ----------
def test_boost_option1_story_ativo(env):
    r = env["m"].post(f"{API}/merchant/stories", json={
        "establishment_id": env["eid"], "category": "offer",
        "title": "QA_AUTOMATED_STORY_ATIVO", "text": "aproveite"})
    assert r.status_code == 200
    sid = r.json()["id"]
    r = env["m"].post(f"{API}/merchant/boosts", json={
        "establishment_id": env["eid"],
        "story_source": "active",
        "story_id": sid})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "awaiting"
    assert b["story_id"] == sid
    # GET verifica persistência
    lst = env["m"].get(f"{API}/merchant/boosts").json()
    assert any(x["id"] == b["id"] and x["status"] == "awaiting" for x in lst)


# ---------- B) Destaque opção 2: nova postagem exclusiva ----------
def test_boost_option2_nova_postagem_e_visibilidade(env, admin):
    # /consumer/home baseline: contar sponsored antes
    home0 = env["c"].get(f"{API}/consumer/home").json()
    sponsored_before = sum(1 for g in home0.get("stories", []) if g.get("sponsored"))

    # cria boost com nova postagem
    r = env["m"].post(f"{API}/merchant/boosts", json={
        "establishment_id": env["eid"],
        "story_source": "new",
        "media_url": "/media/qa_automated_exclusive.png",
        "media_type": "image",
        "title": "QA_AUTOMATED_EXCLUSIVE_TITLE",
        "text": "conteudo exclusivo",
        "story_category": "offer"})
    assert r.status_code == 200, r.text
    b = r.json()
    bid = b["id"]
    assert b["status"] == "awaiting"
    story_id = b["story_id"]
    assert story_id, "boost sem story_id"
    # story deve existir com sponsored_only=True (via listar stories do merchant)
    stories = env["m"].get(f"{API}/merchant/stories", params={"establishment_id": env["eid"]}).json()
    match = next((s for s in stories if s["id"] == story_id), None)
    assert match is not None
    assert match.get("sponsored_only") is True
    assert match.get("title") == "QA_AUTOMATED_EXCLUSIVE_TITLE"
    assert match.get("status") == "active"

    # Enquanto AWAITING, NÃO deve aparecer em /consumer/home nem em detail
    home1 = env["c"].get(f"{API}/consumer/home").json()
    for g in home1.get("stories", []):
        for s in g.get("stories", []):
            assert s["id"] != story_id, "sponsored_only aparecendo antes do boost ativo"
    detail = env["c"].get(f"{API}/consumer/establishments/{env['eid']}").json()
    if "stories" in detail:
        for s in detail["stories"]:
            assert s["id"] != story_id, "sponsored_only aparecendo em detail antes do boost ativo"

    # Aprovar + ativar
    r = admin.post(f"{API}/admin/boosts/{bid}/approve")
    assert r.status_code == 200, r.text
    now_iso = datetime.now(timezone.utc).isoformat()
    end_iso = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = admin.post(f"{API}/admin/boosts/{bid}/activate", json={
        "priority": 5, "period_start": now_iso, "period_end": end_iso})
    assert r.status_code == 200, r.text

    # Após ativo, deve aparecer SOMENTE como patrocinado
    home2 = env["c"].get(f"{API}/consumer/home").json()
    found_group = None
    for g in home2.get("stories", []):
        for s in g.get("stories", []):
            if s["id"] == story_id:
                found_group = g
                break
        if found_group:
            break
    assert found_group is not None, "sponsored_only deveria aparecer após boost ativo"
    assert found_group.get("sponsored") is True, "grupo deve estar marcado sponsored=True"
    # E o story dentro do grupo deve ter sponsored=True (não aparece como orgânico)
    the_story = next(s for s in found_group["stories"] if s["id"] == story_id)
    assert the_story.get("sponsored") is True

    # Em establishment detail (rota orgânica), story sponsored_only NÃO deve aparecer
    detail2 = env["c"].get(f"{API}/consumer/establishments/{env['eid']}").json()
    for s in detail2.get("stories", []):
        assert s["id"] != story_id, "sponsored_only não deve aparecer como orgânico em detail"


# ---------- E) Persistência do validation_mode ----------
def test_validation_mode_persistence(env):
    r = env["m"].put(f"{API}/merchant/establishment/{env['eid']}", json={"validation_mode": "fast"})
    assert r.status_code == 200
    q = env["m"].get(f"{API}/merchant/qr", params={"establishment_id": env["eid"]}).json()
    e = env["m"].get(f"{API}/merchant/establishment", params={"establishment_id": env["eid"]}).json()
    assert q["validation_mode"] == "fast"
    assert e["validation_mode"] == "fast"

    r = env["m"].put(f"{API}/merchant/establishment/{env['eid']}", json={"validation_mode": "controlled"})
    assert r.status_code == 200
    q = env["m"].get(f"{API}/merchant/qr", params={"establishment_id": env["eid"]}).json()
    e = env["m"].get(f"{API}/merchant/establishment", params={"establishment_id": env["eid"]}).json()
    assert q["validation_mode"] == "controlled"
    assert e["validation_mode"] == "controlled"


# ---------- C) Modo Rápido: sem pendência, sem notificação qr_scanned ----------
def test_fast_mode_no_pending_no_notification(env):
    # set fast
    r = env["m"].put(f"{API}/merchant/establishment/{env['eid']}", json={"validation_mode": "fast"})
    assert r.status_code == 200
    qr = env["m"].get(f"{API}/merchant/qr", params={"establishment_id": env["eid"]}).json()
    token = qr["qr_token"]

    # baseline pending-count
    baseline = env["m"].get(f"{API}/merchant/pending-count").json()["count"]

    # consumer scan
    r = env["c"].post(f"{API}/consumer/scan", json={"qr_token": token})
    assert r.status_code == 200, r.text
    scan = r.json()
    assert scan["validation_mode"] == "fast"
    tx_id = scan["transaction_id"]

    # pending should NOT include this tx
    pend = env["m"].get(f"{API}/merchant/pending").json()
    assert not any(t["id"] == tx_id for t in pend), "fast tx não deve aparecer em pending"
    # pending-count deve continuar o mesmo (não incrementou)
    cnt = env["m"].get(f"{API}/merchant/pending-count").json()["count"]
    assert cnt == baseline, f"pending-count mudou no fast: {baseline}->{cnt}"

    # fast-confirm
    r = env["c"].post(f"{API}/consumer/transactions/{tx_id}/fast-confirm", json={"gross_amount": 100.0})
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx["status"] == "confirmed"
    assert tx["gross_amount"] == 100.0
    assert tx["discount_amount"] == 15.0
    assert tx["final_amount"] == 85.0

    # notificações: qr_scanned NÃO deve aparecer no fast (merchant notifications)
    notifs = env["m"].get(f"{API}/notifications").json().get("items", [])
    scanned = [n for n in notifs if n.get("type") == "qr_scanned"]
    # nenhuma notificação qr_scanned criada NESTA transação (mercado inteiro): checamos que nenhuma referencia esta tx é dificil,
    # então validamos que nenhum qr_scanned foi criado nos últimos 60s
    from datetime import datetime as _dt
    now = _dt.now(timezone.utc)
    recent_scan = [n for n in scanned if n.get("created_at") and (now - _dt.fromisoformat(n["created_at"].replace("Z", "+00:00"))).total_seconds() < 60]
    assert not recent_scan, f"qr_scanned criado no modo fast: {recent_scan}"


# ---------- D) Modo Controlado: pendência + count + confirm ----------
def test_controlled_mode_pending_and_confirm(env):
    r = env["m"].put(f"{API}/merchant/establishment/{env['eid']}", json={"validation_mode": "controlled"})
    assert r.status_code == 200
    qr = env["m"].get(f"{API}/merchant/qr", params={"establishment_id": env["eid"]}).json()
    token = qr["qr_token"]

    baseline = env["m"].get(f"{API}/merchant/pending-count").json()["count"]

    r = env["c"].post(f"{API}/consumer/scan", json={"qr_token": token})
    assert r.status_code == 200, r.text
    scan = r.json()
    assert scan["validation_mode"] == "controlled"
    tx_id = scan["transaction_id"]

    pend = env["m"].get(f"{API}/merchant/pending").json()
    assert any(t["id"] == tx_id for t in pend), "controlled tx deve aparecer em pending"
    cnt = env["m"].get(f"{API}/merchant/pending-count").json()["count"]
    assert cnt == baseline + 1, f"pending-count não incrementou: {baseline}->{cnt}"

    # merchant confirma
    r = env["m"].post(f"{API}/merchant/transactions/{tx_id}/confirm", json={"gross_amount": 50.0})
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx["status"] == "confirmed"

    # pendência deve zerar (voltar ao baseline)
    cnt2 = env["m"].get(f"{API}/merchant/pending-count").json()["count"]
    assert cnt2 == baseline, f"pending-count não caiu após confirm: {cnt2}"
    pend2 = env["m"].get(f"{API}/merchant/pending").json()
    assert not any(t["id"] == tx_id for t in pend2)


# ---------- Cleanup ----------
def test_cleanup_qa_data():
    """Remove todos os artefatos qa_automated_ / QA_AUTOMATED_. Nunca toca contas reais."""
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        # tenta ler backend/.env
        env_path = "/app/backend/.env"
        if os.path.exists(env_path):
            for ln in open(env_path):
                if ln.startswith("MONGO_URL="): mongo_url = ln.split("=", 1)[1].strip().strip('"')
                elif ln.startswith("DB_NAME="): db_name = ln.split("=", 1)[1].strip().strip('"')
    assert mongo_url and db_name, "MONGO_URL/DB_NAME não disponíveis"
    cli = MongoClient(mongo_url)
    db = cli[db_name]

    PROTECTED_EMAILS = {"paulo@off360.com", "paulo.silva.dn.0006@gmail.com"}
    PROTECTED_BOOSTS = {"boost_teccel_real"}

    qa_users = list(db.users.find({"email": {"$regex": "^qa_automated_"}}))
    qa_user_ids = [u["id"] for u in qa_users if u["email"] not in PROTECTED_EMAILS]
    qa_ests = list(db.establishments.find({"fantasy_name": {"$regex": "^QA_AUTOMATED_"}}))
    qa_est_ids = [e["id"] for e in qa_ests]

    # Delete related boosts (only QA), preserving boost_teccel_real
    if qa_est_ids:
        db.boosts.delete_many({"establishment_id": {"$in": qa_est_ids}, "id": {"$nin": list(PROTECTED_BOOSTS)}})
        db.stories.delete_many({"establishment_id": {"$in": qa_est_ids}})
        db.transactions.delete_many({"establishment_id": {"$in": qa_est_ids}})
    if qa_user_ids:
        db.notifications.delete_many({"recipient_id": {"$in": qa_user_ids}})
        db.interest_events.delete_many({"user_id": {"$in": qa_user_ids}})
    db.establishments.delete_many({"fantasy_name": {"$regex": "^QA_AUTOMATED_"}})
    db.users.delete_many({"email": {"$regex": "^qa_automated_"}})

    # sanity
    remaining_u = db.users.count_documents({"email": {"$regex": "^qa_automated_"}})
    remaining_e = db.establishments.count_documents({"fantasy_name": {"$regex": "^QA_AUTOMATED_"}})
    assert remaining_u == 0
    assert remaining_e == 0
    # protected preserved
    assert db.users.find_one({"email": "paulo@off360.com"}) is not None
    assert db.users.find_one({"email": "paulo.silva.dn.0006@gmail.com"}) is not None
    teccel = db.boosts.find_one({"id": "boost_teccel_real"})
    # não afirmamos existência (pode não existir no dev DB) — só que se existir, não foi apagado
    print(f"CLEANUP OK. teccel_present={teccel is not None}")
