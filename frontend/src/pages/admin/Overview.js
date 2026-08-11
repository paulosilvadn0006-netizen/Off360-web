import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, money } from "@/components/shared";
import { AdminHeader, MetricCard } from "@/pages/admin/_components";
import { Users, UserCheck, UserX, Clock, Store, Building2, MapPin, Activity, Receipt, DollarSign, TrendingDown, PiggyBank, Wifi } from "lucide-react";

export default function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ["a-overview"], queryFn: async () => (await api.get("/admin/overview")).data });
  if (isLoading || !data) return <Loading />;

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Visão geral" subtitle="Indicadores em tempo real da plataforma OFF 360." />

      <h2 className="mb-3 font-display font-bold text-white">Totais (sem duplicidade)</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Users} label="Usuários (consumidores + empresários)" value={data.total_users} />
        <MetricCard icon={Users} label="Consumidores" value={data.total_consumers} />
        <MetricCard icon={Store} label="Empresários" value={data.total_merchants} />
        <MetricCard icon={Building2} label="Estabelecimentos" value={data.total_establishments} accent="text-off-orange" />
      </div>

      <h2 className="mb-3 mt-6 font-display font-bold text-white">Consumidores</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={UserCheck} label="Assinantes ativos" value={data.active_subscription_consumers} accent="text-off-success" />
        <MetricCard icon={UserX} label="Inativos" value={data.inactive_consumers} accent="text-off-error" />
        <MetricCard icon={Clock} label="Inadimplentes" value={data.overdue_consumers} accent="text-off-warning" />
        <MetricCard icon={Users} label="Novos no mês" value={data.new_consumers_month} />
      </div>

      <h2 className="mb-3 mt-6 font-display font-bold text-white">Estabelecimentos</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Building2} label="Ativos" value={data.active_establishments} accent="text-off-success" />
        <MetricCard icon={MapPin} label="Aguardando ativação" value={data.pending_establishments} accent="text-off-warning" />
        <MetricCard icon={UserX} label="Suspensos" value={data.suspended_establishments} accent="text-off-error" />
        <MetricCard icon={Store} label="Empresários ativos" value={data.active_merchants} />
      </div>

      <h2 className="mb-3 mt-6 font-display font-bold text-white">Uso da plataforma</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Wifi} label="Online agora" value={data.online_now} accent="text-off-success" />
        <MetricCard icon={Activity} label="Ativos hoje" value={data.active_today} />
        <MetricCard icon={Activity} label="Ativos na semana" value={data.active_week} />
        <MetricCard icon={Activity} label="Ativos no mês" value={data.active_month} />
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
