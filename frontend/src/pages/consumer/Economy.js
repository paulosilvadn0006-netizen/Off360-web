import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Loading, money, fmtDate, StatusPill, EmptyState } from "@/components/shared";
import { TrendingUp, Wallet, ShoppingBag, Ticket, Receipt, ClipboardList } from "lucide-react";

export default function Economy() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["economy", status], queryFn: async () => (await api.get("/consumer/economy", { params: { status: status || undefined } })).data });
  if (isLoading || !data) return <div className="px-4 pt-8"><Loading /></div>;

  const worthIt = data.subscription_price ? data.month_saved >= data.subscription_price : null;

  return (
    <div className="px-4 pt-6 animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Minha Economia</h1>

      <div className="mt-4 rounded-3xl off-gradient p-5 text-white shadow-[0_10px_30px_rgba(255,75,18,0.35)]" data-testid="economy-wallet">
        <p className="text-sm opacity-90">Sua economia no OFF360</p>
        <p className="font-display text-4xl font-extrabold">{money(data.total_saved)}</p>
        <p className="mt-1 text-xs opacity-90">Economizados até agora</p>
        <div class="mt-3 flex items-center gap-4 text-sm">
          <span className="rounded-full bg-white/30 px-3 py-1 font-semibold text-white">Este mês: {money(data.month_saved)}</span>
          <span className="rounded-full bg-white/30 px-3 py-1 font-semibold text-white">{data.benefits_used ?? data.total_purchases} benefícios utilizados</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat icon={Wallet} label="Gasto no mês" value={money(data.month_spent)} />
        <Stat icon={ShoppingBag} label="Gasto no dia" value={money(data.day_spent)} />
        <Stat icon={Receipt} label="Compras" value={data.total_purchases} />
        <Stat icon={Ticket} label="Bilhetes" value={data.ticket_count} />
      </div>

      <div className="mt-4 rounded-2xl border border-off-blue/40 bg-off-surface p-4">
        <div className="flex items-center gap-2 text-off-orange"><TrendingUp className="h-4 w-4" /><span className="text-sm font-semibold">Economia vs assinatura</span></div>
        {data.subscription_price == null ? (
          <p className="mt-1 text-xs text-gray-400">Valor da assinatura a definir pelo administrador.</p>
        ) : (
          <p className={`mt-1 text-sm ${worthIt ? "text-off-success" : "text-gray-300"}`}>
            Você economizou {money(data.month_saved)} este mês {worthIt ? "— sua assinatura já se pagou! 🎉" : `de uma assinatura de ${money(data.subscription_price)}.`}
          </p>
        )}
      </div>

      <button data-testid="go-my-requests" onClick={() => navigate("/my-requests")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-off-blue/40 bg-off-surface py-3 text-sm font-semibold text-white">
        <ClipboardList className="h-4 w-4 text-off-orange" /> Minhas solicitações
      </button>

      <div className="mb-3 mt-6 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-white">Histórico</h2>
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto no-scrollbar">
        {[["", "Todas"], ["confirmed", "Confirmadas"], ["awaiting_confirmation", "Pendentes"], ["cancelled", "Canceladas"]].map(([v, l]) => (
          <button key={v} data-testid={`eco-filter-${v || "all"}`} onClick={() => setStatus(v)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${status === v ? "off-gradient text-white" : "bg-off-surface text-gray-400"}`}>{l}</button>
        ))}
      </div>

      {data.history.length ? (
        <div className="space-y-3 pb-6" data-testid="economy-history">
          {data.history.map((t) => (
            <div key={t.id} className="off-card p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-white">{t.establishment_name}</p>
                <StatusPill status={t.status} />
              </div>
              <p className="text-xs text-gray-500">{fmtDate(t.created_at)}</p>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-gray-400">Original {money(t.gross_amount)}</span>
                <span className="font-semibold text-off-orange">Economia {money(t.saved_amount)}{t.discount_percent ? ` (${t.discount_percent}%)` : ""}</span>
                <span className="font-bold text-white">{money(t.final_amount)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState icon={Receipt} title="Sem transações ainda" subtitle="Suas compras confirmadas aparecerão aqui." />}
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="off-card p-4">
      <div className="flex items-center gap-2 text-off-orange"><Icon className="h-4 w-4" /><span className="text-xs font-medium text-gray-400">{label}</span></div>
      <p className="mt-1.5 font-display text-xl font-bold text-white">{value}</p>
    </div>
  );
}
