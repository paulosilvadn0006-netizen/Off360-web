"""360Taxi — pagamentos ao FIM da corrida (Mercado Pago Marketplace/OAuth).

- O motorista conecta a própria conta Mercado Pago via OAuth (obrigatório para operar).
- Pix e cartão de crédito são cobrados com o token OAuth do motorista → o dinheiro
  cai direto na conta dele. Comissão da plataforma = 0 (application_fee omitido).
- Dinheiro: o motorista confirma o recebimento manualmente.
- Nenhuma cobrança acontece antes do término da corrida.
Isolado do fluxo de assinatura do motorista (routes_payments.py).
"""
import os
import uuid
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

import mp
from core import db, require_role, get_current_user, create_notification, now_iso, ws_hub

router = APIRouter(tags=["taxi-ride-payments"])
consumer_only = require_role("consumer")
deliverer_only = require_role("deliverer")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
WEBHOOK_URL = os.environ.get("MP_WEBHOOK_URL") or f"{FRONTEND_URL}/api/webhooks/mercadopago"


def _payer(user):
    """Monta os dados do pagador exigidos pela qualidade de integração do Mercado Pago."""
    p = {"email": user.get("email")}
    nm = (user.get("name") or "").strip().split()
    if nm:
        p["first_name"] = nm[0]
        p["last_name"] = " ".join(nm[1:]) if len(nm) > 1 else nm[0]
    doc = (user.get("cpf") or user.get("cnpj") or "").strip()
    digits = "".join(ch for ch in doc if ch.isdigit())
    if digits:
        p["identification"] = {"type": "CNPJ" if len(digits) > 11 else "CPF", "number": digits}
    return p
PLATFORM_FEE = 0.0  # comissão 360Taxi por corrida (mantida em zero)
BR_TZ = timezone(timedelta(hours=-3))


def _now():
    return datetime.now(timezone.utc)


# ==================== Helpers ====================
async def _save_mp(driver_id, data):
    upd = {
        "mp_access_token": data.get("access_token"),
        "mp_refresh_token": data.get("refresh_token"),
        "mp_user_id": str(data.get("user_id")) if data.get("user_id") is not None else None,
        "mp_public_key": data.get("public_key"),
        "mp_connected_at": now_iso(),
    }
    exp_in = data.get("expires_in")
    if exp_in:
        upd["mp_token_expires_at"] = (_now() + timedelta(seconds=int(exp_in))).isoformat()
    await db.users.update_one({"id": driver_id}, {"$set": {k: v for k, v in upd.items() if v is not None}})


async def _driver_token(driver):
    """access_token OAuth do motorista, renovado se estiver perto de expirar."""
    if not driver:
        return None
    tok = driver.get("mp_access_token")
    if not tok:
        return None
    exp = driver.get("mp_token_expires_at")
    expired = False
    if exp:
        try:
            expired = datetime.fromisoformat(exp) <= _now() + timedelta(minutes=5)
        except Exception:
            expired = False
    if expired and driver.get("mp_refresh_token"):
        try:
            data = mp.refresh_driver_token(driver["mp_refresh_token"])
            await _save_mp(driver["id"], data)
            return data.get("access_token")
        except Exception:
            return tok
    return tok


def _pay_public(r):
    p = r.get("payment") or {}
    return {
        "method": p.get("method"),
        "status": p.get("status") or "none",
        "qr_code": p.get("qr_code"),
        "qr_code_base64": p.get("qr_code_base64"),
        "ticket_url": p.get("ticket_url"),
        "amount": round(float(r.get("final_price") or r.get("agreed_price") or 0), 2),
        "status_detail": p.get("status_detail"),
        "cash_amount": p.get("cash_amount"),
        "card_id": p.get("card_id"),
    }


async def _mark_paid(rid):
    r = await db.taxi_rides.find_one({"id": rid})
    if not r:
        return
    if r.get("payment_notified"):
        return
    await db.taxi_rides.update_one({"id": rid}, {"$set": {
        "payment.status": "approved", "payment_paid_at": now_iso(), "payment_notified": True,
    }})
    driver = await db.users.find_one({"id": r.get("driver_id")}) if r.get("driver_id") else None
    dname = (driver or {}).get("name") or "motorista"
    await create_notification(r["consumer_id"], "consumer", "taxi_paid", "Pagamento confirmado ✅",
                              f"Muito obrigado por andar com {dname}! Volte sempre. 360táxi.", "/taxi")
    if r.get("driver_id"):
        await create_notification(r["driver_id"], "deliverer", "taxi_paid_driver", "Pagamento recebido ✅",
                                  "Valor recebido com sucesso! Vamos para a próxima!", "/deliverer")
    try:
        await ws_hub.broadcast_role("consumer", {"type": "taxi_event", "event": "payment"})
        await ws_hub.broadcast_role("deliverer", {"type": "taxi_event", "event": "payment"})
    except Exception:
        pass


async def handle_ride_webhook(pid, ride):
    """Chamado pelo webhook do MP quando o pagamento é de uma corrida."""
    driver = await db.users.find_one({"id": ride.get("driver_id")}) if ride.get("driver_id") else None
    token = await _driver_token(driver)
    if not token:
        return
    try:
        pay = mp.mp_request("GET", f"/v1/payments/{pid}", token)
    except Exception:
        return
    if pay.get("status") == "approved":
        await _mark_paid(ride["id"])


# ==================== Motorista — conectar conta Mercado Pago (OAuth) ====================
@router.get("/api/taxi/driver/mp/connect")
async def mp_connect(user=Depends(deliverer_only)):
    if not os.environ.get("MP_CLIENT_ID"):
        raise HTTPException(status_code=503, detail="Integração Mercado Pago ainda não configurada pela plataforma.")
    state = f"{user['id']}:{secrets.token_urlsafe(16)}"
    await db.mp_oauth_states.insert_one({"state": state, "driver_id": user["id"], "at": now_iso()})
    return {"url": mp.oauth_authorize_url(state)}


@router.get("/api/mercadopago/oauth/callback")
async def mp_callback(code: str = "", state: str = ""):
    dest = f"{FRONTEND_URL}/deliverer"
    rec = await db.mp_oauth_states.find_one({"state": state})
    if not rec or not code:
        return RedirectResponse(f"{dest}?mp=erro")
    await db.mp_oauth_states.delete_one({"state": state})
    try:
        data = mp.exchange_code(code)
        await _save_mp(rec["driver_id"], data)
    except Exception:
        return RedirectResponse(f"{dest}?mp=erro")
    return RedirectResponse(f"{dest}?mp=conectado")


@router.post("/api/taxi/driver/mp/disconnect")
async def mp_disconnect(user=Depends(deliverer_only)):
    await db.users.update_one({"id": user["id"]}, {"$unset": {
        "mp_access_token": "", "mp_refresh_token": "", "mp_user_id": "",
        "mp_public_key": "", "mp_token_expires_at": "", "mp_connected_at": "",
    }})
    return {"ok": True}


# ==================== Passageiro — cartões salvos ====================
async def _get_customer_id(passenger):
    cid = passenger.get("mp_customer_id")
    if cid:
        return cid
    email = passenger.get("email")
    body = {"email": email}
    nm = (passenger.get("name") or "").split()
    if nm:
        body["first_name"] = nm[0]
        if len(nm) > 1:
            body["last_name"] = " ".join(nm[1:])
    cid = None
    try:
        res = mp.mp_post("/v1/customers", body, idem=str(uuid.uuid4()))
        cid = res.get("id")
    except Exception:
        try:
            search = mp.mp_get(f"/v1/customers/search?email={email}")
            results = search.get("results") or []
            cid = results[0]["id"] if results else None
        except Exception:
            cid = None
    if cid:
        await db.users.update_one({"id": passenger["id"]}, {"$set": {"mp_customer_id": cid}})
    return cid


def _card_public(c):
    return {
        "id": c.get("id"),
        "last_four": c.get("last_four_digits"),
        "brand": (c.get("payment_method") or {}).get("id"),
        "exp": f'{c.get("expiration_month")}/{c.get("expiration_year")}',
    }


class CardSaveInput(BaseModel):
    token: str


@router.get("/api/taxi/passenger/cards")
async def list_cards(user=Depends(consumer_only)):
    u = await db.users.find_one({"id": user["id"]})
    cid = u.get("mp_customer_id")
    cards = []
    if cid:
        try:
            cards = mp.mp_get(f"/v1/customers/{cid}/cards") or []
        except Exception:
            cards = []
    return {"public_key": mp.public_key(), "cards": [_card_public(c) for c in cards]}


@router.post("/api/taxi/passenger/cards")
async def add_card(payload: CardSaveInput, user=Depends(consumer_only)):
    u = await db.users.find_one({"id": user["id"]})
    cid = await _get_customer_id(u)
    if not cid:
        raise HTTPException(status_code=502, detail="Não foi possível iniciar o cadastro de cartão.")
    try:
        card = mp.mp_post(f"/v1/customers/{cid}/cards", {"token": payload.token}, idem=str(uuid.uuid4()))
    except Exception:
        raise HTTPException(status_code=502, detail="Não foi possível salvar o cartão. Verifique os dados e tente novamente.")
    return _card_public(card)


@router.delete("/api/taxi/passenger/cards/{card_id}")
async def del_card(card_id: str, user=Depends(consumer_only)):
    u = await db.users.find_one({"id": user["id"]})
    cid = u.get("mp_customer_id")
    if cid:
        try:
            mp.mp_delete(f"/v1/customers/{cid}/cards/{card_id}")
        except Exception:
            pass
    return {"ok": True}


# ==================== Pagamento ao fim da corrida ====================
class PaySelectInput(BaseModel):
    method: str  # pix | card | cash
    card_id: Optional[str] = None
    card_token: Optional[str] = None  # token gerado no front (cartão salvo + CVV)
    device_id: Optional[str] = None  # fingerprint do MercadoPago.js v2 (X-meli-session-id)


async def _ride_for_consumer(rid, uid):
    r = await db.taxi_rides.find_one({"id": rid})
    if not r or r.get("consumer_id") != uid:
        raise HTTPException(status_code=404, detail="Corrida não encontrada.")
    return r


@router.post("/api/taxi/rides/{rid}/pay")
async def pay_ride(rid: str, payload: PaySelectInput, user=Depends(consumer_only)):
    r = await _ride_for_consumer(rid, user["id"])
    if r.get("status") != "completed":
        raise HTTPException(status_code=400, detail="A corrida ainda não foi finalizada.")
    if (r.get("payment") or {}).get("status") == "approved":
        return _pay_public(r)
    amount = round(float(r.get("final_price") or r.get("agreed_price") or 0), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Valor da corrida inválido.")
    method = payload.method
    pdoc = await db.users.find_one({"id": user["id"]}) or user  # CPF/nome reais do banco p/ o payer
    if method in ("pix", "card") and not (pdoc.get("cpf")):
        raise HTTPException(status_code=400, detail="Cadastre seu CPF no perfil para pagar por Pix ou cartão.")
    driver = await db.users.find_one({"id": r.get("driver_id")}) if r.get("driver_id") else None
    attempt = str(uuid.uuid4())[:8]

    if method == "cash":
        pay = {"method": "cash", "status": "pending", "attempt_id": attempt}
        await db.taxi_rides.update_one({"id": rid}, {"$set": {"payment": pay, "payment_notified": False}})
        if r.get("driver_id"):
            await create_notification(r["driver_id"], "deliverer", "taxi_pay_cash", "Pagamento em dinheiro",
                                      "O passageiro escolheu pagar em dinheiro. Confirme o recebimento.", "/deliverer")
        try:
            await ws_hub.broadcast_role("deliverer", {"type": "taxi_event", "event": "payment"})
        except Exception:
            pass
        return _pay_public({**r, "payment": pay})

    token = await _driver_token(driver)
    if not token:
        raise HTTPException(status_code=400, detail="O motorista ainda não conectou a conta Mercado Pago para receber.")

    if method == "pix":
        body = {
            "transaction_amount": amount,
            "description": f"Corrida 360Taxi {rid}",
            "payment_method_id": "pix",
            "statement_descriptor": "OFF360",
            "binary_mode": True,
            "payer": _payer(pdoc),
            "external_reference": f"ride:{rid}:pix",
            "notification_url": WEBHOOK_URL,
            "date_of_expiration": (_now() + timedelta(hours=2)).astimezone(BR_TZ).strftime("%Y-%m-%dT%H:%M:%S.000-03:00"),
        }
        if PLATFORM_FEE > 0:
            body["application_fee"] = PLATFORM_FEE
        try:
            resp = mp.create_payment(body, idem=f"ride:{rid}:pix:{attempt}", device_id=payload.device_id, token=token)
        except Exception:
            raise HTTPException(status_code=502, detail="Falha ao gerar o Pix. Tente novamente.")
        tx = (resp.get("point_of_interaction") or {}).get("transaction_data") or {}
        pay = {
            "method": "pix", "status": "pending", "attempt_id": attempt,
            "mp_payment_id": str(resp.get("id")), "external_reference": f"ride:{rid}:pix",
            "qr_code": tx.get("qr_code"), "qr_code_base64": tx.get("qr_code_base64"),
            "ticket_url": tx.get("ticket_url"),
        }
        await db.taxi_rides.update_one({"id": rid}, {"$set": {"payment": pay, "payment_notified": False}})
        return _pay_public({**r, "payment": pay})

    if method == "card":
        if not payload.card_token:
            raise HTTPException(status_code=400, detail="Informe o CVV do cartão para concluir o pagamento.")
        body = {
            "transaction_amount": amount,
            "token": payload.card_token,
            "description": f"Corrida 360Taxi {rid}",
            "installments": 1,
            "statement_descriptor": "OFF360",
            "binary_mode": True,
            "payer": _payer(pdoc),
            "external_reference": f"ride:{rid}:card",
            "notification_url": WEBHOOK_URL,
        }
        if PLATFORM_FEE > 0:
            body["application_fee"] = PLATFORM_FEE
        try:
            resp = mp.create_payment(body, idem=f"ride:{rid}:card:{attempt}", device_id=payload.device_id, token=token)
        except Exception:
            raise HTTPException(status_code=502, detail="Falha ao processar o cartão. Tente novamente.")
        status = resp.get("status")
        st = "approved" if status == "approved" else ("pending" if status in ("in_process", "pending") else "failed")
        pay = {
            "method": "card", "status": st, "attempt_id": attempt,
            "mp_payment_id": str(resp.get("id")), "external_reference": f"ride:{rid}:card",
            "status_detail": resp.get("status_detail"),
        }
        await db.taxi_rides.update_one({"id": rid}, {"$set": {"payment": pay, "payment_notified": False}})
        if st == "approved":
            await _mark_paid(rid)
        elif st == "failed":
            raise HTTPException(status_code=402, detail="Pagamento recusado. Tente outro cartão ou pague em dinheiro.")
        r2 = await db.taxi_rides.find_one({"id": rid})
        return _pay_public(r2)

    raise HTTPException(status_code=400, detail="Meio de pagamento inválido.")


class CashInformInput(BaseModel):
    amount: float


@router.post("/api/taxi/rides/{rid}/pay/cash-inform")
async def cash_inform(rid: str, payload: CashInformInput, user=Depends(deliverer_only)):
    """Motorista informa o valor recebido em dinheiro; o passageiro precisa confirmar."""
    r = await db.taxi_rides.find_one({"id": rid})
    if not r or r.get("driver_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Corrida não encontrada.")
    if (r.get("payment") or {}).get("method") != "cash":
        raise HTTPException(status_code=400, detail="O pagamento desta corrida não é em dinheiro.")
    amount = round(float(payload.amount or 0), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Informe um valor válido.")
    await db.taxi_rides.update_one({"id": rid}, {"$set": {
        "payment.cash_amount": amount, "payment.status": "awaiting_confirm",
    }})
    await create_notification(r["consumer_id"], "consumer", "taxi_pay_cash_confirm", "Confirmar pagamento em dinheiro",
                              f"O motorista informou R$ {amount:.2f} recebido. Confirme no app.", "/taxi")
    try:
        await ws_hub.broadcast_role("consumer", {"type": "taxi_event", "event": "payment"})
    except Exception:
        pass
    return {"ok": True}


@router.post("/api/taxi/rides/{rid}/pay/cash-confirm")
async def cash_confirm(rid: str, user=Depends(consumer_only)):
    """Passageiro confirma o recebimento em dinheiro informado pelo motorista."""
    r = await db.taxi_rides.find_one({"id": rid})
    if not r or r.get("consumer_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Corrida não encontrada.")
    if (r.get("payment") or {}).get("method") != "cash":
        raise HTTPException(status_code=400, detail="O pagamento desta corrida não é em dinheiro.")
    await _mark_paid(rid)
    return {"ok": True}


@router.get("/api/taxi/rides/{rid}/pay/status")
async def pay_status(rid: str, user=Depends(get_current_user)):
    r = await db.taxi_rides.find_one({"id": rid})
    if not r or user["id"] not in (r.get("consumer_id"), r.get("driver_id")):
        raise HTTPException(status_code=404, detail="Corrida não encontrada.")
    p = r.get("payment") or {}
    if p.get("method") == "pix" and p.get("status") == "pending" and p.get("mp_payment_id"):
        driver = await db.users.find_one({"id": r.get("driver_id")}) if r.get("driver_id") else None
        token = await _driver_token(driver)
        if token:
            try:
                pay = mp.mp_request("GET", f"/v1/payments/{p['mp_payment_id']}", token)
                if pay.get("status") == "approved":
                    await _mark_paid(rid)
                    r = await db.taxi_rides.find_one({"id": rid})
            except Exception:
                pass
    driver = await db.users.find_one({"id": r.get("driver_id")}) if r.get("driver_id") else None
    out = _pay_public(r)
    out["driver_name"] = (driver or {}).get("name")
    return out
