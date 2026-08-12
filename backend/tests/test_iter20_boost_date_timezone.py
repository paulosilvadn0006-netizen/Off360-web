"""
Iteration 20 — Fix bug de -1 dia (timezone) no Período do Destaque.
Escopo: fmtDate no frontend detecta 'YYYY-MM-DD' e formata direto (sem UTC->BRT).
Backend deve continuar armazenando/retornando a data como string pura.

Testes:
  1) GET /admin/boosts contém o iPhone boost (7db01619-0235-4e7e-871c-c247253b3a99)
     com period_start='2026-08-12' e period_end='2026-08-12' (strings puras).
  2) Teccel boost (boost_teccel_real) intocado: period datetime ISO com 2026-08-13, status active.
  3) Criar QA boost via POST /merchant/boosts com period puro '2026-08-12' e verificar
     que GET /merchant/boosts retorna exatamente '2026-08-12' (sem conversão).
Cleanup: remove qa_automated_* e QA_AUTOMATED_* criados no teste 3.
"""
import os, uuid, requests, pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "paulo.silva.dn.0006@gmail.com"
ADMIN_PASSWORD = "Off360Admin!2026"
QA_PASS = "QaPass@2026"

IPHONE_BOOST_ID = "7db01619-0235-4e7e-871c-c247253b3a99"
TECCEL_BOOST_ID = "boost_teccel_real"


def _hex(): return uuid.uuid4().hex[:10]


def _client():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"}); return s


def _login(email, password):
    s = _client()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


# ---------- 1) iPhone boost mantém period puro '2026-08-12' ----------
def test_iphone_boost_period_is_pure_date_string(admin):
    r = admin.get(f"{API}/admin/boosts")
    assert r.status_code == 200, r.text
    boosts = r.json()
    iphone = next((b for b in boosts if b.get("id") == IPHONE_BOOST_ID), None)
    assert iphone is not None, f"iPhone boost {IPHONE_BOOST_ID} não encontrado em /admin/boosts"
    assert iphone.get("period_start") == "2026-08-12", f"period_start={iphone.get('period_start')}"
    assert iphone.get("period_end") == "2026-08-12", f"period_end={iphone.get('period_end')}"
    assert iphone.get("status") == "approved", f"status inesperado: {iphone.get('status')}"
    # story_title contém iPhone 17 PROMAX (via join opcional; se ausente, ok)
    title = (iphone.get("story_title") or "") + " " + (iphone.get("title") or "")
    # Não obrigatório — só logar informativo
    print(f"iPhone boost title/related: {title!r}")


# ---------- 2) Teccel boost intocado ----------
def test_teccel_boost_intact(admin):
    r = admin.get(f"{API}/admin/boosts")
    assert r.status_code == 200
    boosts = r.json()
    teccel = next((b for b in boosts if b.get("id") == TECCEL_BOOST_ID), None)
    assert teccel is not None, "boost_teccel_real não encontrado"
    assert teccel.get("status") == "active", f"status teccel={teccel.get('status')}"
    # period_end pode ser datetime ISO completo com 2026-08-13
    pe = str(teccel.get("period_end") or "")
    assert "2026-08-13" in pe, f"period_end teccel deveria conter 2026-08-13, veio {pe}"
    hd = str(teccel.get("happening_date") or "")
    assert hd == "2026-08-13" or "2026-08-13" in hd, f"happening_date teccel={hd}"


# ---------- 3) QA: criar boost com period puro e checar persistência ----------
def test_create_qa_boost_period_pure_date(admin):
    # setup merchant + establishment
    email = f"qa_automated_{_hex()}@testoff360.com"
    reg = _client().post(f"{API}/auth/register", json={
        "name": f"QA_AUTOMATED_M20_{_hex()[:4]}", "email": email,
        "phone": "11999990000", "password": QA_PASS, "role": "merchant",
        "city": "Campinas", "neighborhood": "Centro"})
    assert reg.status_code == 200, reg.text
    m_id = reg.json()["id"]
    admin.post(f"{API}/admin/merchants/{m_id}/activate")
    m = _login(email, QA_PASS)
    cats = admin.get(f"{API}/admin/categories").json()
    cat = cats[0]["id"]
    r = m.post(f"{API}/merchant/establishments", json={
        "fantasy_name": f"QA_AUTOMATED_EST20_{_hex()[:4]}",
        "category_id": cat, "discount_percent": 10,
        "address": "Rua QA, 20", "neighborhood": "Centro", "city": "Campinas"})
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    admin.post(f"{API}/admin/establishments/{eid}/activate")

    # POST /merchant/boosts com story_source=new e period puro
    r = m.post(f"{API}/merchant/boosts", json={
        "establishment_id": eid,
        "story_source": "new",
        "media_url": "/media/qa_automated_iphone_like.png",
        "media_type": "image",
        "title": "QA_AUTOMATED_BOOST_20250812",
        "text": "teste data pura",
        "story_category": "offer",
        "period_start": "2026-08-12",
        "period_end": "2026-08-12",
        "happening_date": "2026-08-12"})
    assert r.status_code == 200, r.text
    created = r.json()
    bid = created["id"]

    # GET /merchant/boosts deve retornar exatamente as strings puras
    lst = m.get(f"{API}/merchant/boosts").json()
    mine = next((b for b in lst if b["id"] == bid), None)
    assert mine is not None
    assert mine.get("period_start") == "2026-08-12", f"period_start persistido={mine.get('period_start')}"
    assert mine.get("period_end") == "2026-08-12", f"period_end persistido={mine.get('period_end')}"
    assert mine.get("happening_date") == "2026-08-12", f"happening_date={mine.get('happening_date')}"

    # via /admin/boosts também
    all_boosts = admin.get(f"{API}/admin/boosts").json()
    a = next((b for b in all_boosts if b["id"] == bid), None)
    assert a is not None
    assert a.get("period_start") == "2026-08-12"
    assert a.get("period_end") == "2026-08-12"


# ---------- Cleanup ----------
def test_cleanup_qa_data(admin):
    """Remove usuários qa_automated_* e establishments QA_AUTOMATED_* + boosts/stories associados."""
    # Best-effort via endpoints admin (se existirem)
    try:
        r = admin.get(f"{API}/admin/users")
        if r.status_code == 200:
            users = r.json()
            qa_users = [u for u in users if str(u.get("email", "")).startswith("qa_automated_")]
            for u in qa_users:
                admin.delete(f"{API}/admin/users/{u['id']}")
        r = admin.get(f"{API}/admin/establishments")
        if r.status_code == 200:
            ests = r.json()
            qa_ests = [e for e in ests if str(e.get("fantasy_name", "")).startswith("QA_AUTOMATED_")]
            for e in qa_ests:
                admin.delete(f"{API}/admin/establishments/{e['id']}")
    except Exception as ex:
        print(f"cleanup best-effort: {ex}")
    # PRESERVAR boost_teccel_real e iPhone boost — nunca deletar
    all_boosts = admin.get(f"{API}/admin/boosts").json()
    assert any(b["id"] == TECCEL_BOOST_ID for b in all_boosts), "boost_teccel_real foi removido!"
    assert any(b["id"] == IPHONE_BOOST_ID for b in all_boosts), "iPhone boost foi removido!"
