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
