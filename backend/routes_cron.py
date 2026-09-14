"""Endpoints acionados pelo agendador da plataforma (.emergent/crons.yml).
Autenticados por Bearer WEBHOOK_CRON_SECRET; ack 2xx imediato + trabalho em background."""
import os
import hmac
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Header
from dotenv import load_dotenv

from routes_admin import _run_backfill_coordinates

load_dotenv()

router = APIRouter(prefix="/api/cron", tags=["cron"])
log = logging.getLogger("off360")
SECRET = os.environ.get("WEBHOOK_CRON_SECRET")


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
