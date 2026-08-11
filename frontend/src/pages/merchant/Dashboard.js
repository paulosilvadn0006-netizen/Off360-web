import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useOutletContext } from "react-router-dom";
import { api } from "@/lib/api";
import { Loading, money, fmtDate, StatusPill } from "@/components/shared";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { DollarSign, TrendingDown, Users, Repeat, Receipt, Image, Eye, Building2, AlertTriangle } from "lucide-react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { selectedId } = useOutletContext();
  const { data, isLoading } = useQuery({ queryKey: ["m-dashboard", selectedId], queryFn: async () => (await api.get("/merchant/dashboard", { params: { establishment_id: selectedId || "all" } })).data });
  if (isLoading || !data) return <Loading />;
  const isAll = data.view === "all";
  const t = data.totals;

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">{isAll ? "Todos os estabelecimentos" : data.selected?.fantasy_name}</h1>
          <p className="text-sm text-gray-400">{isAll ? "Visão consolidada" : "Dados desta unidade"}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={Building2} label="Estabelecimentos" value={t.establishments} />
        <Metric icon={Building2} label="Ativos" value={t.active} />
        <Metric icon={AlertTriangle} label="Pendentes" value={t.pending} />
        <Metric icon={DollarSign} label="Mensalidade total" value={t.monthly_value == null ? "A definir" : money(t.monthly_value)} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={DollarSign} label="Faturamento OFF 360" value={money(data.revenue)} />
        <Metric icon={TrendingDown} label="Descontos concedidos" value={money(data.discounts)} />
        <Metric icon={Users} label="Clientes atendidos" value={data.total_customers} />
        <Metric icon={Repeat} label="Recorrentes" value={data.recurring_customers} />
        <Metric icon={Receipt} label="Transações hoje" value={data.day_transactions} />
        <Metric icon={Receipt} label="Transações no mês" value={data.month_transactions} />
        <Metric icon={Image} label="Stories ativos" value={data.active_stories} />
        <Metric icon={Eye} label="Visualizações" value={data.story_views} />
      </div>

      <div className="mt-4 off-card p-5">
        <h2 className="font-display font-bold text-white">Movimentação (7 dias)</h2>
        <div className="mt-4 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.chart}>
              <XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "rgba(255,122,0,0.1)" }} contentStyle={{ background: "#061532", border: "1px solid #12366D", borderRadius: 12, color: "#fff" }} formatter={(v) => money(v)} />
              <Bar dataKey="value" fill="#FF7A00" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {isAll && (
        <div className="mt-4 off-card overflow-x-auto p-5">
          <h2 className="mb-3 font-display font-bold text-white">Por estabelecimento</h2>
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-off-blue/30 text-xs text-gray-400"><th className="py-2">Unidade</th><th>Assinatura</th><th>Desconto</th><th>Faturamento</th><th>Vencimento</th></tr></thead>
            <tbody>
              {data.per_establishment.map((e) => (
                <tr key={e.id} className="border-b border-off-blue/15">
                  <td className="py-2 font-medium text-white">{e.fantasy_name}</td>
                  <td><StatusPill status={e.subscription_status === "active" ? "confirmed" : e.subscription_status === "pending" ? "awaiting_confirmation" : "cancelled"} /></td>
                  <td className="text-gray-300">{e.discount_configured ? `${e.discount_percent}%` : "Não configurado"}</td>
                  <td className="text-white">{money(e.revenue)}</td>
                  <td className="text-gray-400">{e.next_due ? fmtDate(e.next_due, false) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="off-card p-4">
      <div className="flex items-center gap-2 text-off-orange"><Icon className="h-4 w-4" /><span className="text-[11px] font-medium text-gray-400">{label}</span></div>
      <p className="mt-1.5 font-display text-xl font-bold text-white">{value}</p>
    </div>
  );
}
