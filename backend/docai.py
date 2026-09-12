"""Google Document AI — autenticação via GOOGLE_APPLICATION_CREDENTIALS_JSON (string JSON)."""
import os
import json
from functools import lru_cache

PROJECT_ID = "off360taxi"
LOCATION = "us"
PROCESSOR_ID = "69228345dd367792"


@lru_cache(maxsize=1)
def _client():
    from google.cloud import documentai
    from google.oauth2 import service_account
    raw = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if not raw:
        raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS_JSON não configurada")
    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(info)
    opts = {"api_endpoint": f"{LOCATION}-documentai.googleapis.com"}
    return documentai.DocumentProcessorServiceClient(credentials=creds, client_options=opts)


def process_document(content: bytes, mime_type: str):
    """Envia bytes (PDF/imagem) ao processador e retorna texto + entidades com confiança."""
    from google.cloud import documentai
    client = _client()
    name = client.processor_path(PROJECT_ID, LOCATION, PROCESSOR_ID)
    raw_doc = documentai.RawDocument(content=content, mime_type=mime_type)
    result = client.process_document(request=documentai.ProcessRequest(name=name, raw_document=raw_doc))
    doc = result.document
    entities = [{"type": e.type_, "text": e.mention_text, "confidence": round(float(e.confidence or 0), 3)}
                for e in doc.entities]
    avg_conf = round(sum(x["confidence"] for x in entities) / len(entities), 3) if entities else 0.0
    return {"text": doc.text or "", "entities": entities, "avg_confidence": avg_conf}
