"""Endpoints acionados pelo agendador da plataforma (.emergent/crons.yml).
Autenticados por Bearer WEBHOOK_CRON_SECRET; ack 2xx imediato + trabalho em background."""
import os
import hmac
import math
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Header
from dotenv import load_dotenv

from routes_admin import _run_backfill_coordinates
from core import db, create_notification, now_iso
from emailer import send_email
from html import escape

load_dotenv()

router = APIRouter(prefix="/api/cron", tags=["cron"])
log = logging.getLogger("off360")
SECRET = os.environ.get("WEBHOOK_CRON_SECRET")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")


def _authorize(authorization):
    if not SECRET or not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    token = authorization.split(" ", 1)[1]
    if not hmac.compare_digest(token, SECRET):
        raise HTTPException(status_code=401, detail="unauthorized")


async def _bg_backfill():
    try:
        res = await _run_backfill_coordinates()
        log.info("cron backfill-coordinates: %s atualizado(s) de %s pendente(s)", res.get("updated"), res.get("scanned"))
    except Exception:
        log.exception("cron backfill-coordinates failed")


@router.post("/backfill-coordinates")
async def cron_backfill_coordinates(background_tasks: BackgroundTasks, authorization: str = Header(None)):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _authorize(authorization)
    background_tasks.add_task(_bg_backfill)
    return {"ok": True, "queued": True}


# ==================== SEGURO APP MBM — lembretes + vencimento (anual) ====================
def _policy_email(name, dias):
    link = f"{FRONTEND_URL}/deliverer"
    return (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;'
        'font-family:Arial,sans-serif;color:#0b1220">'
        '<h2 style="margin:0 0 8px">Seguro APP MBM — apólice pendente</h2>'
        f'<p>Olá, {name or "motorista"}!</p>'
        '<p>Você aceitou o Seguro APP MBM mas ainda não anexou sua apólice. '
        'Para concluir 100% seu cadastro no 360Taxi e ficar online, contrate o seguro '
        'com a corretora e anexe a apólice no app.</p>'
        f'<p><a href="{link}" style="display:inline-block;background:#FF6A00;color:#fff;'
        'text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">Anexar apólice</a></p>'
        '<p style="font-size:12px;color:#888">Enviado por OFF360 · 360Taxi.</p></td></tr></table>'
    )


async def _run_insurance_checks():
    from datetime import date, timedelta
    today = date.today()
    warn_horizon = today + timedelta(days=30)
    admins = await db.users.find({"role": "admin"}).to_list(50)
    # 1) Lembrete: aceitou o seguro mas não anexou a apólice (1x por dia)
    async for u in db.users.find({"role": "deliverer", "taxi_registered": True,
                                  "taxi_insurance.accepted": True,
                                  "taxi_insurance.policy_url": {"$in": [None, ""]}}):
        ins = u.get("taxi_insurance") or {}
        if ins.get("reminder_sent_on") == today.isoformat():
            continue
        try:
            await create_notification(u["id"], "deliverer", "taxi_insurance_reminder",
                                      "Anexe sua apólice do Seguro APP MBM",
                                      "Você aceitou o seguro mas ainda não anexou a apólice. Anexe para concluir seu cadastro e ficar online.",
                                      "/deliverer")
        except Exception:
            pass
        if u.get("email"):
            try:
                await send_email(to=u["email"], subject="Seguro APP MBM — anexe sua apólice",
                                 html=_policy_email(u.get("name"), None))
            except Exception:
                pass
        await db.users.update_one({"id": u["id"]},
                                  {"$set": {"taxi_insurance.reminder_sent_on": today.isoformat()}})

    # 2) Vencimento (apólice anual): avisa 30 dias antes; expira quando passa da data
    async for u in db.users.find({"role": "deliverer",
                                  "taxi_insurance.status": "aprovada",
                                  "taxi_insurance.policy_expires_at": {"$nin": [None, ""]}}):
        ins = u.get("taxi_insurance") or {}
        try:
            exp = date.fromisoformat(ins.get("policy_expires_at"))
        except Exception:
            continue
        if exp < today:
            # Apólice vencida → bloqueia online + notifica motorista e admins
            await db.users.update_one({"id": u["id"]}, {"$set": {
                "taxi_insurance.status": "vencida", "taxi_online": False,
            }})
            try:
                await create_notification(u["id"], "deliverer", "taxi_insurance_expired",
                                          "Seguro APP MBM vencido ❌",
                                          "Sua apólice venceu. Renove com a corretora e reenvie a apólice para voltar a ficar online.",
                                          "/deliverer")
            except Exception:
                pass
            for a in admins:
                try:
                    await create_notification(a["id"], "admin", "taxi_insurance_expired",
                                              "Apólice de motorista vencida",
                                              f"A apólice de {u.get('name')} venceu em {ins.get('policy_expires_at')}.",
                                              "/admin/taxi-drivers")
                except Exception:
                    pass
        elif exp <= warn_horizon and ins.get("expiry_warned_for") != ins.get("policy_expires_at"):
            dias = max(1, (exp - today).days)
            try:
                await create_notification(u["id"], "deliverer", "taxi_insurance_expiring",
                                          "Seguro APP MBM vencendo ⚠️",
                                          f"Sua apólice vence em {dias} dia(s) ({ins.get('policy_expires_at')}). Renove com a corretora e reenvie a apólice.",
                                          "/deliverer")
            except Exception:
                pass
            for a in admins:
                try:
                    await create_notification(a["id"], "admin", "taxi_insurance_expiring",
                                              "Apólice de motorista vencendo",
                                              f"A apólice de {u.get('name')} vence em {dias} dia(s) ({ins.get('policy_expires_at')}).",
                                              "/admin/taxi-drivers")
                except Exception:
                    pass
            await db.users.update_one({"id": u["id"]},
                                      {"$set": {"taxi_insurance.expiry_warned_for": ins.get("policy_expires_at")}})


async def _bg_insurance():
    try:
        await _run_insurance_checks()
        log.info("cron insurance-checks: concluído")
    except Exception:
        log.exception("cron insurance-checks failed")


@router.post("/insurance-checks")
async def cron_insurance_checks(background_tasks: BackgroundTasks, authorization: str = Header(None)):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _authorize(authorization)
    background_tasks.add_task(_bg_insurance)
    return {"ok": True, "queued": True}


# ==================== EMPRESÁRIO — renovação mensal (R$ 89,90) ====================
def _merchant_renew_email(name, fantasy, dias, due_str):
    link = f"{FRONTEND_URL}/merchant/activate"
    return (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;'
        'font-family:Arial,sans-serif;color:#0b1220">'
        '<h2 style="margin:0 0 8px">Sua assinatura OFF360 está vencendo</h2>'
        f'<p>Olá, {name or "empresário"}!</p>'
        f'<p>A mensalidade de <strong>R$ 89,90</strong> do estabelecimento <strong>{fantasy or ""}</strong> '
        f'vence em <strong>{dias} dia(s)</strong> ({due_str}). Para manter todas as funcionalidades ativas, '
        'renove o pagamento dentro do painel.</p>'
        f'<p><a href="{link}" style="display:inline-block;background:#FF7A00;color:#fff;'
        'text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">Renovar agora</a></p>'
        '<p style="font-size:12px;color:#888">Enviado por OFF360. Nunca pedimos sua senha ou dados de cartão por e-mail.</p>'
        '</td></tr></table>'
    )


async def _run_merchant_subscription_checks():
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=3)
    cursor = db.establishments.find({"payment_required": {"$ne": True},
                                     "subscription_status": "active",
                                     "mp_last_payment_id": {"$nin": [None, ""]},
                                     "next_due": {"$nin": [None, ""]}})
    async for e in cursor:
        try:
            due = datetime.fromisoformat(e["next_due"])
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        owner = await db.users.find_one({"id": e.get("owner_id")}) or {}
        grace_end = due + timedelta(days=2)
        # 1a) Passou da carência (venceu há > 2 dias) → reabre o muro de pagamento (bloqueia)
        if now > grace_end:
            await db.establishments.update_one({"id": e["id"]}, {"$set": {
                "payment_required": True, "subscription_status": "expired",
            }})
            try:
                await create_notification(e.get("owner_id"), "merchant", "establishment_status",
                                          "Assinatura bloqueada ❌",
                                          f"A mensalidade de {e.get('fantasy_name')} venceu e o período de tolerância acabou. Renove R$ 89,90/mês para reativar todas as funcionalidades.",
                                          "/merchant/activate")
            except Exception:
                pass
            continue
        # 1b) Vencido mas dentro da carência (2 dias) → NÃO bloqueia, apenas avisa
        if due < now:
            dias_tol = max(1, math.ceil((grace_end - now).total_seconds() / 86400))
            try:
                await create_notification(e.get("owner_id"), "merchant", "merchant_sub_grace",
                                          "Pagamento atrasado ⚠️",
                                          f"A mensalidade de {e.get('fantasy_name')} venceu. Você tem {dias_tol} dia(s) de tolerância antes do bloqueio. Renove para manter tudo ativo.",
                                          "/merchant/activate")
            except Exception:
                pass
            continue
        # 2) Lembrete 3 dias antes (idempotente por vencimento)
        if due <= horizon and e.get("renewal_reminder_sent_for") != e.get("next_due"):
            dias = max(1, math.ceil((due - now).total_seconds() / 86400))
            due_str = due.astimezone(timezone(timedelta(hours=-3))).strftime("%d/%m/%Y")
            try:
                await create_notification(e.get("owner_id"), "merchant", "merchant_sub_reminder",
                                          "Mensalidade OFF360 vencendo",
                                          f"A mensalidade de {e.get('fantasy_name')} (R$ 89,90) vence em {dias} dia(s). Renove para não bloquear o painel.",
                                          "/merchant/activate")
            except Exception:
                pass
            if owner.get("email"):
                try:
                    await send_email(to=owner["email"], subject="Sua assinatura OFF360 está vencendo",
                                     html=_merchant_renew_email(owner.get("name"), e.get("fantasy_name"), dias, due_str))
                except Exception:
                    pass
            await db.establishments.update_one({"id": e["id"]},
                                               {"$set": {"renewal_reminder_sent_for": e.get("next_due")}})


def _admin_digest_html(day_str, acts, rens, fails):
    def items(lst):
        if not lst:
            return '<li style="color:#888">—</li>'
        return "".join(f'<li>{escape(i.get("fantasy_name") or "—")} · {"Pix" if i.get("method") == "pix" else "Cartão"}</li>' for i in lst)
    return (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0b1220">'
        f'<h2 style="margin:0 0 4px">OFF360 · Resumo diário de assinaturas</h2>'
        f'<p style="margin:0 0 16px;color:#667">{day_str} · últimas 24 horas</p>'
        '<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;margin-bottom:16px">'
        f'<tr><td style="padding:8px 0">✅ Ativações</td><td style="padding:8px 0;text-align:right;font-weight:bold">{len(acts)}</td></tr>'
        f'<tr><td style="padding:8px 0">🔁 Renovações</td><td style="padding:8px 0;text-align:right;font-weight:bold">{len(rens)}</td></tr>'
        f'<tr><td style="padding:8px 0">❌ Falhas de cobrança</td><td style="padding:8px 0;text-align:right;font-weight:bold">{len(fails)}</td></tr>'
        '</table>'
        f'<p style="margin:0 0 4px;font-weight:bold">Ativações</p><ul style="margin:0 0 12px;padding-left:18px;font-size:13px">{items(acts)}</ul>'
        f'<p style="margin:0 0 4px;font-weight:bold">Renovações</p><ul style="margin:0 0 12px;padding-left:18px;font-size:13px">{items(rens)}</ul>'
        f'<p style="margin:0 0 4px;font-weight:bold;color:#c0392b">Falhas de cobrança</p><ul style="margin:0 0 12px;padding-left:18px;font-size:13px">{items(fails)}</ul>'
        '<p style="font-size:12px;color:#888">Enviado automaticamente pelo OFF360.</p>'
        '</td></tr></table>'
    )


async def _send_admin_billing_digest():
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=24)).isoformat()
    events = await db.merchant_billing_events.find({"at": {"$gte": since}}).to_list(5000)
    if not events:
        return
    acts = [e for e in events if e.get("kind") == "activation"]
    rens = [e for e in events if e.get("kind") == "renewal"]
    fails = [e for e in events if e.get("kind") == "failure"]
    day_str = now.astimezone(timezone(timedelta(hours=-3))).strftime("%d/%m/%Y")
    html = _admin_digest_html(day_str, acts, rens, fails)
    admins = await db.users.find({"role": "admin"}).to_list(50)
    for a in admins:
        if a.get("email"):
            try:
                await send_email(to=a["email"], subject=f"OFF360 · Resumo diário de assinaturas ({day_str})", html=html)
            except Exception:
                pass
        try:
            await create_notification(a["id"], "admin", "merchant_billing_digest",
                                      "Resumo diário de assinaturas",
                                      f"Últimas 24h: {len(acts)} ativação(ões), {len(rens)} renovação(ões), {len(fails)} falha(s) de cobrança.",
                                      "/admin/activations")
        except Exception:
            pass


async def _bg_merchant_subs():
    try:
        await _run_merchant_subscription_checks()
        await _send_admin_billing_digest()
        log.info("cron merchant-subscription-checks: concluído")
    except Exception:
        log.exception("cron merchant-subscription-checks failed")


@router.post("/merchant-subscription-checks")
async def cron_merchant_subs(background_tasks: BackgroundTasks, authorization: str = Header(None)):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _authorize(authorization)
    background_tasks.add_task(_bg_merchant_subs)
    return {"ok": True, "queued": True}
