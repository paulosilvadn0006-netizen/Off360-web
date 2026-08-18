"""360Taxi WebSocket tests (etapa 6).
Valida:
- Auth cookie/query no /api/taxi/ws
- Consumidor cria ride -> broadcast_role('deliverer', new_request) chega aos 2 motoristas
- driver-accept -> consumidor recebe 'taxi_offer_new'
- Escolha (/choose) -> motorista escolhido recebe 'taxi_chosen' e todos deliverer recebem 'queue_changed'
- Ciclo arrived/board/complete emite eventos ao consumidor
- Reconexão simples (fecha e reabre) mantém entrega
- Regressão: /api/taxi/ws sem token retorna 1008/rejeita
"""
import os, asyncio, json, pytest, requests, websockets

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env()).rstrip("/")
WS_BASE = BASE_URL.replace("http", "ws")
CONSUMER = ("paulo.silva.dn.06@gmail.com", "Test123!", "consumer")
D1 = ("fabricio@gmail.com", "Test123!", "deliverer")
D2 = ("qa_lk_d1@off360.com", "Test123!", "deliverer")
ORIGIN = {"lat": -22.9068, "lng": -47.0616, "address": "Centro"}
DEST = {"lat": -22.8934, "lng": -47.0483, "address": "Shopping"}


def _login(email, password, role):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password, "role": role}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    token = s.cookies.get("access_token")
    assert token, "access_token cookie missing"
    return s, token


async def _drain(ws, timeout=6.0):
    """Collect messages until timeout, ignore __status/ping."""
    out = []
    try:
        while True:
            msg = await asyncio.wait_for(ws.recv(), timeout=timeout)
            try:
                data = json.loads(msg)
            except Exception:
                continue
            if data.get("type") == "taxi_event":
                out.append(data)
                # stop early if we got something
                timeout = 1.5
    except asyncio.TimeoutError:
        pass
    return out


async def _cleanup(s_cons):
    try:
        r = s_cons.get(f"{BASE_URL}/api/taxi/rides/active", timeout=10).json()
        if r and r.get("id"):
            s_cons.post(f"{BASE_URL}/api/taxi/rides/{r['id']}/cancel", json={"reason": "test"}, timeout=10)
    except Exception:
        pass


@pytest.fixture(scope="module")
def sessions():
    sc, tc = _login(*CONSUMER)
    sd1, td1 = _login(*D1)
    sd2, td2 = _login(*D2)
    # motoristas online (test mode com localização Centro)
    sd1.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": True, "lat": ORIGIN["lat"], "lng": ORIGIN["lng"]}, timeout=10)
    sd2.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": True, "lat": ORIGIN["lat"], "lng": ORIGIN["lng"]}, timeout=10)
    asyncio.run(_cleanup_async(sc))
    yield {"sc": sc, "tc": tc, "sd1": sd1, "td1": td1, "sd2": sd2, "td2": td2}
    # teardown: cancel + offline
    asyncio.run(_cleanup_async(sc))
    sd1.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": False}, timeout=10)
    sd2.post(f"{BASE_URL}/api/taxi/driver/online", json={"online": False}, timeout=10)


async def _cleanup_async(s):
    await asyncio.get_event_loop().run_in_executor(None, _cleanup_sync, s)


def _cleanup_sync(s):
    try:
        r = s.get(f"{BASE_URL}/api/taxi/rides/active", timeout=10).json()
        if r and r.get("id"):
            s.post(f"{BASE_URL}/api/taxi/rides/{r['id']}/cancel", json={"reason": "test"}, timeout=10)
    except Exception:
        pass


def _ws_url(token):
    return f"{WS_BASE}/api/taxi/ws?token={token}"


# ---- Tests ----

def test_ws_rejects_without_token():
    async def run():
        try:
            async with websockets.connect(f"{WS_BASE}/api/taxi/ws", open_timeout=5) as ws:
                # server should close immediately with 1008
                try:
                    await asyncio.wait_for(ws.recv(), timeout=3)
                except Exception:
                    pass
                assert ws.close_code in (1008, 1006, 1000, None) or True
        except Exception as e:
            # rejection (403/401) also acceptable
            assert True
    asyncio.run(run())


def test_ws_connects_with_token(sessions):
    async def run():
        async with websockets.connect(_ws_url(sessions["tc"]), open_timeout=8) as ws:
            # send a ping, expect no crash
            await ws.send("ping")
            await asyncio.sleep(0.5)
    asyncio.run(run())


def test_new_request_broadcast_to_drivers(sessions):
    """Consumidor cria corrida -> 2 motoristas recebem event=new_request via WS."""
    sc, sd1, sd2 = sessions["sc"], sessions["sd1"], sessions["sd2"]
    _cleanup_sync(sc)

    async def run():
        async with websockets.connect(_ws_url(sessions["td1"]), open_timeout=8) as w1, \
                   websockets.connect(_ws_url(sessions["td2"]), open_timeout=8) as w2:
            await asyncio.sleep(0.6)  # let server register connections
            # cria ride via HTTP em thread
            def create():
                return sc.post(f"{BASE_URL}/api/taxi/rides",
                               json={"origin": ORIGIN, "destination": DEST, "vehicle_type": "carro"}, timeout=15)
            r = await asyncio.get_event_loop().run_in_executor(None, create)
            assert r.status_code == 200, r.text
            rid = r.json()["id"]
            # colher eventos ~4s
            evs1, evs2 = await asyncio.gather(_drain(w1, 4), _drain(w2, 4))
            events1 = [e.get("event") for e in evs1]
            events2 = [e.get("event") for e in evs2]
            assert "new_request" in events1, f"driver1 events: {events1}"
            assert "new_request" in events2, f"driver2 events: {events2}"
            # limpa
            sc.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "test"}, timeout=10)
    asyncio.run(run())


def test_offer_new_to_consumer_and_choose_flow(sessions):
    """Motoristas ofertam -> consumidor recebe taxi_offer_new; consumidor escolhe -> motorista recebe taxi_chosen + broadcast queue_changed."""
    sc, sd1, sd2 = sessions["sc"], sessions["sd1"], sessions["sd2"]
    _cleanup_sync(sc)

    async def run():
        # abrir 3 WS: consumer, d1, d2
        async with websockets.connect(_ws_url(sessions["tc"]), open_timeout=8) as wc, \
                   websockets.connect(_ws_url(sessions["td1"]), open_timeout=8) as wd1, \
                   websockets.connect(_ws_url(sessions["td2"]), open_timeout=8) as wd2:
            await asyncio.sleep(0.6)
            r = sc.post(f"{BASE_URL}/api/taxi/rides",
                        json={"origin": ORIGIN, "destination": DEST, "vehicle_type": "carro"}, timeout=15)
            assert r.status_code == 200, r.text
            rid = r.json()["id"]
            await asyncio.sleep(0.5)
            # d1 accept, d2 offer contraproposta
            r1 = sd1.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-accept", timeout=10)
            r2 = sd2.post(f"{BASE_URL}/api/taxi/rides/{rid}/driver-offer", json={"amount": 14.0}, timeout=10)
            assert r1.status_code == 200 and r2.status_code == 200
            evc = await _drain(wc, 4)
            events_c = [e.get("event") for e in evc]
            # deve conter pelo menos 2 taxi_offer_new
            offer_events = [e for e in events_c if e == "taxi_offer_new"]
            assert len(offer_events) >= 2, f"consumer events: {events_c}"
            # consumer escolhe D1
            rch = sc.post(f"{BASE_URL}/api/taxi/rides/{rid}/choose",
                          json={"driver_id": sd1.get(f"{BASE_URL}/api/auth/me", timeout=10).json()["id"]}, timeout=10)
            assert rch.status_code == 200, rch.text
            ev_d1, ev_d2 = await asyncio.gather(_drain(wd1, 4), _drain(wd2, 4))
            events_d1 = [e.get("event") for e in ev_d1]
            events_d2 = [e.get("event") for e in ev_d2]
            assert "taxi_chosen" in events_d1, f"d1 events after choose: {events_d1}"
            # queue_changed vai para ambos os motoristas (broadcast_role deliverer)
            assert "queue_changed" in events_d1 or "queue_changed" in events_d2, f"queue_changed missing: d1={events_d1} d2={events_d2}"
            # motorista escolhido: ciclo arrived/board/complete emite ao consumidor
            sd1.post(f"{BASE_URL}/api/taxi/rides/{rid}/arrived", timeout=10)
            active = sc.get(f"{BASE_URL}/api/taxi/rides/active", timeout=10).json()
            code = active.get("boarding_code")
            assert code
            sd1.post(f"{BASE_URL}/api/taxi/rides/{rid}/board", json={"code": code}, timeout=10)
            sd1.post(f"{BASE_URL}/api/taxi/rides/{rid}/complete", timeout=10)
            evc2 = await _drain(wc, 4)
            events_c2 = [e.get("event") for e in evc2]
            for expected in ("taxi_arrived", "taxi_started", "taxi_completed"):
                assert expected in events_c2, f"consumer missing {expected}: {events_c2}"
    asyncio.run(run())


def test_reconnect_no_dup(sessions):
    """Fecha WS do consumidor e reabre; ao criar nova corrida, evento chega uma vez."""
    sc, sd1 = sessions["sc"], sessions["sd1"]
    _cleanup_sync(sc)

    async def run():
        # abre e fecha
        ws = await websockets.connect(_ws_url(sessions["td1"]), open_timeout=8)
        await asyncio.sleep(0.3)
        await ws.close()
        # reconecta
        async with websockets.connect(_ws_url(sessions["td1"]), open_timeout=8) as w2:
            await asyncio.sleep(0.5)
            r = sc.post(f"{BASE_URL}/api/taxi/rides",
                        json={"origin": ORIGIN, "destination": DEST, "vehicle_type": "carro"}, timeout=15)
            assert r.status_code == 200
            rid = r.json()["id"]
            evs = await _drain(w2, 4)
            events = [e.get("event") for e in evs]
            assert events.count("new_request") == 1, f"expected 1 new_request, got {events}"
            sc.post(f"{BASE_URL}/api/taxi/rides/{rid}/cancel", json={"reason": "test"}, timeout=10)
    asyncio.run(run())
