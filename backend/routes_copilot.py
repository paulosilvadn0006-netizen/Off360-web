"""Copiloto 360 — assistente de voz/texto do MOTORISTA (360Taxi), GPT-5.4.

Arquitetura de segurança (BANCO -> CAMADA DE PERMISSÃO -> DADOS AUTORIZADOS -> IA):
a IA nunca acessa o banco diretamente. Só chama as ferramentas abaixo, executadas
pelo backend SEMPRE no escopo do próprio motorista logado (RBAC). Faturamento/taxas
vêm diretamente do banco (zero alucinação). Dados bancários, documentos, e dados de
outros motoristas/passageiros/executivos são bloqueados por design (sem ferramenta).
"""
import io
import os
import json
import math
import logging
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from pydantic import BaseModel
from dotenv import load_dotenv

from core import db, require_role, new_id, now_iso

load_dotenv()

router = APIRouter(prefix="/api/driver/copilot", tags=["copilot"])
driver_only = require_role("deliverer")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
MODEL = ("openai", "gpt-5.4")
DAILY_LIMIT = int(os.environ.get("COPILOT_DAILY_LIMIT", "30"))
MONTHLY_LIMIT = int(os.environ.get("COPILOT_MONTHLY_LIMIT", "300"))
VOICE_MAP = {"male": "onyx", "female": "nova"}
SP_TZ = timezone(timedelta(hours=-3))
log = logging.getLogger("off360")


# ---------------- helpers de data ----------------
def _sp_day_range(date: Optional[str]):
    if date:
        try:
            d = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Data inválida")
        day = datetime(d.year, d.month, d.day, tzinfo=SP_TZ)
    else:
        day = datetime.now(SP_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    start = day.astimezone(timezone.utc)
    return day, start, start + timedelta(days=1)


def _parse_dt(iso):
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _ride_value(r):
    return float(r.get("final_price") or r.get("agreed_price") or r.get("current_price") or 0)


# ---------------- métricas do motorista (RBAC: só o próprio) ----------------
async def _driver_metrics(uid, date: Optional[str] = None):
    day, start, end = _sp_day_range(date)
    rides = await db.taxi_rides.find({
        "driver_id": uid,
        "status": {"$in": ["completed", "interrupted"]},
        "completed_at": {"$gte": start.isoformat(), "$lt": end.isoformat()},
    }).to_list(2000)
    completed = [r for r in rides if r.get("status") == "completed"]
    interrupted = [r for r in rides if r.get("status") == "interrupted"]
    count = len(completed)
    revenue = round(sum(_ride_value(r) for r in completed), 2)
    dist = round(sum(float(r.get("trip_distance_km") or 0) for r in completed), 2)
    dur = round(sum(float(r.get("trip_duration_min") or 0) for r in completed), 1)
    avg_ride = round(revenue / count, 2) if count else 0.0
    avg_km = round(revenue / dist, 2) if dist else 0.0
    times = sorted([_parse_dt(r.get("completed_at")) for r in completed if _parse_dt(r.get("completed_at"))])
    active_hours = 0.0
    if len(times) >= 2:
        active_hours = round((times[-1] - times[0]).total_seconds() / 3600, 2)
    avg_hour = round(revenue / active_hours, 2) if active_hours >= 0.1 else 0.0
    hour_counter = Counter()
    for r in completed:
        dt = _parse_dt(r.get("completed_at"))
        if dt:
            hour_counter[dt.astimezone(SP_TZ).hour] += 1
    best_hour = None
    if hour_counter:
        h, n = hour_counter.most_common(1)[0]
        best_hour = {"hour": h, "label": f"{h:02d}h–{(h+1)%24:02d}h", "rides": n}
    total_ended = count + len(interrupted)
    cancel_rate = round(len(interrupted) / total_ended * 100, 1) if total_ended else 0.0
    return {
        "date": day.strftime("%Y-%m-%d"),
        "rides": count, "revenue": revenue,
        "distance_km": dist, "duration_min": dur,
        "avg_per_ride": avg_ride, "avg_per_km": avg_km, "avg_per_hour": avg_hour,
        "active_hours": active_hours, "best_hour": best_hour,
        "interrupted": len(interrupted), "cancellation_rate": cancel_rate,
    }


async def _goal_progress(uid, date: Optional[str] = None):
    day, _, _ = _sp_day_range(date)
    ds = day.strftime("%Y-%m-%d")
    g = await db.driver_goals.find_one({"driver_id": uid, "date": ds})
    m = await _driver_metrics(uid, ds)
    goal = float(g.get("amount")) if g else 0.0
    realized = m["revenue"]
    remaining = round(max(0.0, goal - realized), 2)
    pct = round(realized / goal * 100, 1) if goal > 0 else 0.0
    # estimativa de corridas restantes com base na média atual (ou média geral se ainda não rodou hoje)
    avg = m["avg_per_ride"]
    if avg <= 0:
        allc = await db.taxi_rides.find({"driver_id": uid, "status": "completed"}).to_list(2000)
        tot = sum(_ride_value(r) for r in allc)
        avg = round(tot / len(allc), 2) if allc else 0.0
    rides_left = math.ceil(remaining / avg) if (remaining > 0 and avg > 0) else 0
    return {"date": ds, "goal": round(goal, 2), "realized": realized, "remaining": remaining,
            "pct": pct, "avg_per_ride": avg, "rides_left_estimate": rides_left, "reached": goal > 0 and remaining <= 0}


async def _demand_analysis():
    """Análise agregada (não-privada) de demanda: melhores horários e áreas de embarque
    com base no volume de SOLICITAÇÕES dos últimos 14 dias. Estimativa, nunca garantia."""
    since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    rides = await db.taxi_rides.find({"created_at": {"$gte": since}}).to_list(5000)
    hour_c, area_c = Counter(), Counter()
    for r in rides:
        dt = _parse_dt(r.get("created_at"))
        if dt:
            hour_c[dt.astimezone(SP_TZ).hour] += 1
        addr = ((r.get("origin") or {}).get("address") or "").split(",")[0].strip()
        if addr:
            area_c[addr] += 1
    top_hours = [{"hour": h, "label": f"{h:02d}h–{(h+1)%24:02d}h", "requests": n} for h, n in hour_c.most_common(3)]
    top_areas = [{"area": a, "requests": n} for a, n in area_c.most_common(3)]
    return {"sample_days": 14, "total_requests": len(rides), "top_hours": top_hours, "top_areas": top_areas}


# ---------------- limite de uso (controle de custo) ----------------
async def _usage(uid):
    day = datetime.now(SP_TZ).strftime("%Y-%m-%d")
    month = datetime.now(SP_TZ).strftime("%Y-%m")
    u = await db.copilot_usage.find_one({"user_id": uid})
    if not u:
        u = {"user_id": uid, "day": day, "day_count": 0, "month": month, "month_count": 0}
    if u.get("day") != day:
        u["day"], u["day_count"] = day, 0
    if u.get("month") != month:
        u["month"], u["month_count"] = month, 0
    return u


async def _usage_state(uid):
    u = await _usage(uid)
    return {"day_count": u["day_count"], "day_limit": DAILY_LIMIT,
            "month_count": u["month_count"], "month_limit": MONTHLY_LIMIT,
            "blocked": u["day_count"] >= DAILY_LIMIT or u["month_count"] >= MONTHLY_LIMIT}


async def _inc_usage(uid):
    u = await _usage(uid)
    u["day_count"] += 1
    u["month_count"] += 1
    await db.copilot_usage.update_one({"user_id": uid}, {"$set": u}, upsert=True)


# ---------------- ferramentas expostas à IA ----------------
TOOLS = [
    {"type": "function", "function": {"name": "get_today_metrics",
        "description": "Retorna as métricas do motorista para um dia: total de corridas, faturamento, horas ativas, média por corrida/hora/km, distância, taxa de cancelamento e melhor horário. date opcional (YYYY-MM-DD), padrão hoje.",
        "parameters": {"type": "object", "properties": {"date": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "get_goal_progress",
        "description": "Retorna o progresso da meta diária: meta, realizado, faltante, % atingida, média por corrida e estimativa de quantas corridas faltam.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "set_daily_goal",
        "description": "Define a meta de faturamento do motorista para hoje, em reais (ex.: 400).",
        "parameters": {"type": "object", "properties": {"amount": {"type": "number"}}, "required": ["amount"]}}},
    {"type": "function", "function": {"name": "get_demand_analysis",
        "description": "Retorna análise agregada de demanda (melhores horários e áreas de embarque, por volume de solicitações). É estimativa/tendência, nunca garantia de corridas.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "save_feedback",
        "description": "Registra uma sugestão, reclamação ou relato do motorista para análise administrativa. category: 'sugestao' | 'problema' | 'outro'.",
        "parameters": {"type": "object", "properties": {"category": {"type": "string"}, "message": {"type": "string"}}, "required": ["message"]}}},
]


async def _dispatch(fn, args, uid):
    args = args or {}
    if fn == "get_today_metrics":
        return await _driver_metrics(uid, args.get("date")), None
    if fn == "get_goal_progress":
        return await _goal_progress(uid), None
    if fn == "set_daily_goal":
        amt = round(float(args.get("amount") or 0), 2)
        if amt <= 0:
            return {"error": "informe um valor de meta válido"}, None
        ds = datetime.now(SP_TZ).strftime("%Y-%m-%d")
        await db.driver_goals.update_one({"driver_id": uid, "date": ds},
                                         {"$set": {"driver_id": uid, "date": ds, "amount": amt, "updated_at": now_iso()}}, upsert=True)
        prog = await _goal_progress(uid)
        return {"ok": True, **prog}, f"Meta definida: R$ {amt:.2f}"
    if fn == "get_demand_analysis":
        return await _demand_analysis(), None
    if fn == "save_feedback":
        msg = (args.get("message") or "").strip()
        if not msg:
            return {"error": "mensagem vazia"}, None
        cat = (args.get("category") or "outro").strip().lower()
        if cat not in ("sugestao", "problema", "outro"):
            cat = "outro"
        await db.driver_feedbacks.insert_one({"id": new_id(), "driver_id": uid, "category": cat,
                                              "message": msg[:2000], "context": "copilot", "created_at": now_iso()})
        return {"ok": True, "category": cat}, "Feedback registrado"
    return {"error": "ferramenta desconhecida"}, None


SYSTEM_BASE = (
    "Você é o Copiloto 360, assistente do motorista no 360Taxi, em português do Brasil. "
    "Fala de forma breve, prática, motivadora e clara — respostas curtas, ideais para ouvir dirigindo.\n"
    "REGRAS DE SEGURANÇA E PRIVACIDADE:\n"
    "1) Você só conhece dados DO PRÓPRIO motorista logado, e SEMPRE via as ferramentas. Nunca invente números de faturamento, taxas ou metas — chame a ferramenta e use o valor retornado (zero alucinação).\n"
    "2) NUNCA forneça dados bancários, documentos, chaves, tokens, IDs internos, nem informações de OUTROS motoristas, passageiros ou executivos da plataforma. Se pedirem isso, responda exatamente: 'Não tenho autorização para fornecer essa informação.'\n"
    "3) Para metas: use set_daily_goal quando o motorista definir uma meta; para acompanhar, use get_goal_progress e explique de forma transparente (realizado, faltante, % e estimativa de corridas restantes com base na média).\n"
    "4) Para demanda: use get_demand_analysis. Deixe claro que é ESTIMATIVA/tendência e NUNCA garanta corridas.\n"
    "5) Para relatos/sugestões: use save_feedback.\n"
    "6) Formate valores em reais (R$) e horários de forma amigável. Ao final, sugira o próximo passo prático."
)


class ChatInput(BaseModel):
    session_id: str
    message: str


class GoalInput(BaseModel):
    amount: float


class FeedbackInput(BaseModel):
    category: Optional[str] = "outro"
    message: str


class SettingsInput(BaseModel):
    ai_name: Optional[str] = None
    voice: Optional[str] = None          # "male" | "female"
    voice_enabled: Optional[bool] = None


class TTSInput(BaseModel):
    text: str
    voice: Optional[str] = None          # "male" | "female"


# ==================== SETTINGS / MÉTRICAS DIRETAS (UI) ====================
@router.get("/settings")
async def get_settings(user=Depends(driver_only)):
    s = await db.copilot_settings.find_one({"user_id": user["id"]}) or {}
    return {"ai_name": s.get("ai_name") or "Copiloto 360",
            "voice": s.get("voice") or "male",
            "voice_enabled": s.get("voice_enabled", True),
            "usage": await _usage_state(user["id"])}


@router.put("/settings")
async def put_settings(payload: SettingsInput, user=Depends(driver_only)):
    upd = {}
    if payload.ai_name is not None:
        upd["ai_name"] = payload.ai_name.strip()[:40] or "Copiloto 360"
    if payload.voice in ("male", "female"):
        upd["voice"] = payload.voice
    if payload.voice_enabled is not None:
        upd["voice_enabled"] = bool(payload.voice_enabled)
    if upd:
        await db.copilot_settings.update_one({"user_id": user["id"]}, {"$set": {"user_id": user["id"], **upd}}, upsert=True)
    return {"ok": True, **upd}


@router.get("/metrics")
async def metrics(date: Optional[str] = None, user=Depends(driver_only)):
    return await _driver_metrics(user["id"], date)


@router.get("/goal")
async def goal(user=Depends(driver_only)):
    return await _goal_progress(user["id"])


@router.post("/goal")
async def set_goal(payload: GoalInput, user=Depends(driver_only)):
    r, _ = await _dispatch("set_daily_goal", {"amount": payload.amount}, user["id"])
    if r.get("error"):
        raise HTTPException(status_code=400, detail=r["error"])
    return r


@router.post("/feedback")
async def feedback(payload: FeedbackInput, user=Depends(driver_only)):
    r, _ = await _dispatch("save_feedback", {"category": payload.category, "message": payload.message}, user["id"])
    if r.get("error"):
        raise HTTPException(status_code=400, detail=r["error"])
    return r


# ==================== CHAT (texto ou transcrição) ====================
@router.post("/chat")
async def chat(payload: ChatInput, user=Depends(driver_only)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Copiloto 360 não configurado (chave ausente).")
    usage = await _usage_state(user["id"])
    if usage["blocked"]:
        return {"reply": "Você atingiu o limite de uso da IA por hoje. Ele é renovado amanhã. Se precisar de mais, fale com o suporte para ampliar seu limite.",
                "actions": [], "session_id": payload.session_id, "limited": True, "usage": usage}

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    recent = await db.copilot_messages.find({"session_id": payload.session_id, "driver_id": user["id"]}).sort("created_at", -1).to_list(8)
    recent = list(reversed(recent))
    transcript = "\n".join(f"{m.get('role')}: {m.get('content')}" for m in recent)
    system = SYSTEM_BASE + (("\n\n=== CONVERSA RECENTE ===\n" + transcript) if transcript else "")

    chat_obj = (LlmChat(api_key=EMERGENT_LLM_KEY, session_id=payload.session_id, system_message=system)
                .with_model(*MODEL).with_tools(TOOLS, tool_choice="auto"))
    actions: List[str] = []
    try:
        response = await chat_obj.send_message_with_tools(UserMessage(text=payload.message or ""))
        guard = 0
        while getattr(response, "tool_calls", None) and guard < 10:
            guard += 1
            for tc in response.tool_calls:
                try:
                    args = tc.arguments if isinstance(tc.arguments, dict) else json.loads(tc.arguments or "{}")
                except Exception:
                    args = {}
                result, label = await _dispatch(tc.name, args, user["id"])
                if label:
                    actions.append(label)
                chat_obj.add_tool_result(tc.id, json.dumps(result, ensure_ascii=False, default=str))
            response = await chat_obj.send_message_with_tools()
        reply = (getattr(response, "content", None) or "").strip() or "Pronto!"
    except Exception:
        log.exception("Copilot chat error")
        raise HTTPException(status_code=502, detail="O Copiloto 360 não conseguiu responder agora. Tente novamente em instantes.")

    ts = now_iso()
    await db.copilot_messages.insert_one({"id": new_id(), "session_id": payload.session_id, "driver_id": user["id"],
                                          "role": "user", "content": payload.message or "", "created_at": ts})
    await db.copilot_messages.insert_one({"id": new_id(), "session_id": payload.session_id, "driver_id": user["id"],
                                          "role": "assistant", "content": reply, "actions": actions, "created_at": now_iso()})
    await _inc_usage(user["id"])
    return {"reply": reply, "actions": actions, "session_id": payload.session_id, "usage": await _usage_state(user["id"])}


@router.get("/history")
async def history(session_id: str, user=Depends(driver_only)):
    msgs = await db.copilot_messages.find({"session_id": session_id, "driver_id": user["id"]}).sort("created_at", 1).to_list(200)
    return [{"role": m.get("role"), "content": m.get("content"), "actions": m.get("actions") or [], "created_at": m.get("created_at")} for m in msgs]


# ==================== VOZ: STT (Whisper) e TTS ====================
@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...), user=Depends(driver_only)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Voz não configurada (chave ausente).")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Áudio vazio")
    from emergentintegrations.llm.openai import OpenAISpeechToText
    bio = io.BytesIO(data)
    bio.name = file.filename or "audio.webm"
    try:
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        res = await stt.transcribe(file=bio, model="whisper-1", response_format="json", language="pt")
        text = getattr(res, "text", None) or (res.get("text") if isinstance(res, dict) else "") or ""
    except Exception:
        log.exception("Copilot transcribe error")
        raise HTTPException(status_code=502, detail="Não consegui entender o áudio. Tente novamente.")
    return {"text": text.strip()}


@router.post("/tts")
async def tts(payload: TTSInput, user=Depends(driver_only)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Voz não configurada (chave ausente).")
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texto vazio")
    s = await db.copilot_settings.find_one({"user_id": user["id"]}) or {}
    vkey = payload.voice or s.get("voice") or "male"
    voice = VOICE_MAP.get(vkey, "onyx")
    from emergentintegrations.llm.openai import OpenAITextToSpeech
    try:
        engine = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
        audio = await engine.generate_speech(text=text[:4000], model="tts-1", voice=voice, response_format="mp3")
    except Exception:
        log.exception("Copilot tts error")
        raise HTTPException(status_code=502, detail="Não consegui gerar o áudio agora.")
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
