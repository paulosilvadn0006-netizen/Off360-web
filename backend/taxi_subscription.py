"""Regras de assinatura do motorista 360Taxi (trial de 30 dias, vencimento, bloqueio).
Isolado do restante do projeto — usado só pelo módulo taxi."""
import math
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException

from core import db

TRIAL_DAYS = 30
CYCLE_DAYS = 30
PLAN_AMOUNT = 99.90  # R$/mês (plano mensal do motorista 360Taxi)


def _now():
    return datetime.now(timezone.utc)


def _parse(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d
    except Exception:
        return None


def trial_fields():
    """Campos do trial gratuito de 30 dias para novo motorista."""
    start = _now()
    return {
        "status_assinatura": "Ativo",
        "data_inicio_ciclo": start.isoformat(),
        "data_vencimento": (start + timedelta(days=TRIAL_DAYS)).isoformat(),
        "assinatura_origem": "trial",
    }


async def ensure_trial(u):
    """Backfill: motoristas sem assinatura recebem o trial (idempotente)."""
    if u and not u.get("status_assinatura"):
        f = trial_fields()
        await db.users.update_one({"id": u["id"]}, {"$set": f})
        u.update(f)
    return u


async def sub_state(u):
    """Retorna o status atual e, se vencido, atualiza para 'Vencido' (lazy)."""
    status = u.get("status_assinatura")
    due = _parse(u.get("data_vencimento"))
    if status == "Ativo" and due and _now() > due:
        await db.users.update_one({"id": u["id"]}, {"$set": {"status_assinatura": "Vencido"}})
        status = "Vencido"
        u["status_assinatura"] = status
    return status


async def apply_approved(driver_id, approved_dt, origem, meta=None):
    """Pagamento aprovado -> Ativo, novo ciclo de 30 dias a partir da aprovação."""
    start = approved_dt or _now()
    upd = {
        "status_assinatura": "Ativo",
        "data_inicio_ciclo": start.isoformat(),
        "data_vencimento": (start + timedelta(days=CYCLE_DAYS)).isoformat(),
        "assinatura_origem": origem,
    }
    if meta:
        upd.update(meta)
    await db.users.update_one({"id": driver_id}, {"$set": upd})
    return upd


def dias_restantes(u):
    due = _parse(u.get("data_vencimento"))
    if not due:
        return 0
    return max(0, math.ceil((due - _now()).total_seconds() / 86400))


async def ensure_can_accept(driver_id):
    """Bloqueia aceitar corridas se a assinatura estiver vencida."""
    u = await db.users.find_one({"id": driver_id})
    if not u:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")
    await ensure_trial(u)
    if await sub_state(u) == "Vencido":
        raise HTTPException(
            status_code=403,
            detail="Assinatura 360Taxi vencida. Renove com cartão para voltar a aceitar corridas.",
        )
