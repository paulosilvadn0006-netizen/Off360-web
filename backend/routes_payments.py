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
merchant_only = require_role("merchant")
MERCHANT_PLAN_AMOUNT = 89.90  # cobrança mensal fixa por estabelecimento (OFF360)

FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
WEBHOOK_URL = os.environ.get("MP_WEBHOOK_URL") or f"{FRONTEND_URL}/api/webhooks/mercadopago"
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
    device_id = (payload or {}).get("device_id") or None
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
        "statement_descriptor": "OFF360",
        "binary_mode": True,
        "external_reference": f"taxi_sub:{user['id']}",
        "notification_url": WEBHOOK_URL,
        "date_of_expiration": (_now() + timedelta(hours=24)).astimezone(BR_TZ).strftime("%Y-%m-%dT%H:%M:%S.000-03:00"),
        "payer": payer,
    }
    pay = mp.create_payment(body, idem=str(uuid4()), device_id=device_id)
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


# ==================== ASSINATURA DO EMPRESÁRIO (OFF360) ====================
def _merchant_receipt_html(name, fantasy, next_due, method):
    link = f"{FRONTEND_URL}/merchant"
    dstr = next_due.astimezone(BR_TZ).strftime("%d/%m/%Y")
    mlabel = "Pix" if method == "pix" else "Cartão de crédito"
    return (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0b1220">'
        '<table role="presentation" width="100%" style="max-width:520px;margin:0 auto;border:1px solid #eee;border-radius:16px;overflow:hidden">'
        '<tr><td style="background:#FF7A00;padding:20px 24px;color:#fff"><h1 style="margin:0;font-size:20px">OFF360 · Comprovante de ativação</h1></td></tr>'
        '<tr><td style="padding:24px">'
        f'<p style="margin:0 0 10px">Olá, {escape(name or "empresário")}!</p>'
        f'<p style="margin:0 0 16px">O pagamento da ativação do estabelecimento <strong>{escape(fantasy or "")}</strong> foi confirmado com sucesso.</p>'
        '<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">'
        '<tr><td style="padding:8px 0;color:#667">Plano mensal</td><td style="padding:8px 0;text-align:right;font-weight:bold">R$ 89,90</td></tr>'
        f'<tr><td style="padding:8px 0;color:#667">Forma de pagamento</td><td style="padding:8px 0;text-align:right">{mlabel}</td></tr>'
        f'<tr><td style="padding:8px 0;color:#667">Próxima renovação</td><td style="padding:8px 0;text-align:right">{dstr}</td></tr>'
        '</table>'
        '<p style="margin:16px 0 0;font-size:13px;color:#667">A renovação é automática a cada 30 dias. Todas as funcionalidades do seu painel já estão liberadas.</p>'
        f'<p style="margin:20px 0 0"><a href="{link}" style="display:inline-block;background:#FF7A00;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">Abrir meu painel</a></p>'
        '</td></tr>'
        '<tr><td style="padding:16px 24px;background:#f3f4f6;font-size:12px;color:#888">Enviado por OFF360. Nunca pedimos sua senha ou dados de cartão por e-mail.</td></tr>'
        '</table></td></tr></table>'
    )


async def _log_billing_event(e, kind, method):
    try:
        await db.merchant_billing_events.insert_one({
            "id": str(uuid4()), "establishment_id": e.get("id"), "owner_id": e.get("owner_id"),
            "fantasy_name": e.get("fantasy_name"), "kind": kind, "method": method,
            "amount": round(MERCHANT_PLAN_AMOUNT, 2), "at": _now().isoformat(),
        })
    except Exception:
        pass


async def _activate_merchant_est(eid, method, pid):
    e = await db.establishments.find_one({"id": eid})
    if not e or e.get("mp_last_payment_id") == str(pid):
        return
    now = _now()
    next_due = now + timedelta(days=30)
    await db.establishments.update_one({"id": eid}, {"$set": {
        "subscription_status": "active", "approval_status": "approved",
        "payment_required": False, "activated": True, "auto_renew": True,
        "payment_method": method, "mp_last_payment_id": str(pid),
        "plan_price": round(MERCHANT_PLAN_AMOUNT, 2),
        "subscription_start": now.isoformat(),
        "next_due": next_due.isoformat(),
        "renewal_reminder_sent_for": None,
        "last_charge_failed": False,
    }})
    await _log_billing_event(e, "renewal" if e.get("subscription_start") else "activation", method)
    try:
        await create_notification(e.get("owner_id"), "merchant", "establishment_status",
            "Estabelecimento ativado!",
            f"{e.get('fantasy_name')} está ativo no OFF360. Enviamos o comprovante para o seu e-mail. Todas as funcionalidades foram liberadas.",
            "/merchant")
    except Exception:
        pass
    try:
        owner = await db.users.find_one({"id": e.get("owner_id")})
        if owner and owner.get("email"):
            await send_email(to=owner["email"], subject="Comprovante de ativação · OFF360",
                             html=_merchant_receipt_html(owner.get("name"), e.get("fantasy_name"), next_due, method))
    except Exception:
        pass


async def _merchant_est(user, eid):
    e = await db.establishments.find_one({"id": eid, "owner_id": user["id"]})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    return e


@router.post("/api/merchant/pay/pix")
async def merchant_pay_pix(request: Request, user=Depends(merchant_only)):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    eid = (payload or {}).get("establishment_id")
    e = await _merchant_est(user, eid)
    cpf = "".join(ch for ch in ((payload or {}).get("cpf") or "") if ch.isdigit())
    if len(cpf) != 11:
        raise HTTPException(status_code=400, detail="Informe um CPF válido para gerar o Pix.")
    device_id = (payload or {}).get("device_id") or None
    payer = {"email": user.get("email"), "identification": {"type": "CPF", "number": cpf}}
    nm = (user.get("name") or "").split()
    if nm:
        payer["first_name"] = nm[0]
        if len(nm) > 1:
            payer["last_name"] = " ".join(nm[1:])
    body = {
        "transaction_amount": round(MERCHANT_PLAN_AMOUNT, 2),
        "description": f"Ativacao OFF360 - {e.get('fantasy_name')}",
        "payment_method_id": "pix",
        "statement_descriptor": "OFF360",
        "external_reference": f"merchant_sub:{eid}",
        "notification_url": WEBHOOK_URL,
        "date_of_expiration": (_now() + timedelta(hours=24)).astimezone(BR_TZ).strftime("%Y-%m-%dT%H:%M:%S.000-03:00"),
        "payer": payer,
    }
    pay = mp.create_payment(body, idem=str(uuid4()), device_id=device_id)
    tx = (pay.get("point_of_interaction") or {}).get("transaction_data") or {}
    return {
        "payment_id": pay.get("id"), "status": pay.get("status"),
        "qr_code": tx.get("qr_code"), "qr_code_base64": tx.get("qr_code_base64"),
        "ticket_url": tx.get("ticket_url"), "amount": round(MERCHANT_PLAN_AMOUNT, 2),
    }


@router.get("/api/merchant/pay/pix/{payment_id}")
async def merchant_check_pix(payment_id: str, establishment_id: str, user=Depends(merchant_only)):
    await _merchant_est(user, establishment_id)
    pay = mp.mp_get(f"/v1/payments/{payment_id}")
    status = pay.get("status")
    if status == "approved" and (pay.get("external_reference") or "") == f"merchant_sub:{establishment_id}":
        await _activate_merchant_est(establishment_id, "pix", str(payment_id))
    return {"status": status}


@router.post("/api/merchant/pay/card")
async def merchant_pay_card(request: Request, user=Depends(merchant_only)):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    eid = (payload or {}).get("establishment_id")
    e = await _merchant_est(user, eid)
    body = {
        "reason": f"OFF360 - Assinatura mensal {e.get('fantasy_name')}",
        "external_reference": f"merchant_sub:{eid}",
        "payer_email": user.get("email"),
        "back_url": f"{FRONTEND_URL}/merchant/activate?eid={eid}",
        "status": "pending",
        "auto_recurring": {
            "frequency": 1, "frequency_type": "months",
            "transaction_amount": round(MERCHANT_PLAN_AMOUNT, 2), "currency_id": "BRL",
        },
    }
    old_pre = e.get("mp_preapproval_id")
    res = mp.mp_post("/preapproval", body)
    new_pre = str(res.get("id"))
    # Trocar cartão: cancela o preapproval anterior para não cobrar em dois cartões.
    if old_pre and str(old_pre) != new_pre:
        try:
            mp.mp_put(f"/preapproval/{old_pre}", {"status": "cancelled"})
        except Exception:
            pass
    await db.establishments.update_one({"id": eid}, {"$set": {"mp_preapproval_id": new_pre}})
    return {"preapproval_id": res.get("id"), "status": res.get("status"), "init_point": res.get("init_point")}


@router.get("/api/merchant/pay/card/{preapproval_id}")
async def merchant_check_card(preapproval_id: str, establishment_id: str, user=Depends(merchant_only)):
    await _merchant_est(user, establishment_id)
    sub = mp.mp_get(f"/preapproval/{preapproval_id}")
    status = sub.get("status")
    if status == "authorized" and (sub.get("external_reference") or "") == f"merchant_sub:{establishment_id}":
        await _activate_merchant_est(establishment_id, "cartao", str(preapproval_id))
    return {"status": status}


@router.post("/api/merchant/pay/renew")
async def merchant_renew(request: Request, user=Depends(merchant_only)):
    """Renovação em 1 toque: usa o cartão já vinculado (preapproval autorizado), sem refazer o checkout."""
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    eid = (payload or {}).get("establishment_id")
    e = await _merchant_est(user, eid)
    pre = e.get("mp_preapproval_id")
    if not pre:
        return {"renewed": False, "needs_checkout": True}
    try:
        sub = mp.mp_get(f"/preapproval/{pre}")
    except Exception:
        return {"renewed": False, "needs_checkout": True}
    if sub.get("status") == "authorized":
        await _activate_merchant_est(eid, "cartao", f"{pre}:renew:{int(_now().timestamp())}")
        return {"renewed": True, "method": "cartao"}
    return {"renewed": False, "needs_checkout": True}


def _charge_failed_html(name, fantasy):
    link = f"{FRONTEND_URL}/merchant/activate"
    return (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0b1220">'
        '<h2 style="margin:0 0 8px;color:#c0392b">Falha na cobrança do cartão</h2>'
        f'<p>Olá, {escape(name or "empresário")}!</p>'
        f'<p>Não conseguimos renovar a mensalidade de <strong>{escape(fantasy or "")}</strong> (R$ 89,90) no seu cartão. '
        'Atualize o cartão para evitar o bloqueio do seu estabelecimento no OFF360.</p>'
        f'<p><a href="{link}" style="display:inline-block;background:#FF7A00;color:#fff;text-decoration:none;'
        'padding:12px 22px;border-radius:10px;font-weight:bold">Atualizar cartão</a></p>'
        '<p style="font-size:12px;color:#888">Enviado por OFF360. Nunca pedimos sua senha ou dados de cartão por e-mail.</p>'
        '</td></tr></table>'
    )


async def _notify_charge_failed(eid):
    e = await db.establishments.find_one({"id": eid})
    if not e:
        return
    await db.establishments.update_one({"id": eid}, {"$set": {"last_charge_failed": True}})
    await _log_billing_event(e, "failure", "cartao")
    try:
        await create_notification(e.get("owner_id"), "merchant", "merchant_charge_failed",
            "Falha na cobrança do cartão ❌",
            f"Não conseguimos renovar a mensalidade de {e.get('fantasy_name')} no cartão. Atualize o cartão para evitar o bloqueio.",
            f"/merchant/activate?eid={eid}")
    except Exception:
        pass
    try:
        owner = await db.users.find_one({"id": e.get("owner_id")})
        if owner and owner.get("email"):
            await send_email(to=owner["email"], subject="Falha na cobrança · OFF360",
                             html=_charge_failed_html(owner.get("name"), e.get("fantasy_name")))
    except Exception:
        pass


@router.get("/api/merchant/card")
async def merchant_card(establishment_id: str, user=Depends(merchant_only)):
    e = await _merchant_est(user, establishment_id)
    pre = e.get("mp_preapproval_id")
    base = {"has_card": bool(pre), "auto_renew": bool(e.get("auto_renew")),
            "last_charge_failed": bool(e.get("last_charge_failed")),
            "next_due": e.get("next_due"), "payment_method": e.get("payment_method")}
    if not pre:
        return base
    try:
        sub = mp.mp_get(f"/preapproval/{pre}")
    except Exception:
        return {**base, "status": "unknown"}
    card = sub.get("card") or {}
    base.update({
        "status": sub.get("status"),
        "next_payment_date": sub.get("next_payment_date"),
        "payment_method_id": sub.get("payment_method_id"),
        "last_four": card.get("last_four_digits"),
    })
    return base


@router.post("/api/merchant/card/cancel")
async def merchant_card_cancel(request: Request, user=Depends(merchant_only)):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    eid = (payload or {}).get("establishment_id")
    e = await _merchant_est(user, eid)
    pre = e.get("mp_preapproval_id")
    if pre:
        try:
            mp.mp_put(f"/preapproval/{pre}", {"status": "cancelled"})
        except Exception:
            pass
    await db.establishments.update_one({"id": eid}, {"$set": {"auto_renew": False}, "$unset": {"mp_preapproval_id": ""}})
    nd = e.get("next_due")
    nd_str = ""
    try:
        from datetime import datetime
        nd_str = datetime.fromisoformat(nd.replace("Z", "+00:00")).strftime("%d/%m/%Y") if nd else ""
    except Exception:
        nd_str = ""
    try:
        await create_notification(e.get("owner_id"), "merchant", "establishment_status",
            "Renovação automática cancelada",
            f"A renovação automática no cartão de {e.get('fantasy_name')} foi cancelada."
            + (f" Seu acesso continua até {nd_str}; depois, renove manualmente." if nd_str else ""),
            "/merchant/subscription")
    except Exception:
        pass
    return {"ok": True}


# ==================== WEBHOOK ====================
async def _handle_payment(pid):
    # 1) É pagamento de uma corrida (marketplace, token do motorista)?
    ride = await db.taxi_rides.find_one({"payment.mp_payment_id": str(pid)})
    if ride:
        import routes_taxi_pay
        await routes_taxi_pay.handle_ride_webhook(str(pid), ride)
        return
    # 2) Pagamento de assinatura do motorista (token da plataforma).
    pay = mp.mp_get(f"/v1/payments/{pid}")
    if pay.get("status") != "approved":
        return
    ext = pay.get("external_reference") or ""
    if ext.startswith("merchant_sub:"):
        origem = "pix" if pay.get("payment_type_id") == "bank_transfer" else "cartao"
        await _activate_merchant_est(ext.split(":", 1)[1], origem, str(pid))
        return
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
    pay_status = (inv.get("payment") or {}).get("status") or inv.get("status")
    if ext.startswith("merchant_sub:"):
        eid = ext.split(":", 1)[1]
        if pay_status == "approved":
            await _activate_merchant_est(eid, "cartao", str(aid))
        elif pay_status in ("rejected", "cancelled"):
            await _notify_charge_failed(eid)
        return
    if not ext.startswith("taxi_sub:"):
        return
    driver_id = ext.split(":", 1)[1]
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
            elif ext.startswith("merchant_sub:") and sub.get("status") == "authorized":
                await _activate_merchant_est(ext.split(":", 1)[1], "cartao", str(rid))
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
        'Para continuar aceitando corridas, renove com <strong>cartão de crédito</strong> dentro do app.</p>'
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
                f"Sua assinatura vence em {dias} dia(s). Renove com cartão para continuar aceitando corridas.",
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
