"""Pré-moderação automática de conteúdo patrocinado (Destaques/Stories).

Análise determinística baseada em termos de texto. Estados: approved | review | rejected.
- 'rejected' (bloqueio): conteúdo claramente proibido -> NÃO publica automaticamente.
- 'review': incerto (saúde, dinheiro, política, promessas extraordinárias) -> análise administrativa.
- 'approved' (limpo): sem sinais -> elegível a auto-aprovação futura (hoje ainda passa pelo admin).

IMPORTANTE: moderação de IMAGEM/vídeo exigiria um serviço externo (visão computacional)
que NÃO está integrado neste projeto. O campo `image_checked=False` sinaliza esse ponto de
extensão futuro. Nenhuma moderação de mídia é simulada aqui.
"""
import unicodedata

BLOCK_TERMS = {
    "conteúdo adulto": ["porno", "pornografia", "sexo explicito", "conteudo adulto", "nudez explicita",
                        "acompanhante sexual", "garota de programa", "onlyfans", "xvideos"],
    "violência gráfica": ["decapitacao", "tortura", "espancamento", "sangue jorrando", "chacina",
                          "assassinato ao vivo", "mutilacao"],
    "discurso de ódio": ["genocidio", "supremacia racial", "morte aos", "limpeza etnica", "extermínio de"],
    "drogas": ["cocaina a venda", "maconha a venda", "vender droga", "crack a venda", "lsd a venda", "ecstasy a venda"],
    "armas": ["arma de fogo a venda", "vender arma", "municao a venda", "fuzil a venda", "pistola a venda"],
    "fraude": ["esquema de piramide", "lavagem de dinheiro", "clonagem de cartao", "documento falso", "diploma falso"],
}

REVIEW_TERMS = {
    "saúde": ["cura garantida", "emagreca", "emagrecimento rapido", "milagroso", "trata cancer",
              "sem efeitos colaterais", "cura definitiva"],
    "dinheiro": ["renda garantida", "dinheiro facil", "fique rico", "investimento garantido",
                 "lucro garantido", "ganhe dinheiro rapido", "multiplique seu dinheiro"],
    "política": ["vote em", "candidato", "eleicao", "partido politico", "campanha eleitoral"],
    "promessas extraordinárias": ["100% garantido", "resultado imediato", "sem risco", "ganho certo",
                                  "impossivel perder", "resultado garantido"],
}


def _norm(text):
    text = (text or "").lower()
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def moderate_content(*texts):
    blob = _norm(" ".join(t for t in texts if t))
    for cat, terms in BLOCK_TERMS.items():
        if any(_norm(t) in blob for t in terms):
            return {"decision": "rejected", "category": cat, "image_checked": False, "auto_approvable": False,
                    "reason": f"Conteúdo potencialmente inadequado detectado ({cat}). Ajuste o texto e reenvie para nova análise."}
    for cat, terms in REVIEW_TERMS.items():
        if any(_norm(t) in blob for t in terms):
            return {"decision": "review", "category": cat, "image_checked": False, "auto_approvable": False,
                    "reason": f"Conteúdo encaminhado para análise administrativa por segurança ({cat})."}
    return {"decision": "approved", "category": None, "image_checked": False, "auto_approvable": True,
            "reason": "Pré-moderação de texto sem sinais de risco."}
