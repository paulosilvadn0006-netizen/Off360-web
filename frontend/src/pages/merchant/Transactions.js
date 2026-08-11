import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { api } from "@/lib/api";
import { Loading, money, fmtDate, StatusPill, EmptyState } from "@/components/shared";
import { Receipt } from "lucide-react";

export default function Transactions() {
  const { selectedId } = useOutletContext();
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["m-tx", selectedId, status], queryFn: async () => (await api.get("/merchant/transactions", { params: { establishment_id: selectedId || "all", status: status || undefined } })).data });

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Transações</h1>
      <p className="text-sm text-gray-400">Apenas as transações dos seus estabelecimentos.</p>
      <div className="mb-4 mt-4 flex gap-2 overflow-x-auto no-scrollbar">
        {[["", "Todas"], ["confirmed", "Confirmadas"], ["awaiting_confirmation", "Aguardando"], ["cancelled", "Canceladas"]].map(([v, l]) => (
          <button key={v} data-testid={`m-tx-filter-${v || "all"}`} onClick={() => setStatus(v)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${status === v ? "off-gradient text-white" : "bg-off-surface text-gray-400"}`}>{l}</button>
        ))}
      </div>
      {isLoading ? <Loading /> : (data?.length ? (
        <div className="off-card overflow-x-auto" data-testid="m-tx-list">
          <div className="hidden grid-cols-6 gap-2 border-b border-off-blue/30 px-4 py-3 text-xs font-semibold text-gray-400 lg:grid">
            <span>Data</span><span>Cliente</span><span>Bruto</span><span>Desconto</span><span>Final</span><span>Status</span>
          </div>
          {data.map((t) => (
            <div key={t.id} className="grid grid-cols-2 gap-2 border-b border-off-blue/20 px-4 py-3 text-sm lg:grid-cols-6">
              <span className="text-gray-400 lg:text-white">{fmtDate(t.created_at)}</span>
              <span className="font-medium text-white">{t.consumer_first_name}</span>
              <span className="text-gray-300">{money(t.gross_amount)}</span>
              <span className="text-off-orange">{money(t.discount_amount)}</span>
              <span className="font-bold text-white">{money(t.final_amount)}</span>
              <span><StatusPill status={t.status} /></span>
            </div>
          ))}
        </div>
      ) : <EmptyState icon={Receipt} title="Sem transações" subtitle="Nenhuma transação neste filtro." />)}
    </div>
  );
}
