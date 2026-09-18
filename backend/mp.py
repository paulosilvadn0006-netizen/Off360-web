"""Cliente do Mercado Pago (usado apenas pelo módulo 360Taxi).

Criação de pagamentos (Pix/cartão) usa o SDK oficial `mercadopago`; as demais
chamadas auxiliares (customers, cards, preapproval, OAuth) seguem via REST.
"""
import os
import requests
import mercadopago
from mercadopago.config import RequestOptions

MP_API = "https://api.mercadopago.com"


def _token():
    return os.environ.get("MP_ACCESS_TOKEN")


def public_key():
    return os.environ.get("MP_PUBLIC_KEY")


class MPError(Exception):
    def __init__(self, code, body):
        self.code = code
        self.body = body
        super().__init__(f"Mercado Pago error {code}")


_sdk_cache = {}


def _platform_sdk():
    tok = _token()
    if _sdk_cache.get("tok") != tok:
        _sdk_cache["sdk"] = mercadopago.SDK(tok)
        _sdk_cache["tok"] = tok
    return _sdk_cache["sdk"]


def create_payment(body, idem=None, device_id=None, token=None):
    """Cria um pagamento via SDK oficial do Mercado Pago (POST /v1/payments).

    - token=None usa o access token da plataforma; caso contrário usa o token
      OAuth do vendedor (marketplace/split), sem mutar o SDK global.
    - idem -> header X-Idempotency-Key (reutilize a mesma chave em retries).
    - device_id -> header X-meli-session-id (fingerprint do MercadoPago.js v2).
    """
    opts = RequestOptions(access_token=token) if token else RequestOptions()
    headers = {}
    if idem:
        headers["x-idempotency-key"] = idem
    if device_id:
        headers["x-meli-session-id"] = device_id
    if headers:
        opts.custom_headers = headers
    result = _platform_sdk().payment().create(body, opts)
    code = result.get("status")
    resp = result.get("response") or {}
    if code not in (200, 201):
        raise MPError(code or 502, resp)
    return resp


def _headers(idem=None):
    h = {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}
    if idem:
        h["X-Idempotency-Key"] = idem
    return h


def mp_post(path, body, idem=None):
    r = requests.post(f"{MP_API}{path}", json=body, headers=_headers(idem), timeout=25)
    r.raise_for_status()
    return r.json()


def mp_get(path):
    r = requests.get(f"{MP_API}{path}", headers=_headers(), timeout=25)
    r.raise_for_status()
    return r.json()


def mp_delete(path):
    r = requests.delete(f"{MP_API}{path}", headers=_headers(), timeout=25)
    r.raise_for_status()
    return r.json() if r.text else {}


# ==================== OAuth Marketplace (repasse direto ao motorista) ====================
import uuid as _uuid
from urllib.parse import urlencode


def oauth_authorize_url(state):
    params = {
        "client_id": os.environ.get("MP_CLIENT_ID", ""),
        "response_type": "code",
        "platform_id": "mp",
        "redirect_uri": os.environ.get("MP_REDIRECT_URI", ""),
        "state": state,
    }
    return "https://auth.mercadopago.com.br/authorization?" + urlencode(params)


def exchange_code(code):
    r = requests.post(f"{MP_API}/oauth/token", json={
        "client_id": os.environ.get("MP_CLIENT_ID"),
        "client_secret": os.environ.get("MP_CLIENT_SECRET"),
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": os.environ.get("MP_REDIRECT_URI"),
    }, timeout=25)
    r.raise_for_status()
    return r.json()


def refresh_driver_token(refresh_token):
    r = requests.post(f"{MP_API}/oauth/token", json={
        "client_id": os.environ.get("MP_CLIENT_ID"),
        "client_secret": os.environ.get("MP_CLIENT_SECRET"),
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }, timeout=25)
    r.raise_for_status()
    return r.json()


def mp_request(method, path, token, body=None, idem=None):
    """Requisição autenticada com o token OAuth do motorista (split/marketplace)."""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if idem:
        headers["X-Idempotency-Key"] = idem
    r = requests.request(method, f"{MP_API}{path}", headers=headers, json=body, timeout=30)
    r.raise_for_status()
    return r.json() if r.text else {}
