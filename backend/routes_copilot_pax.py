"""Copiloto 360 do PASSAGEIRO (Fase 2) — IA texto+voz (GPT-5.4 + OpenAI STT/TTS).

Foco: chamar corrida por voz (function-calling) com preenchimento da tela + toque final
de confirmação (a IA NUNCA cria a corrida — devolve um 'ride_draft' que o app confirma),
notificações por voz e busca de locais no OFF360 (guia comercial, sem fazer pedidos).
Segurança/RBAC: só dados do próprio passageiro; nada de dados de motoristas/pagamentos
de terceiros/documentos/internos (sem ferramenta que exponha isso).
"""
import io
import json
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from pydantic import BaseModel

from core import db, require_role, new_id, now_iso
import geo
from routes_taxi import taxi_settings, category_prices, CATEGORIES, CATEGORY_LABELS, _norm_category
from routes_copilot import (EMERGENT_LLM_KEY, MODEL, VOICE_MAP,
                            _usage, _usage_state, _inc_usage)

router = APIRouter(prefix="/api/passenger/copilot", tags=["copilot-pax"])
consumer_only = require_role("consumer")
log = logging.getLogger("off360")


def _dist(a_lat, a_lng, b_lat, b_lng):
    try:
        return round(geo.haversine_km(a_lat, a_lng, b_lat, b_lng), 1)
    except Exception:
        return None


def _geocode_address(addr):
    """Resolve lat/lng a partir do endereço (Google) para backfill dos parceiros."""
    try:
        preds = geo.geocode(addr or "")
        for p in preds[:1]:
            det = geo.place_details(p.get("place_id")) if p.get("place_id") else None
            if det and det.get("lat") is not None:
                return (det["lat"], det["lng"])
    except Exception:
        pass
    return None


# ---------------- ferramentas ----------------
TOOLS = [
    {"type": "function", "function": {"name": "search_destination",
        "description": "Interpreta e geocodifica um destino falado pelo passageiro (ex.: 'Shopping Dom Pedro'). Retorna o endereço exato e coordenadas para confirmação. Sempre confirme o endereço com o usuário antes de cotar.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "quote_ride",
        "description": "Cota a corrida da localização atual do passageiro até o destino (lat/lng). Retorna os valores exatos por categoria (Basic/Select/Premium) e a distância/tempo.",
        "parameters": {"type": "object", "properties": {"dest_lat": {"type": "number"}, "dest_lng": {"type": "number"}, "dest_address": {"type": "string"}}, "required": ["dest_lat", "dest_lng"]}}},
    {"type": "function", "function": {"name": "prepare_ride",
        "description": "Prepara a corrida e PREENCHE a tela do app com origem, destino, categoria e valor. NÃO cria a corrida — o passageiro precisa dar o toque final de confirmação na tela. Use após o usuário confirmar destino e categoria.",
        "parameters": {"type": "object", "properties": {"dest_lat": {"type": "number"}, "dest_lng": {"type": "number"}, "dest_address": {"type": "string"}, "category": {"type": "string", "enum": ["basic", "select", "premium"]}}, "required": ["dest_lat", "dest_lng", "dest_address"]}}},
    {"type": "function", "function": {"name": "search_places",
        "description": "Busca estabelecimentos parceiros do OFF360 perto do passageiro (restaurantes, farmácias, etc.) por nome/categoria. Retorna cards com nome, endereço, nota e link. NÃO faz pedidos — apenas indica e direciona para a página do local.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "confirm_ride",
        "description": "Aciona o TOQUE FINAL de confirmação e cria a corrida que já foi preparada na tela. Use SOMENTE depois de prepare_ride ter preenchido a tela E o passageiro confirmar explicitamente por voz/texto (ex.: 'confirmar', 'pode chamar', 'sim, chamar'). Nunca use sem um prepare_ride anterior na conversa.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "save_feedback",
        "description": "Registra uma sugestão, reclamação ou relato do passageiro para análise administrativa. category: 'sugestao' | 'problema' | 'outro'.",
        "parameters": {"type": "object", "properties": {"category": {"type": "string"}, "message": {"type": "string"}}, "required": ["message"]}}},
]


async def _dispatch(fn, args, uid, ctx, sink):
    args = args or {}
    origin = None
    if ctx and ctx.get("lat") is not None and ctx.get("lng") is not None:
        origin = {"lat": ctx["lat"], "lng": ctx["lng"], "address": ctx.get("address") or "Minha localização"}

    if fn == "search_destination":
        preds = geo.geocode(args.get("query") or "", lat=(ctx or {}).get("lat"), lng=(ctx or {}).get("lng"))
        results = []
        for p in preds[:3]:
            det = geo.place_details(p.get("place_id")) if p.get("place_id") else None
            if det and det.get("lat") is not None:
                results.append({"address": det["address"], "lat": det["lat"], "lng": det["lng"]})
        if not results:
            return {"error": "não encontrei esse endereço, pode repetir com mais detalhes?"}, None
        return {"results": results}, None

    if fn == "quote_ride":
        if not origin:
            return {"error": "não sei sua localização atual. Ative o GPS na tela."}, None
        dest = {"lat": args.get("dest_lat"), "lng": args.get("dest_lng"), "address": args.get("dest_address") or ""}
        cfg = await taxi_settings()
        trip = geo.route(origin, dest)
        cats = category_prices(cfg, trip["distance_km"], trip["duration_min"])
        return {"trip": {"distance_km": trip["distance_km"], "duration_min": trip["duration_min"]}, "categories": cats}, None

    if fn == "prepare_ride":
        if not origin:
            return {"error": "não sei sua localização atual. Ative o GPS na tela."}, None
        category = _norm_category(args.get("category") or "basic")
        dest = {"lat": args.get("dest_lat"), "lng": args.get("dest_lng"), "address": args.get("dest_address") or ""}
        cfg = await taxi_settings()
        trip = geo.route(origin, dest)
        cats = category_prices(cfg, trip["distance_km"], trip["duration_min"])
        price = next((c["price"] for c in cats if c["id"] == category), cats[0]["price"])
        draft = {"origin": origin, "destination": dest, "category": category,
                 "category_label": CATEGORY_LABELS[category], "price": price, "categories": cats,
                 "distance_km": trip["distance_km"], "duration_min": trip["duration_min"]}
        sink["ride_draft"] = draft
        return {"ok": True, "prepared": True, "category": CATEGORY_LABELS[category], "price": price,
                "note": "Preenchido na tela. O passageiro deve tocar em Chamar para confirmar."}, f"Corrida preenchida: {dest['address']} · {CATEGORY_LABELS[category]} · R$ {price:.2f}"

    if fn == "search_places":
        q = (args.get("query") or "").strip()
        query = {"approval_status": "approved", "subscription_status": "active", "discount_configured": True}
        if q:
            query["$or"] = [{"fantasy_name": {"$regex": q, "$options": "i"}},
                            {"category_name": {"$regex": q, "$options": "i"}},
                            {"description": {"$regex": q, "$options": "i"}}]
        ests = await db.establishments.find(query).to_list(100)
        items = []
        for e in ests:
            # Backfill de coordenadas: se o parceiro não tem lat/lng, geocodifica pelo endereço e persiste.
            if e.get("lat") is None and e.get("address"):
                coords = _geocode_address(e.get("address"))
                if coords:
                    e["lat"], e["lng"] = coords[0], coords[1]
                    await db.establishments.update_one({"id": e["id"]}, {"$set": {"lat": coords[0], "lng": coords[1]}})
            d = _dist(origin["lat"], origin["lng"], e.get("lat"), e.get("lng")) if (origin and e.get("lat") is not None) else None
            rc = e.get("rating_count") or 0
            items.append({"id": e["id"], "name": e.get("fantasy_name"), "category": e.get("category_name"),
                          "neighborhood": e.get("neighborhood"), "address": e.get("address"),
                          "rating": round(e.get("rating_sum", 0) / rc, 1) if rc else None,
                          "discount_percent": e.get("discount_percent"),
                          "distance_km": d, "link": f"/establishment/{e['id']}"})
        items.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] if x["distance_km"] is not None else 9e9,
                                  -(x["rating"] or 0)))
        top = items[:5]
        sink["places"] = top
        return {"places": [{"name": p["name"], "category": p["category"], "rating": p["rating"],
                            "distance_km": p["distance_km"], "discount_percent": p["discount_percent"]} for p in top]}, None

    if fn == "confirm_ride":
        sink["confirm_ride"] = True
        return {"ok": True, "confirmed": True, "note": "Toque final acionado — criando a corrida na tela."}, "Corrida confirmada por voz"

    if fn == "save_feedback":
        msg = (args.get("message") or "").strip()
        if not msg:
            return {"error": "mensagem vazia"}, None
        cat = (args.get("category") or "outro").strip().lower()
        if cat not in ("sugestao", "problema", "outro"):
            cat = "outro"
        await db.pax_feedbacks.insert_one({"id": new_id(), "consumer_id": uid, "category": cat,
                                           "message": msg[:2000], "context": "copilot_pax", "reviewed": False, "created_at": now_iso()})
        return {"ok": True, "category": cat}, "Feedback registrado"

    return {"error": "ferramenta desconhecida"}, None


SYSTEM_BASE = (
    "Você é o Copiloto 360 do passageiro no 360Taxi/OFF360, em português do Brasil. Fala breve e clara (ideal para ouvir).\n"
    "FLUXO DE CORRIDA POR VOZ:\n"
    "1) Ao receber um destino falado, use search_destination, confirme o ENDEREÇO EXATO com o usuário (leia o endereço encontrado e pergunte se é esse).\n"
    "2) Após confirmar o endereço, use quote_ride e apresente os valores por categoria (Basic/Select/Premium).\n"
    "3) Quando o usuário escolher a categoria, use prepare_ride — isso PREENCHE a tela. Avise que ele precisa TOCAR em 'Chamar' para confirmar. Você NUNCA cria a corrida sozinho.\n"
    "GUIA COMERCIAL (OFF360): use search_places para indicar lugares perto (nome, nota, distância) e diga que o usuário pode abrir a página do local; você NÃO faz pedidos de comida/produtos.\n"
    "PRIVACIDADE/SEGURANÇA: nunca forneça dados de motoristas, pagamentos de terceiros, documentos ou informações internas. Se pedirem, responda exatamente: 'Não tenho autorização para fornecer essa informação.'\n"
    "CONFIRMAÇÃO POR VOZ: depois de prepare_ride, se o passageiro disser explicitamente que confirma (ex.: 'confirmar', 'pode chamar', 'sim, chamar'), use confirm_ride para acionar o toque final e criar a corrida. Nunca use confirm_ride sem um prepare_ride antes.\n"
    "FEEDBACK: se o passageiro quiser deixar uma sugestão/reclamação, use save_feedback.\n"
    "Nunca invente endereços ou valores — use sempre as ferramentas."
)


class ChatInput(BaseModel):
    session_id: str
    message: str
    context: Optional[dict] = None


class SettingsInput(BaseModel):
    ai_name: Optional[str] = None
    voice: Optional[str] = None
    voice_enabled: Optional[bool] = None


class TTSInput(BaseModel):
    text: str
    voice: Optional[str] = None


# ==================== SETTINGS ====================
@router.get("/settings")
async def get_settings(user=Depends(consumer_only)):
    s = await db.copilot_settings.find_one({"user_id": user["id"]}) or {}
    return {"ai_name": s.get("ai_name") or "Copiloto 360", "voice": s.get("voice") or "female",
            "voice_enabled": s.get("voice_enabled", True), "usage": await _usage_state(user["id"])}


@router.put("/settings")
async def put_settings(payload: SettingsInput, user=Depends(consumer_only)):
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


# ==================== CHAT ====================
@router.post("/chat")
async def chat(payload: ChatInput, user=Depends(consumer_only)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Copiloto 360 não configurado (chave ausente).")
    usage = await _usage_state(user["id"])
    if usage["blocked"]:
        return {"reply": "Você atingiu o limite de uso da IA por hoje. Ele renova amanhã.",
                "actions": [], "session_id": payload.session_id, "limited": True, "usage": usage}

    from emergentintegrations.llm.chat import LlmChat, UserMessage
    recent = await db.copilot_pax_messages.find({"session_id": payload.session_id, "consumer_id": user["id"]}).sort("created_at", -1).to_list(8)
    recent = list(reversed(recent))
    transcript = "\n".join(f"{m.get('role')}: {m.get('content')}" for m in recent)
    ctx = payload.context or {}
    ctx_txt = f"\n\n=== CONTEXTO ===\nLocalização atual do passageiro: {ctx.get('address') or 'desconhecida'} (lat={ctx.get('lat')}, lng={ctx.get('lng')})"
    system = SYSTEM_BASE + ctx_txt + (("\n\n=== CONVERSA RECENTE ===\n" + transcript) if transcript else "")

    chat_obj = (LlmChat(api_key=EMERGENT_LLM_KEY, session_id=payload.session_id, system_message=system)
                .with_model(*MODEL).with_tools(TOOLS, tool_choice="auto"))
    actions: List[str] = []
    sink: dict = {}
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
                result, label = await _dispatch(tc.name, args, user["id"], ctx, sink)
                if label:
                    actions.append(label)
                chat_obj.add_tool_result(tc.id, json.dumps(result, ensure_ascii=False, default=str))
            response = await chat_obj.send_message_with_tools()
        reply = (getattr(response, "content", None) or "").strip() or "Pronto!"
    except Exception:
        log.exception("Copilot PAX chat error")
        raise HTTPException(status_code=502, detail="O Copiloto 360 não conseguiu responder agora. Tente novamente.")

    ts = now_iso()
    await db.copilot_pax_messages.insert_one({"id": new_id(), "session_id": payload.session_id, "consumer_id": user["id"], "role": "user", "content": payload.message or "", "created_at": ts})
    await db.copilot_pax_messages.insert_one({"id": new_id(), "session_id": payload.session_id, "consumer_id": user["id"], "role": "assistant", "content": reply, "created_at": now_iso()})
    await _inc_usage(user["id"])
    return {"reply": reply, "actions": actions, "session_id": payload.session_id,
            "ride_draft": sink.get("ride_draft"), "places": sink.get("places"),
            "confirm_ride": bool(sink.get("confirm_ride")),
            "usage": await _usage_state(user["id"])}


@router.get("/history")
async def history(session_id: str, user=Depends(consumer_only)):
    msgs = await db.copilot_pax_messages.find({"session_id": session_id, "consumer_id": user["id"]}).sort("created_at", 1).to_list(200)
    return [{"role": m.get("role"), "content": m.get("content"), "created_at": m.get("created_at")} for m in msgs]


# ==================== VOZ ====================
@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...), user=Depends(consumer_only)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Voz não configurada (chave ausente).")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Áudio vazio")
    from emergentintegrations.llm.openai import OpenAISpeechToText
    bio = io.BytesIO(data); bio.name = file.filename or "audio.webm"
    try:
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        res = await stt.transcribe(file=bio, model="whisper-1", response_format="json", language="pt")
        text = getattr(res, "text", None) or (res.get("text") if isinstance(res, dict) else "") or ""
    except Exception:
        log.exception("Copilot PAX transcribe error")
        raise HTTPException(status_code=502, detail="Não consegui entender o áudio. Tente novamente.")
    return {"text": text.strip()}


@router.post("/tts")
async def tts(payload: TTSInput, user=Depends(consumer_only)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Voz não configurada (chave ausente).")
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texto vazio")
    s = await db.copilot_settings.find_one({"user_id": user["id"]}) or {}
    vkey = payload.voice or s.get("voice") or "female"
    voice = VOICE_MAP.get(vkey, "nova")
    from emergentintegrations.llm.openai import OpenAITextToSpeech
    try:
        engine = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
        audio = await engine.generate_speech(text=text[:4000], model="tts-1", voice=voice, response_format="mp3", speed=0.9)
    except Exception:
        log.exception("Copilot PAX tts error")
        raise HTTPException(status_code=502, detail="Não consegui gerar o áudio agora.")
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
