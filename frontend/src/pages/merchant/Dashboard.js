import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Loading, money, fmtDate, StatusPill } from "@/components/shared";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { DollarSign, TrendingDown, Users, Repeat, Receipt, Image, Eye, ArrowUpRight, AlertTriangle } from "lucide-react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["m-dashboard"], queryFn: async () => (await api.get("/merchant/dashboard")).data });
  if (isLoading || !data) return <Loading />;
  const notApproved = data.establishment.approval_status !== "approved";

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">{data.establishment.fantasy_name}</h1>
          <p className="text-sm text-gray-400">Visão geral do seu estabelecimento</p>
        </div>
        <button onClick={() => navigate("/merchant/validate")} data-testid="m-quick-validate" className="hidden rounded-xl off-gradient px-4 py-2.5 text-sm font-semibold text-white lg:block">Validar vendas</button>
      </div>

      {notApproved && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-off-warning/40 bg-off-warning/10 p-4 text-off-warning">
          <AlertTriangle className="h-5 w-5" /><span className="text-sm">Seu estabelecimento está <b>{data.establishment.approval_status}</b>. Aguarde a aprovação do administrador para receber validações.</span>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={DollarSign} label="Faturamento OFF 360" value={money(data.revenue)} />
        <Metric icon={TrendingDown} label="Descontos concedidos" value={money(data.discounts)} />
        <Metric icon={Users} label="Clientes atendidos" value={data.total_customers} />
        <Metric icon={Repeat} label="Clientes recorrentes" value={data.recurring_customers} />
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

      <div className="mt-4 off-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display font-bold text-white">Histórico recente</h2>
          <button onClick={() => navigate("/merchant/transactions")} className="flex items-center gap-1 text-xs font-semibold text-off-orange">Ver tudo <ArrowUpRight className="h-3 w-3" /></button>
        </div>
        {data.recent.length ? (
          <div className="space-y-2">
            {data.recent.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl bg-off-bg/60 px-4 py-3">
                <div><p className="text-sm font-medium text-white">{t.transaction_code}</p><p className="text-xs text-gray-500">{fmtDate(t.confirmed_at || t.created_at)}</p></div>
                <div className="text-right"><p className="text-sm font-bold text-white">{money(t.final_amount)}</p><StatusPill status={t.status} /></div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-500">Nenhuma transação ainda.</p>}
      </div>
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
