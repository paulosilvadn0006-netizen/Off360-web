#!/usr/bin/env python3
"""
Libera pagamentos travados do 360Taxi: marca como cancelado/expirado todo pagamento
preso (pendente / aguardando / em processamento) e libera a tela do consumidor.

USO (rodar no ambiente de PRODUÇÃO, onde estão os dados reais):
    MONGO_URL="<mongo de producao>" DB_NAME="<db de producao>" python3 liberar_pagamentos_travados.py            # simula (dry-run)
    MONGO_URL="..." DB_NAME="..." python3 liberar_pagamentos_travados.py --apply                                  # aplica de fato

Opcional: filtrar por passageiro/valor
    python3 liberar_pagamentos_travados.py --apply --nome "Aryad Silva" --valor 22.56
"""
import os
import sys
import argparse
from datetime import datetime, timezone
from pymongo import MongoClient

STUCK = ["pending", "in_process", "awaiting_confirm", "authorized"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="aplica de fato (sem isso, apenas simula)")
    ap.add_argument("--nome", default=None, help="filtra pelo nome do passageiro (regex, case-insensitive)")
    ap.add_argument("--valor", type=float, default=None, help="filtra pelo valor da corrida (agreed/final/current)")
    args = ap.parse_args()

    mongo = os.environ.get("MONGO_URL")
    dbname = os.environ.get("DB_NAME")
    if not mongo or not dbname:
        print("ERRO: defina MONGO_URL e DB_NAME de PRODUÇÃO nas variáveis de ambiente.")
        sys.exit(1)

    db = MongoClient(mongo)[dbname]

    consumer_ids = None
    if args.nome:
        consumer_ids = [u["id"] for u in db.users.find({"name": {"$regex": args.nome, "$options": "i"}}, {"id": 1})]
        print(f"Passageiros que batem com '{args.nome}': {len(consumer_ids)}")

    query = {"payment.status": {"$in": STUCK}}
    if consumer_ids is not None:
        query["consumer_id"] = {"$in": consumer_ids}
    if args.valor is not None:
        query["$or"] = [
            {"agreed_price": args.valor},
            {"final_price": args.valor},
            {"current_price": args.valor},
        ]

    rides = list(db.taxi_rides.find(query))
    print(f"Corridas com pagamento travado encontradas: {len(rides)}")
    for r in rides:
        u = db.users.find_one({"id": r.get("consumer_id")}) or {}
        print(f"  - ride={r.get('id')} status={r.get('status')} "
              f"pay.method={(r.get('payment') or {}).get('method')} "
              f"pay.status={(r.get('payment') or {}).get('status')} "
              f"passageiro={u.get('name')} valor={r.get('final_price') or r.get('agreed_price')}")

    if not args.apply:
        print("\n[DRY-RUN] Nada foi alterado. Rode com --apply para liberar.")
        return

    now = datetime.now(timezone.utc).isoformat()
    ids = [r["id"] for r in rides]
    res = db.taxi_rides.update_many(
        {"id": {"$in": ids}},
        {"$set": {
            "payment.status": "cancelled",
            "payment.status_detail": "expired_by_admin",
            "payment_notified": True,
            "payment_cancelled_at": now,
        }},
    )
    print(f"\n[APLICADO] Pagamentos liberados/cancelados: {res.modified_count}")
    print("As telas dos consumidores afetados ficam liberadas para nova solicitação.")


if __name__ == "__main__":
    main()
