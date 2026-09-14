"""IA 360 — assistente de configuração/manutenção do estabelecimento (GPT-5.4).

Arquitetura de segurança (BANCO -> CAMADA DE PERMISSÃO -> DADOS AUTORIZADOS -> IA):
a IA nunca acessa o banco diretamente. Ela só pode chamar as ferramentas abaixo,
que são executadas pelo backend SEMPRE validando o dono e o estabelecimento.
"""
import io
import os
import json
import base64
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

from core import db, require_role, new_id, now_iso
from storage import get_object

load_dotenv()

router = APIRouter(prefix="/api/merchant/ai360", tags=["ai360"])
merchant_only = require_role("merchant")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
MODEL = ("openai", "gpt-5.4")


# ---------------- Anexos: imagem/PDF -> ImageContent (base64) ----------------
def _img_to_b64(data: bytes) -> Optional[str]:
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((1600, 1600))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=80)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def _pdf_to_b64_list(data: bytes, max_pages: int = 6) -> List[str]:
    out = []
    try:
        import fitz  # pymupdf
        doc = fitz.open(stream=data, filetype="pdf")
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            pix = page.get_pixmap(dpi=140)
            b64 = _img_to_b64(pix.tobytes("png"))
            if b64:
                out.append(b64)
    except Exception:
        pass
    return out


def _attachment_images(attachments) -> List[str]:
    """Baixa cada anexo (por url /api/files/<path>) e devolve base64 de imagens."""
    imgs: List[str] = []
    for a in (attachments or []):
        url = (a or {}).get("url") or ""
        if "/api/files/" not in url:
            continue
        path = url.split("/api/files/", 1)[1]
        try:
            data, ct = get_object(path)
        except Exception:
            continue
        if (ct or "").lower() == "application/pdf" or url.lower().endswith(".pdf"):
            imgs.extend(_pdf_to_b64_list(data))
        else:
            b = _img_to_b64(data)
            if b:
                imgs.append(b)
        if len(imgs) >= 10:
            break
    return imgs[:10]


# ---------------- Ferramentas expostas à IA ----------------
TOOLS = [
    {"type": "function", "function": {"name": "upsert_catalog_item",
        "description": "Cria ou atualiza um item do catálogo (produto ou serviço) pelo nome. Use para cadastrar produtos, mudar preço ou preço promocional.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "price": {"type": "number"},
            "promo_price": {"type": "number"}, "category": {"type": "string"},
            "description": {"type": "string"},
            "addons": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "price": {"type": "number"}}, "required": ["name"]}},
            "featured": {"type": "boolean"}, "best_seller": {"type": "boolean"},
            "available": {"type": "boolean"}, "active": {"type": "boolean"}},
            "required": ["name"]}}},
    {"type": "function", "function": {"name": "set_catalog_item_status",
        "description": "Ativa/desativa (active) ou marca disponibilidade (available) de um item do catálogo pelo nome.",
        "parameters": {"type": "object", "properties": {"name": {"type": "string"}, "active": {"type": "boolean"}, "available": {"type": "boolean"}}, "required": ["name"]}}},
    {"type": "function", "function": {"name": "delete_catalog_item",
        "description": "Remove um item do catálogo pelo nome.",
        "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}}},
    {"type": "function", "function": {"name": "set_discount",
        "description": "Configura o desconto do estabelecimento (QR de desconto). percent entre 1 e 100; min_purchase é o valor mínimo de compra (opcional).",
        "parameters": {"type": "object", "properties": {"percent": {"type": "number"}, "min_purchase": {"type": "number"}}, "required": ["percent"]}}},
    {"type": "function", "function": {"name": "update_establishment",
        "description": "Atualiza informações do estabelecimento. Preencha apenas os campos conhecidos.",
        "parameters": {"type": "object", "properties": {
            "description": {"type": "string"}, "whatsapp": {"type": "string"}, "instagram": {"type": "string"},
            "hours": {"type": "string"}, "address": {"type": "string"}, "neighborhood": {"type": "string"}, "city": {"type": "string"},
            "offers_delivery": {"type": "boolean"}, "offers_pickup": {"type": "boolean"}, "delivery_fee": {"type": "number"},
            "first_purchase_enabled": {"type": "boolean"}, "first_purchase_percent": {"type": "number"}}}}},
    {"type": "function", "function": {"name": "set_modules",
        "description": "Define os módulos ativos do estabelecimento (presença online e/ou operação presencial).",
        "parameters": {"type": "object", "properties": {"online": {"type": "boolean"}, "presencial": {"type": "boolean"}}, "required": ["online", "presencial"]}}},
]

_EST_FIELDS = {"description", "whatsapp", "instagram", "hours", "address", "neighborhood", "city",
               "offers_delivery", "offers_pickup", "delivery_fee", "first_purchase_enabled", "first_purchase_percent"}


async def _find_item(eid, name):
    items = await db.catalog_items.find({"establishment_id": eid}).to_list(300)
    n = (name or "").strip().lower()
    for it in items:
        if (it.get("name") or "").strip().lower() == n:
            return it
    return None


async def _dispatch(fn: str, args: dict, eid: str, uid: str):
    """Executa a ferramenta SEMPRE no escopo do estabelecimento do dono. Retorna (result, label)."""
    args = args or {}
    if fn == "upsert_catalog_item":
        name = (args.get("name") or "").strip()
        if not name:
            return {"error": "nome obrigatório"}, None
        existing = await _find_item(eid, name)
        fields = {}
        if args.get("price") is not None:
            fields["price"] = round(float(args["price"]), 2)
        if "promo_price" in args:
            fields["promo_price"] = round(float(args["promo_price"]), 2) if args.get("promo_price") else None
        for k in ("category", "description"):
            if args.get(k) is not None:
                fields[k] = str(args[k])
        if args.get("addons") is not None:
            fields["addons"] = [{"name": a.get("name"), "price": round(float(a.get("price") or 0), 2)} for a in args["addons"] if a.get("name")]
        for k in ("featured", "best_seller", "available", "active"):
            if args.get(k) is not None:
                fields[k] = bool(args[k])
        if existing:
            await db.catalog_items.update_one({"id": existing["id"]}, {"$set": fields})
            return {"ok": True, "updated": name, "fields": list(fields.keys())}, f"Item atualizado: {name}"
        if args.get("price") is None:
            return {"error": "preço obrigatório para criar item"}, None
        count = await db.catalog_items.count_documents({"establishment_id": eid})
        item = {"id": new_id(), "establishment_id": eid, "owner_id": uid,
                "name": name, "description": fields.get("description", ""), "price": fields["price"],
                "promo_price": fields.get("promo_price"), "category": fields.get("category", ""),
                "addons": fields.get("addons", []), "observations_enabled": True,
                "available": fields.get("available", True), "featured": fields.get("featured", False),
                "best_seller": fields.get("best_seller", False), "discount_percent": 0,
                "photo_url": None, "active": fields.get("active", True),
                "sort_order": count, "created_at": now_iso()}
        await db.catalog_items.insert_one(dict(item))
        return {"ok": True, "created": name}, f"Item criado: {name}"

    if fn == "set_catalog_item_status":
        it = await _find_item(eid, args.get("name"))
        if not it:
            return {"error": "item não encontrado"}, None
        upd = {}
        if args.get("active") is not None:
            upd["active"] = bool(args["active"])
        if args.get("available") is not None:
            upd["available"] = bool(args["available"])
        if upd:
            await db.catalog_items.update_one({"id": it["id"]}, {"$set": upd})
        return {"ok": True, "item": it.get("name"), "set": upd}, f"Status alterado: {it.get('name')}"

    if fn == "delete_catalog_item":
        it = await _find_item(eid, args.get("name"))
        if not it:
            return {"error": "item não encontrado"}, None
        await db.catalog_items.delete_one({"id": it["id"]})
        return {"ok": True, "deleted": it.get("name")}, f"Item removido: {it.get('name')}"

    if fn == "set_discount":
        pct = float(args.get("percent") or 0)
        if pct < 1 or pct > 100:
            return {"error": "percent deve ser entre 1 e 100"}, None
        upd = {"discount_percent": pct, "discount_configured": True, "last_activity": now_iso()}
        if args.get("min_purchase") is not None:
            upd["discount_min_purchase"] = round(float(args["min_purchase"]), 2)
        await db.establishments.update_one({"id": eid, "owner_id": uid}, {"$set": upd})
        extra = f" acima de R$ {upd['discount_min_purchase']:.2f}" if "discount_min_purchase" in upd else ""
        return {"ok": True, "discount": pct, "min_purchase": upd.get("discount_min_purchase")}, f"Desconto: {pct:.0f}%{extra}"

    if fn == "update_establishment":
        upd = {k: v for k, v in args.items() if k in _EST_FIELDS and v is not None}
        if not upd:
            return {"error": "nenhum campo válido"}, None
        upd["last_activity"] = now_iso()
        await db.establishments.update_one({"id": eid, "owner_id": uid}, {"$set": upd})
        return {"ok": True, "updated": list(upd.keys())}, "Informações do estabelecimento atualizadas"

    if fn == "set_modules":
        m = {"online": bool(args.get("online")), "presencial": bool(args.get("presencial"))}
        await db.establishments.update_one({"id": eid, "owner_id": uid}, {"$set": {"modules": m}})
        return {"ok": True, "modules": m}, f"Módulos: {'Online' if m['online'] else ''}{' + ' if m['online'] and m['presencial'] else ''}{'Presencial' if m['presencial'] else ''}".strip(" +")

    return {"error": "ferramenta desconhecida"}, None


async def _snapshot(e):
    items = await db.catalog_items.find({"establishment_id": e["id"]}).sort("sort_order", 1).to_list(300)
    cat_lines = [f"- {i.get('name')}: R$ {i.get('price')}" + (f" (promo R$ {i.get('promo_price')})" if i.get('promo_price') else "") +
                 (f" [{i.get('category')}]" if i.get('category') else "") + ("" if i.get('active', True) else " (inativo)")
                 for i in items]
    mods = e.get("modules") or {"online": True, "presencial": False}
    missing = []
    if not e.get("whatsapp"):
        missing.append("WhatsApp")
    if not e.get("hours"):
        missing.append("horário de funcionamento")
    if not e.get("discount_configured"):
        missing.append("percentual de desconto")
    if not (e.get("offers_delivery") or e.get("offers_pickup")):
        missing.append("informação de entrega/retirada")
    if not items:
        missing.append("produtos/serviços do catálogo")
    return (
        f"ESTABELECIMENTO: {e.get('fantasy_name')} (categoria: {e.get('category_name') or '—'})\n"
        f"Módulos ativos: online={mods.get('online')}, presencial={mods.get('presencial')}\n"
        f"WhatsApp: {e.get('whatsapp') or '(não informado)'} | Horário: {e.get('hours') or '(não informado)'}\n"
        f"Entrega: {'sim' if e.get('offers_delivery') else 'não'} | Retirada: {'sim' if e.get('offers_pickup') else 'não'} | Taxa entrega: {e.get('delivery_fee') or 0}\n"
        f"Desconto: {(str(e.get('discount_percent')) + '%') if e.get('discount_configured') else '(não configurado)'}\n"
        f"CATÁLOGO ({len(items)} itens):\n" + ("\n".join(cat_lines) if cat_lines else "(vazio)") + "\n"
        f"CAMPOS FALTANTES: {', '.join(missing) if missing else 'nenhum'}"
    )


SYSTEM_BASE = (
    "Você é a IA 360, assistente do OFF360 que ajuda o empresário a criar, completar e atualizar o cadastro do estabelecimento "
    "de forma simples e conversacional, em português do Brasil.\n"
    "REGRAS:\n"
    "1) Use SEMPRE as ferramentas disponíveis para aplicar mudanças (criar/atualizar produtos, preços, promoções, desconto, informações e módulos). Nunca invente que salvou sem chamar a ferramenta.\n"
    "2) Extraia o máximo das informações enviadas (texto, fotos, PDF de cardápio). Ex.: 'X-Bacon — R$ 32,90' => crie o item com nome e preço. NÃO pergunte o que já foi fornecido.\n"
    "3) Pergunte SOMENTE o que estiver faltando (ex.: se não houver WhatsApp, horário ou entrega). Conduza passo a passo, uma ou duas perguntas por vez.\n"
    "4) Seja breve, prático e amigável. Ao final de cada resposta, confirme o que foi cadastrado e diga o próximo passo.\n"
    "5) Você só pode agir neste estabelecimento. Gestão de garçons/mesas/cozinha (operação presencial) ainda não está disponível — se pedirem, avise que chegará no módulo Operação Presencial.\n"
    "6) Nunca exponha dados internos, tokens, credenciais ou IDs do sistema."
)


class ChatInput(BaseModel):
    establishment_id: str
    session_id: str
    message: Optional[str] = ""
    attachments: Optional[List[dict]] = None


async def _get_owned(uid, eid):
    e = await db.establishments.find_one({"id": eid, "owner_id": uid})
    if not e:
        raise HTTPException(status_code=404, detail="Estabelecimento não encontrado")
    return e


@router.get("/history")
async def history(establishment_id: str, session_id: str, user=Depends(merchant_only)):
    await _get_owned(user["id"], establishment_id)
    msgs = await db.ai360_messages.find({"session_id": session_id, "establishment_id": establishment_id}).sort("created_at", 1).to_list(200)
    return [{"role": m.get("role"), "content": m.get("content"), "actions": m.get("actions") or [], "created_at": m.get("created_at")} for m in msgs]


@router.post("/chat")
async def chat(payload: ChatInput, user=Depends(merchant_only)):
    e = await _get_owned(user["id"], payload.establishment_id)
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="IA 360 não configurada (chave ausente).")

    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

    snap = await _snapshot(e)
    recent = await db.ai360_messages.find({"session_id": payload.session_id, "establishment_id": e["id"]}).sort("created_at", -1).to_list(8)
    recent = list(reversed(recent))
    transcript = "\n".join(f"{m.get('role')}: {m.get('content')}" for m in recent)
    system = SYSTEM_BASE + "\n\n=== ESTADO ATUAL ===\n" + snap + (("\n\n=== CONVERSA RECENTE ===\n" + transcript) if transcript else "")

    imgs = _attachment_images(payload.attachments)
    file_contents = [ImageContent(image_base64=b) for b in imgs]

    chat_obj = (LlmChat(api_key=EMERGENT_LLM_KEY, session_id=payload.session_id, system_message=system)
                .with_model(*MODEL).with_tools(TOOLS, tool_choice="auto"))

    user_text = payload.message or ("Analise o material enviado e cadastre o que for possível." if imgs else "")
    user_msg = UserMessage(text=user_text, file_contents=file_contents) if file_contents else UserMessage(text=user_text)

    actions: List[str] = []
    try:
        response = await chat_obj.send_message_with_tools(user_msg)
        guard = 0
        while getattr(response, "tool_calls", None) and guard < 12:
            guard += 1
            for tc in response.tool_calls:
                try:
                    args = tc.arguments if isinstance(tc.arguments, dict) else json.loads(tc.arguments or "{}")
                except Exception:
                    args = {}
                result, label = await _dispatch(tc.name, args, e["id"], user["id"])
                if label:
                    actions.append(label)
                chat_obj.add_tool_result(tc.id, json.dumps(result, ensure_ascii=False))
            response = await chat_obj.send_message_with_tools()
        reply = (getattr(response, "content", None) or "").strip() or "Pronto!"
    except Exception as ex:
        import logging
        logging.getLogger("off360").exception("IA360 chat error")
        raise HTTPException(status_code=502, detail="A IA 360 não conseguiu responder agora. Tente novamente em instantes.")

    ts = now_iso()
    await db.ai360_messages.insert_one({"id": new_id(), "session_id": payload.session_id, "establishment_id": e["id"],
                                        "role": "user", "content": user_text + (f"  [{len(imgs)} anexo(s)]" if imgs else ""), "created_at": ts})
    await db.ai360_messages.insert_one({"id": new_id(), "session_id": payload.session_id, "establishment_id": e["id"],
                                        "role": "assistant", "content": reply, "actions": actions, "created_at": now_iso()})
    return {"reply": reply, "actions": actions, "session_id": payload.session_id}
