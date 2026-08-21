"""Pagamentos do módulo 360Taxi (Mercado Pago): assinatura via cartão (preapproval
com trial de 30 dias), renovação via Pix e webhook. Isolado do restante do projeto."""
import os
import math
import hmac
from html import escape
from uuid import uuid4
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Request, BackgroundTasks, HTTPException

import mp
from emailer import send_email
from core import db, require_role, create_notification, now_iso
from taxi_subscription import (
    ensure_trial, sub_state, apply_approved, dias_restantes, _parse, _now,
    PLAN_AMOUNT,
)

router = APIRouter(tags=["taxi-payments"])
deliverer_only = require_role("deliverer")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
BR_TZ = timezone(timedelta(hours=-3))  # America/Sao_Paulo


@router.get("/api/taxi/subscription")
async def get_subscription(user=Depends(deliverer_only)):
    u = await db.users.find_one({"id": user["id"]})
    await ensure_trial(u)
    status = await sub_state(u)
    return {
        "status_assinatura": status,
        "data_inicio_ciclo": u.get("data_inicio_ciclo"),
        "data_vencimento": u.get("data_vencimento"),
        "dias_restantes": dias_restantes(u),
        "origem": u.get("assinatura_origem"),
        "amount": PLAN_AMOUNT,
        "public_key": mp.public_key(),
    }


@router.post("/api/taxi/subscription/card")
async def subscribe_card(user=Depends(deliverer_only)):
    """Assinatura recorrente (cartão) com 30 dias grátis. Retorna init_point p/ o motorista autorizar."""
    body = {
        "reason": "Assinatura 360Taxi - Plano mensal do motorista",
        "external_reference": f"taxi_sub:{user['id']}",
        "payer_email": user.get("email"),
        "back_url": f"{FRONTEND_URL}/deliverer",
        "status": "pending",
        "auto_recurring": {
            "frequency": 1,
            "frequency_type": "months",
            "transaction_amount": round(PLAN_AMOUNT, 2),
            "currency_id": "BRL",
            "free_trial": {"frequency": 30, "frequency_type": "days"},
        },
    }
    res = mp.mp_post("/preapproval", body)
    await db.users.update_one({"id": user["id"]}, {"$set": {"mp_preapproval_id": str(res.get("id"))}})
    return {
        "preapproval_id": res.get("id"),
        "status": res.get("status"),
        "init_point": res.get("init_point"),
    }


@router.post("/api/taxi/subscription/pix")
async def subscribe_pix(request: Request, user=Depends(deliverer_only)):
    """Gera cobrança Pix (QR + copia e cola) para renovar 30 dias."""
    payload = {}
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    cpf = (payload or {}).get("cpf") or ""
    payer = {"email": user.get("email")}
    nm = (user.get("name") or "").split()
    if nm:
        payer["first_name"] = nm[0]
        if len(nm) > 1:
            payer["last_name"] = " ".join(nm[1:])
    if cpf:
        payer["identification"] = {"type": "CPF", "number": "".join(ch for ch in cpf if ch.isdigit())}
    body = {
        "transaction_amount": round(PLAN_AMOUNT, 2),
        "description": "Renovação 360Taxi - 30 dias",
        "payment_method_id": "pix",
        "external_reference": f"taxi_sub:{user['id']}",
        "notification_url": f"{FRONTEND_URL}/api/webhooks/mercadopago",
        "date_of_expiration": (_now() + timedelta(hours=24)).astimezone(BR_TZ).strftime("%Y-%m-%dT%H:%M:%S.000-03:00"),
        "payer": payer,
    }
    pay = mp.mp_post("/v1/payments", body, idem=str(uuid4()))
    tx = (pay.get("point_of_interaction") or {}).get("transaction_data") or {}
    return {
        "payment_id": pay.get("id"),
        "status": pay.get("status"),
        "qr_code": tx.get("qr_code"),
        "qr_code_base64": tx.get("qr_code_base64"),
        "ticket_url": tx.get("ticket_url"),
        "expires_at": body["date_of_expiration"],
    }


@router.get("/api/taxi/subscription/pix/{payment_id}")
async def check_pix(payment_id: str, user=Depends(deliverer_only)):
    """Consulta o status do Pix; se aprovado, renova a assinatura (fallback do webhook)."""
    pay = mp.mp_get(f"/v1/payments/{payment_id}")
    status = pay.get("status")
    if status == "approved" and (pay.get("external_reference") or "") == f"taxi_sub:{user['id']}":
        await apply_approved(user["id"], _parse(pay.get("date_approved")) or _now(), "pix",
                             {"mp_last_payment_id": str(payment_id)})
    return {"status": status}


# ==================== WEBHOOK ====================
async def _handle_payment(pid):
    pay = mp.mp_get(f"/v1/payments/{pid}")
    if pay.get("status") != "approved":
        return
    ext = pay.get("external_reference") or ""
    if not ext.startswith("taxi_sub:"):
        return
    driver_id = ext.split(":", 1)[1]
    u = await db.users.find_one({"id": driver_id})
    if not u or u.get("mp_last_payment_id") == str(pid):
        return  # idempotência: já processado
    origem = "pix" if pay.get("payment_type_id") == "bank_transfer" else "cartao"
    await apply_approved(driver_id, _parse(pay.get("date_approved")) or _now(), origem,
                         {"mp_last_payment_id": str(pid)})


async def _handle_authorized_payment(aid):
    inv = mp.mp_get(f"/authorized_payments/{aid}")
    pref = inv.get("preapproval_id")
    if not pref:
        return
    sub = mp.mp_get(f"/preapproval/{pref}")
    ext = sub.get("external_reference") or ""
    if not ext.startswith("taxi_sub:"):
        return
    driver_id = ext.split(":", 1)[1]
    pay_status = (inv.get("payment") or {}).get("status") or inv.get("status")
    if pay_status == "approved":
        await apply_approved(driver_id, _now(), "cartao", {"mp_last_payment_id": str(aid)})


@router.post("/api/webhooks/mercadopago")
async def mercadopago_webhook(request: Request):
    params = request.query_params
    try:
        body = await request.json()
    except Exception:
        body = {}
    topic = params.get("type") or params.get("topic") or body.get("type") or ""
    rid = params.get("data.id") or params.get("id") or (body.get("data") or {}).get("id")
    try:
        if not rid:
            return {"received": True}
        if topic in ("payment", "payment.updated", "payment.created"):
            await _handle_payment(rid)
        elif topic in ("subscription_authorized_payment",):
            await _handle_authorized_payment(rid)
        elif topic in ("subscription_preapproval", "preapproval"):
            sub = mp.mp_get(f"/preapproval/{rid}")
            ext = sub.get("external_reference") or ""
            if ext.startswith("taxi_sub:"):
                await db.users.update_one({"id": ext.split(":", 1)[1]},
                                          {"$set": {"mp_preapproval_id": str(rid), "assinatura_origem": "cartao"}})
    except Exception:
        pass  # nunca derruba o webhook; MP reenvia em caso de erro
    return {"received": True}


# ==================== LEMBRETE DE VENCIMENTO (3 dias antes) ====================
def _reminder_html(name, dias, due):
    link = f"{FRONTEND_URL}/deliverer"
    dstr = due.astimezone(BR_TZ).strftime("%d/%m/%Y")
    return (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;'
        'font-family:Arial,sans-serif;color:#0b1220">'
        '<h2 style="margin:0 0 8px">Sua assinatura 360Taxi está vencendo</h2>'
        f'<p>Olá, {escape(name)}!</p>'
        f'<p>Seu acesso ao 360Taxi vence em <strong>{dias} dia(s)</strong> (em {dstr}). '
        'Para continuar aceitando corridas, renove por <strong>Pix</strong> ou cartão dentro do app.</p>'
        f'<p><a href="{link}" style="display:inline-block;background:#FF6A00;color:#fff;'
        'text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">Renovar agora</a></p>'
        '<p style="font-size:12px;color:#888">Enviado por OFF360 · 360Taxi. '
        'Nunca pedimos sua senha ou dados de cartão por e-mail.</p></td></tr></table>'
    )


async def _run_reminders():
    now = _now()
    horizon = now + timedelta(days=3)
    async for u in db.users.find({"role": "deliverer", "status_assinatura": "Ativo",
                                  "data_vencimento": {"$ne": None}}):
        due = _parse(u.get("data_vencimento"))
        if not due or not (now < due <= horizon):
            continue
        if u.get("renewal_reminder_sent_for") == u.get("data_vencimento"):
            continue  # já avisado para este vencimento (idempotência)
        dias = max(1, math.ceil((due - now).total_seconds() / 86400))
        try:
            await create_notification(
                u["id"], "deliverer", "taxi_sub_reminder", "Assinatura 360Taxi vencendo",
                f"Sua assinatura vence em {dias} dia(s). Renove por Pix para continuar aceitando corridas.",
                "/deliverer")
        except Exception:
            pass
        if u.get("email"):
            try:
                await send_email(to=u["email"], subject="Sua assinatura 360Taxi está vencendo",
                                 html=_reminder_html(u.get("name") or "motorista", dias, due))
            except Exception:
                pass
        await db.users.update_one({"id": u["id"]},
                                  {"$set": {"renewal_reminder_sent_for": u.get("data_vencimento")}})


@router.post("/api/cron/taxi-subscription-reminders")
async def cron_taxi_reminders(request: Request, background: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    secret = os.environ.get("WEBHOOK_CRON_SECRET")
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    if not secret or not hmac.compare_digest(token, secret):
        raise HTTPException(status_code=401, detail="Não autorizado")
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("X-Webhook-Id") or (body or {}).get("run_id")
    if run_id:
        if await db.cron_runs.find_one({"run_id": run_id}):
            return {"ok": True, "duplicate": True}
        await db.cron_runs.insert_one({"run_id": run_id, "job": "taxi-sub-reminder", "at": now_iso()})
    background.add_task(_run_reminders)
    return {"ok": True, "accepted": True}
