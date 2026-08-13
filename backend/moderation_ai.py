"""Moderação automática de mídia (imagem/vídeo) via OpenAI omni-moderation-latest.

Regras (fail-safe OBRIGATÓRIO):
- Vídeo: extrai frames localmente com ffmpeg (1 frame a cada 3s, teto ~20, sempre
  incluindo o PRIMEIRO e o ÚLTIMO frame) e envia como imagens.
- Imagem/frames + texto vão para o endpoint omni-moderation-latest.
- Qualquer conteúdo SINALIZADO, erro, timeout, ausência de chave, falha de ffmpeg
  ou resposta inválida => decisão "review" (NUNCA aprova automaticamente).
- NÃO exibe/registra a OPENAI_API_KEY nem base64 de mídia.
"""
import os
import base64
import asyncio
import subprocess
import tempfile
import logging
from pathlib import Path

from moderation import moderate_content
from storage import get_object

log = logging.getLogger("off360.moderation")

MAX_IMAGE_BYTES = 20 * 1024 * 1024
IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
FRAME_INTERVAL_SEC = 3
FRAME_CAP = 20
OPENAI_TIMEOUT = 30.0

_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    try:
        from openai import AsyncOpenAI
        _client = AsyncOpenAI(api_key=key, timeout=OPENAI_TIMEOUT, max_retries=2)
        return _client
    except Exception:
        log.exception("Falha ao inicializar cliente OpenAI")
        return None


def _storage_path_from_url(url):
    if not url:
        return None
    marker = "/api/files/"
    return url.split(marker, 1)[1] if marker in url else None


def _mime_for(content_type, media_type):
    ct = (content_type or "").lower()
    if ct in IMAGE_MIMES:
        return ct
    return "image/jpeg"


def _to_data_url(raw, mime):
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def _extract_frames(video_bytes, suffix=".mp4"):
    """1 frame a cada 3s (teto ~20), garantindo primeiro e último frames. Bloqueante."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        src = root / f"input{suffix}"
        src.write_bytes(video_bytes)
        pattern = str(root / "frame-%03d.jpg")
        # fps=1/3 -> um frame a cada 3s (o primeiro sai em t~0); teto de frames
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(src),
             "-vf", f"fps=1/{FRAME_INTERVAL_SEC}", "-frames:v", str(FRAME_CAP),
             "-q:v", "3", pattern],
            capture_output=True, timeout=90,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg falhou: {proc.stderr.decode('utf-8', 'ignore')[:200]}")
        frames = [p.read_bytes() for p in sorted(root.glob("frame-*.jpg"))]

        # Garante o ÚLTIMO frame (o sampling por fps pode não pegar o fim exato)
        last_path = root / "last.jpg"
        last_proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-sseof", "-0.5",
             "-i", str(src), "-frames:v", "1", "-q:v", "3", str(last_path)],
            capture_output=True, timeout=30,
        )
        last_bytes = last_path.read_bytes() if (last_proc.returncode == 0 and last_path.exists()) else None

    if not frames and last_bytes:
        frames = [last_bytes]
    if last_bytes:
        # mantém o primeiro (frames[0]) + fim, respeitando o teto de FRAME_CAP
        frames = frames[: FRAME_CAP - 1] + [last_bytes]
    else:
        frames = frames[:FRAME_CAP]
    # respeita o limite de 20MB por imagem
    return [f for f in frames if f and len(f) <= MAX_IMAGE_BYTES]


async def _gather_media_images(media_url, media_type):
    """Retorna (data_urls, frame_count). Lança em qualquer falha (para fail-safe)."""
    path = _storage_path_from_url(media_url)
    if not path:
        raise RuntimeError("URL de mídia não reconhecida para moderação.")
    raw, content_type = await asyncio.to_thread(get_object, path)

    if (media_type or "image") == "video" or (content_type or "").startswith("video"):
        frames = await asyncio.to_thread(_extract_frames, video_bytes=raw,
                                         suffix="." + (path.rsplit(".", 1)[-1] if "." in path else "mp4"))
        if not frames:
            raise RuntimeError("Nenhum frame extraído do vídeo.")
        return [_to_data_url(f, "image/jpeg") for f in frames], len(frames)

    if len(raw) > MAX_IMAGE_BYTES:
        raise RuntimeError("Imagem acima de 20MB para moderação.")
    return [_to_data_url(raw, _mime_for(content_type, media_type))], 1


def _flagged_categories(result):
    try:
        cats = result.categories.model_dump()
        return sorted([k for k, v in cats.items() if v])
    except Exception:
        return []


async def moderate_boost_full(texts, media_url, media_type):
    """Combina moderação de TEXTO (determinística) + IMAGEM/VÍDEO (OpenAI).

    Retorna dict compatível com o schema existente (decision/reason/category)
    acrescido de auto_approvable, media_checked, media_flagged, ai.
    """
    text_mod = moderate_content(*texts)
    base = {
        "decision": text_mod["decision"],
        "category": text_mod.get("category"),
        "reason": text_mod.get("reason"),
        "auto_approvable": False,
        "text_checked": True,
        "media_checked": False,
        "media_flagged": False,
        "ai": None,
    }

    # Texto claramente proibido: não gasta chamada de IA, já reprova.
    if text_mod["decision"] == "rejected":
        return base

    # Sem mídia: mantém a decisão de texto (auto_approvable só se limpo).
    if not media_url:
        base["auto_approvable"] = (text_mod["decision"] == "approved")
        return base

    client = _get_client()
    if client is None:
        base["decision"] = "review"
        base["reason"] = "Moderação de mídia indisponível (chave ausente). Enviado para análise administrativa."
        return base

    try:
        combined_text = " ".join(t for t in texts if t)
        data_urls, frame_count = await _gather_media_images(media_url, media_type)
        inputs = []
        if combined_text.strip():
            inputs.append({"type": "text", "text": combined_text})
        inputs.extend({"type": "image_url", "image_url": {"url": u}} for u in data_urls)

        resp = await client.moderations.create(model="omni-moderation-latest", input=inputs)
        if not resp.results:
            raise RuntimeError("Resposta de moderação vazia.")
        result = resp.results[0]
        flagged = bool(result.flagged)
        cats = _flagged_categories(result)
        base["media_checked"] = True
        base["ai"] = {"flagged": flagged, "categories": cats,
                      "model": getattr(resp, "model", "omni-moderation-latest"),
                      "frames": frame_count}

        if flagged:
            base["decision"] = "review"
            base["media_flagged"] = True
            base["category"] = ", ".join(cats) or "conteúdo sinalizado"
            base["reason"] = ("Mídia/texto sinalizados pela moderação automática "
                              f"({base['category']}). Enviado para análise administrativa.")
            return base

        # Mídia segura: decisão final = decisão do texto.
        if text_mod["decision"] == "approved":
            base["decision"] = "approved"
            base["auto_approvable"] = True
            base["reason"] = "Texto e mídia sem sinais de risco na moderação automática."
        else:  # texto em 'review'
            base["auto_approvable"] = False
        return base

    except asyncio.TimeoutError:
        base["decision"] = "review"
        base["reason"] = "Moderação de mídia expirou (timeout). Enviado para análise administrativa."
        return base
    except Exception as exc:  # ffmpeg, rede, storage, API, etc. -> fail-safe
        log.warning("Moderação de mídia indisponível: %s", type(exc).__name__)
        base["decision"] = "review"
        base["reason"] = "Não foi possível concluir a moderação de mídia. Enviado para análise administrativa."
        return base
