import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useOutletContext } from "react-router-dom";
import { api } from "@/lib/api";
import { Loading, money, StatusPill, SubscriptionBadge, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { DollarSign, TrendingDown, Users, Repeat, Receipt, Image as ImageIcon, Eye, Building2, AlertTriangle, Settings, QrCode, Store, Plus, CheckCircle2 } from "lucide-react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { selectedId, setSelectedId, openAddDialog } = useOutletContext();
  const { data, isLoading } = useQuery({ queryKey: ["m-dashboard", selectedId], queryFn: async () => (await api.get("/merchant/dashboard", { params: { establishment_id: selectedId || "all" } })).data });
  const { data: consumers } = useQuery({ queryKey: ["m-consumers-count"], queryFn: async () => (await api.get("/merchant/consumers-count")).data, refetchInterval: 15000 });
  if (isLoading || !data) return <Loading />;
  const isAll = data.view === "all";
  const t = data.totals;

  if (t.establishments === 0) {
    return (
      <div className="animate-fade-up">
        <div className="off-card p-8 text-center" data-testid="no-establishment">
          <Store className="mx-auto h-14 w-14 text-off-orange" />
          <h1 className="mt-4 font-display text-2xl font-bold text-white">Complete o cadastro do primeiro estabelecimento</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">Preencha o formulário completo da sua primeira unidade. Somente após salvar ela contará como 1/10 e ficará "aguardando ativação".</p>
          <Button data-testid="create-first-est" onClick={openAddDialog} className="mt-5 h-12 rounded-xl off-gradient px-8 font-semibold text-white"><Plus className="mr-2 h-4 w-4" /> Cadastrar primeiro estabelecimento</Button>
        </div>
      </div>
    );
  }

  const manage = (id) => { setSelectedId(id); navigate("/merchant/establishment"); };
  const viewQr = (id) => { setSelectedId(id); navigate("/merchant/qr"); };

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
        <Metric icon={Users} label="Consumidores OFF360" value={consumers?.count ?? "…"} />
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
        <Metric icon={ImageIcon} label="Stories ativos" value={data.active_stories} />
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
        <div className="mt-5">
          <h2 className="mb-3 font-display font-bold text-white">Minhas unidades</h2>
          <div className="grid gap-3 sm:grid-cols-2" data-testid="est-cards">
            {data.per_establishment.map((e) => (
              <div key={e.id} className="off-card p-4" data-testid={`est-card-${e.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display font-bold text-white">{e.fantasy_name}</p>
                    <p className="text-xs text-gray-400">{e.category_name || "Sem categoria"} · {e.neighborhood || e.city || "—"}</p>
                  </div>
                  <StatusPill status={e.approval_status} />
                </div>
                <div className="mt-2">
                  {e.registration_complete ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-off-success/10 px-2.5 py-1 text-xs font-semibold text-off-success"><CheckCircle2 className="h-3 w-3" /> Cadastro completo{e.approval_status !== "approved" ? " — aguardando ativação" : ""}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-off-warning/10 px-2.5 py-1 text-xs font-semibold text-off-warning"><AlertTriangle className="h-3 w-3" /> Cadastro incompleto</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SubscriptionBadge status={e.subscription_status} />
                  <span className="rounded-full bg-off-orange/15 px-2.5 py-1 text-xs font-bold text-off-orange">{e.discount_configured ? `${e.discount_percent}% OFF` : "Desconto não configurado"}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-gray-400">Faturamento</span><span className="font-bold text-white">{money(e.revenue)}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {e.registration_complete ? (
                    <Button data-testid={`manage-${e.id}`} onClick={() => manage(e.id)} className="h-10 rounded-xl off-gradient text-xs font-semibold text-white"><Settings className="mr-1 h-4 w-4" /> GERENCIAR</Button>
                  ) : (
                    <Button data-testid={`continue-${e.id}`} onClick={() => manage(e.id)} className="h-10 rounded-xl bg-off-warning text-xs font-semibold text-white hover:bg-off-warning/90"><Settings className="mr-1 h-4 w-4" /> CONTINUAR CADASTRO</Button>
                  )}
                  <Button data-testid={`viewqr-${e.id}`} onClick={() => viewQr(e.id)} variant="outline" className="h-10 rounded-xl border-off-blue/50 text-xs font-semibold text-white"><QrCode className="mr-1 h-4 w-4" /> VER QR CODE</Button>
                </div>
              </div>
            ))}
          </div>
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
