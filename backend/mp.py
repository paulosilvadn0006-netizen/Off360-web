"""Cliente REST isolado do Mercado Pago (usado apenas pelo módulo 360Taxi)."""
import os
import requests

MP_API = "https://api.mercadopago.com"


def _token():
    return os.environ.get("MP_ACCESS_TOKEN")


def public_key():
    return os.environ.get("MP_PUBLIC_KEY")


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
