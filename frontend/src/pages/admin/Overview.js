import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, money } from "@/components/shared";
import { MetricCard, AdminHeader } from "@/pages/admin/_components";
import { Users, UserCheck, UserX, Clock, Store, MapPin, Activity, Receipt, DollarSign, TrendingDown, PiggyBank, Wifi } from "lucide-react";

export default function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ["a-overview"], queryFn: async () => (await api.get("/admin/overview")).data });
  if (isLoading || !data) return <Loading />;

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Visão geral" subtitle="Indicadores em tempo real da plataforma OFF 360." />

      <h2 className="mb-3 font-display font-bold text-white">Consumidores</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard icon={Users} label="Cadastrados" value={data.total_consumers} />
        <MetricCard icon={UserCheck} label="Assinantes ativos" value={data.active_subscription_consumers} accent="text-off-success" />
        <MetricCard icon={UserX} label="Inativos" value={data.inactive_consumers} accent="text-off-error" />
        <MetricCard icon={Clock} label="Inadimplentes" value={data.overdue_consumers} accent="text-off-warning" />
        <MetricCard icon={Users} label="Novos no mês" value={data.new_consumers_month} />
      </div>

      <h2 className="mb-3 mt-6 font-display font-bold text-white">Empresários</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Store} label="Cadastrados" value={data.total_merchants} />
        <MetricCard icon={UserCheck} label="Ativos" value={data.active_merchants} accent="text-off-success" />
        <MetricCard icon={UserX} label="Inativos" value={data.inactive_merchants} accent="text-off-error" />
        <MetricCard icon={MapPin} label="Aguardando aprovação" value={data.pending_establishments} accent="text-off-warning" />
      </div>

      <h2 className="mb-3 mt-6 font-display font-bold text-white">Uso da plataforma</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Wifi} label="Online agora" value={data.online_now} accent="text-off-success" />
        <MetricCard icon={Activity} label="Ativos hoje" value={data.active_today} />
        <MetricCard icon={Activity} label="Ativos na semana" value={data.active_week} />
        <MetricCard icon={Activity} label="Ativos no mês" value={data.active_month} />
        <MetricCard icon={Receipt} label="Compradores ativos" value={data.buying_consumers} />
        <MetricCard icon={Store} label="Empresários c/ vendas" value={data.receiving_merchants} />
      </div>

      <h2 className="mb-3 mt-6 font-display font-bold text-white">Financeiro consolidado</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Receipt} label="Total de transações" value={data.total_transactions} />
        <MetricCard icon={DollarSign} label="Volume movimentado" value={money(data.financial_volume)} />
        <MetricCard icon={TrendingDown} label="Descontos concedidos" value={money(data.total_discounts)} accent="text-off-warning" />
        <MetricCard icon={PiggyBank} label="Economia dos consumidores" value={money(data.total_saved)} accent="text-off-success" />
      </div>
    </div>
  );
}
