"""Pipeline de validação de documentos do 360Taxi (4 etapas):
1) Pré-processamento (HEIC->JPEG, auto-rotate EXIF, contraste/nitidez).
2) Extração estruturada (OCR/Document AI + regex; visão só EXTRAI dados da selfie).
3) Validação DETERMINÍSTICA em código (nunca a IA decide o status).
4) Tratamento de erros: campo obrigatório ausente porém legível -> "Revisão Manual".
"""
import io
import os
import re
import json
import base64
from typing import Optional, Tuple, Dict, Any
from datetime import datetime, timezone

import docai as _docai

IMAGE_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif"}
DOC_TYPE_MAP = {
    "cnh_frente": "CNH_FRENTE", "cnh": "CNH_FRENTE", "cnh_verso": "CNH_VERSO",
    "veiculo": "CRLV", "crlv": "CRLV", "antecedentes": "ANTECEDENTES", "selfie": "SELFIE",
}

_CPF_RE = re.compile(r"(\d{3})\.?\s?(\d{3})\.?\s?(\d{3})-?\s?(\d{2})")
_DATE_RE = re.compile(r"(\d{2})[/.\-](\d{2})[/.\-](\d{4})")
_YEAR_RE = re.compile(r"\b(20\d{2})\b")


# ---------------- Etapa 1: pré-processamento ----------------
def preprocess_image(content: bytes, filename: Optional[str], mime: Optional[str]) -> Tuple[bytes, str]:
    fn = (filename or "").lower()
    mime = (mime or "").lower()
    is_pdf = mime == "application/pdf" or fn.endswith(".pdf")
    if is_pdf:
        return content, "application/pdf"
    if fn.endswith((".heic", ".heif")) or mime in ("image/heic", "image/heif"):
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except Exception:
            pass
    try:
        from PIL import Image, ImageOps, ImageEnhance
        img = Image.open(io.BytesIO(content))
        img = ImageOps.exif_transpose(img)  # auto-rotate por tags EXIF
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img = ImageEnhance.Contrast(img).enhance(1.15)   # contraste leve
        img = ImageEnhance.Sharpness(img).enhance(1.3)    # nitidez leve
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return buf.getvalue(), "image/jpeg"
    except Exception:
        return content, ("image/jpeg" if mime in IMAGE_MIMES else (mime or "image/jpeg"))


def _ocr_best(content: bytes, mime: str, filename: Optional[str]) -> Tuple[str, float]:
    """OCR via Document AI; se o texto vier curto (doc deitado/invertido), tenta rotações."""
    pre, m = preprocess_image(content, filename, mime)
    try:
        res = _docai.process_document(pre, m)
        text, conf = res.get("text") or "", res.get("avg_confidence", 0)
    except Exception:
        text, conf = "", 0.0
    if m == "application/pdf" or len(text.strip()) >= 25:
        return text, conf
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(pre))
        best_text, best_conf = text, conf
        for ang in (90, 180, 270):
            b = io.BytesIO()
            img.rotate(ang, expand=True).save(b, format="JPEG", quality=90)
            try:
                r = _docai.process_document(b.getvalue(), "image/jpeg")
            except Exception:
                continue
            t = r.get("text") or ""
            if len(t.strip()) > len(best_text.strip()):
                best_text, best_conf = t, r.get("avg_confidence", 0)
        return best_text, best_conf
    except Exception:
        return text, conf


# ---------------- Etapa 2: extração estruturada (dados brutos, sem decisão) ----------------
def _extract_cpf(text: str) -> Optional[str]:
    m = _CPF_RE.search(text or "")
    return "".join(m.groups()) if m else None


def _all_dates(text: str):
    out = []
    for m in _DATE_RE.finditer(text or ""):
        try:
            out.append(datetime(int(m.group(3)), int(m.group(2)), int(m.group(1))).date())
        except Exception:
            pass
    return out


def _base_fields(tipo: str) -> Dict[str, Any]:
    return {"tipo_documento": tipo, "cpf": None, "data_validade": None, "exercicio_veiculo": None,
            "documento_presente_na_foto": None, "rosto_presente": None, "legivel": False, "raw_text": ""}


def extract_text_doc(tipo: str, content: bytes, mime: str, filename: Optional[str]) -> Dict[str, Any]:
    ex = _base_fields(tipo)
    text, _conf = _ocr_best(content, mime, filename)
    up = (text or "").upper()
    ex["raw_text"] = (text or "")[:1500]
    ex["legivel"] = len((text or "").strip()) >= 15
    ex["cpf"] = _extract_cpf(text)
    dates = _all_dates(text)
    if tipo == "CNH_FRENTE":
        ex["data_validade"] = max(dates).isoformat() if dates else None  # validade = data mais futura
        ex["_padrao_ok"] = any(k in up for k in ("HABILITA", "CONDUTOR", "CNH", "TRANSITO", "DETRAN", "CARTEIRA"))
        ex["_ear"] = ("EAR" in up) or ("ATIVIDADE REMUNERADA" in up)
    elif tipo == "CNH_VERSO":
        # Verso: NÃO extrair/validar validade — apenas legibilidade/padrão.
        ex["_padrao_ok"] = any(k in up for k in ("HABILITA", "CONDUTOR", "CNH", "TRANSITO", "DETRAN", "REGISTRO", "RENACH", "CATEGORIA"))
    elif tipo == "CRLV":
        yrs = [int(y) for y in _YEAR_RE.findall(up)]
        ex["exercicio_veiculo"] = str(max(yrs)) if yrs else None
        ex["_padrao_ok"] = any(k in up for k in ("CRLV", "LICENCIAMENTO", "VEICULO", "RENAVAM", "EXERCICIO", "CRV"))
    elif tipo == "ANTECEDENTES":
        ex["_nada_consta"] = "NADA CONSTA" in up
        ex["_padrao_ok"] = any(k in up for k in ("ANTECEDENTE", "CERTIDAO", "CRIMINAL", "NADA CONSTA", "POLICIA", "JUSTICA", "SEGURANCA PUBLICA"))
    return ex


def _parse_json(txt: str) -> Dict[str, Any]:
    if not txt:
        return {}
    try:
        return json.loads(txt)
    except Exception:
        m = re.search(r"\{.*\}", txt, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return {}
    return {}


async def extract_selfie(content: bytes, filename: Optional[str], mime: Optional[str]) -> Dict[str, Any]:
    """Visão (LLM) usada APENAS para EXTRAIR booleans da selfie — nunca decide aprovação."""
    ex = _base_fields("SELFIE")
    ex["legivel"] = True
    pre, _m = preprocess_image(content, filename, mime)
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return ex
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        b64 = base64.b64encode(pre).decode()
        prompt = ("Você é um EXTRATOR de dados. NÃO decida aprovação. Analise a imagem (selfie de verificação de "
                  "motorista) e responda APENAS um JSON válido, sem texto extra: "
                  '{"rosto_presente": true/false, "documento_presente_na_foto": true/false}. '
                  "rosto_presente = há um rosto humano visível. documento_presente_na_foto = há um documento de "
                  "identidade/CNH (cartão ou papel) sendo segurado ou ao lado do rosto.")
        chat = LlmChat(api_key=key, session_id=f"selfie-{int(datetime.now().timestamp())}",
                       system_message="Você extrai dados de imagens e responde somente JSON.").with_model("openai", "gpt-5.4")
        resp = await chat.send_message(UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)]))
        txt = resp if isinstance(resp, str) else (getattr(resp, "content", None) or "")
        data = _parse_json(txt)
        if "rosto_presente" in data:
            ex["rosto_presente"] = bool(data.get("rosto_presente"))
        if "documento_presente_na_foto" in data:
            ex["documento_presente_na_foto"] = bool(data.get("documento_presente_na_foto"))
    except Exception:
        pass
    return ex


# ---------------- Etapa 3: validação determinística (regras em código) ----------------
def _parse_iso(d: Optional[str]):
    try:
        return datetime.fromisoformat(d).date() if d else None
    except Exception:
        return None


def _to_br(iso: Optional[str]) -> Optional[str]:
    d = _parse_iso(iso)
    return d.strftime("%d/%m/%Y") if d else None


def validate(tipo: str, ex: Dict[str, Any]) -> Dict[str, str]:
    today = datetime.now(timezone.utc).date()

    if tipo != "SELFIE" and not ex.get("legivel"):
        return {"status": "revisao", "motivo": "Imagem ilegível — reenvie uma foto nítida e bem iluminada"}

    if tipo == "CNH_FRENTE":
        if not ex.get("_padrao_ok"):
            return {"status": "revisao", "motivo": "Não parece a frente de uma CNH — revisão manual"}
        v = _parse_iso(ex.get("data_validade"))
        if not v:
            return {"status": "revisao", "motivo": "Validade não localizada — revisão manual"}
        if v < today:
            return {"status": "vencido", "motivo": f"CNH vencida em {v.strftime('%d/%m/%Y')}"}
        if not ex.get("_ear"):
            return {"status": "irregular", "motivo": "CNH sem observação EAR (exerce atividade remunerada)"}
        return {"status": "aprovado", "motivo": f"CNH válida até {v.strftime('%d/%m/%Y')}"}

    if tipo == "CNH_VERSO":
        # Não valida data de validade — só legibilidade/padrão.
        if not ex.get("_padrao_ok"):
            return {"status": "revisao", "motivo": "Verso da CNH ilegível/irregular — revisão manual"}
        return {"status": "aprovado", "motivo": "Verso da CNH legível"}

    if tipo == "CRLV":
        if not ex.get("_padrao_ok"):
            return {"status": "revisao", "motivo": "Não parece um CRLV — revisão manual"}
        yr = ex.get("exercicio_veiculo")
        if not yr:
            return {"status": "revisao", "motivo": "Ano de exercício não localizado — revisão manual"}
        if int(yr) < today.year:
            return {"status": "vencido", "motivo": f"Licenciamento do exercício {yr} vencido"}
        return {"status": "aprovado", "motivo": f"Licenciamento {yr} em dia"}

    if tipo == "ANTECEDENTES":
        if not ex.get("_padrao_ok"):
            return {"status": "revisao", "motivo": "Documento não reconhecido — revisão manual"}
        if ex.get("_nada_consta"):
            return {"status": "aprovado", "motivo": "Nada consta"}
        return {"status": "irregular", "motivo": "Registro encontrado — revisar manualmente"}

    if tipo == "SELFIE":
        rosto, doc = ex.get("rosto_presente"), ex.get("documento_presente_na_foto")
        if rosto is None or doc is None:
            return {"status": "revisao", "motivo": "Não foi possível analisar a selfie — revisão manual"}
        if not rosto:
            return {"status": "irregular", "motivo": "Nenhum rosto detectado na selfie"}
        if not doc:
            return {"status": "irregular", "motivo": "Documento (CNH) não detectado ao lado do rosto"}
        return {"status": "aprovado", "motivo": "Rosto e documento presentes na selfie"}

    return {"status": "revisao", "motivo": "Revisão manual"}


# ---------------- Orquestrador ----------------
async def run_document_pipeline(doc_type: str, content: bytes, filename: Optional[str], mime: Optional[str]) -> Dict[str, Any]:
    tipo = DOC_TYPE_MAP.get(doc_type)
    if not tipo:
        raise ValueError("Tipo de documento inválido")
    if tipo == "SELFIE":
        ex = await extract_selfie(content, filename, mime)
    else:
        ex = extract_text_doc(tipo, content, mime, filename)
    decision = validate(tipo, ex)
    return {
        "doc_type": doc_type,
        "tipo_documento": tipo,
        "cpf": ex.get("cpf"),
        "data_validade": ex.get("data_validade"),
        "exercicio_veiculo": ex.get("exercicio_veiculo"),
        "documento_presente_na_foto": ex.get("documento_presente_na_foto"),
        "rosto_presente": ex.get("rosto_presente"),
        "raw_text": (ex.get("raw_text") or "")[:1200],
        "validade": _to_br(ex.get("data_validade")),  # compatibilidade com a UI atual (dd/mm/aaaa)
        "status": decision["status"],
        "motivo": decision["motivo"],
    }
