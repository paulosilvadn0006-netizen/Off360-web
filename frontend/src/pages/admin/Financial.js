import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, money } from "@/components/shared";
import { AdminHeader, MetricCard } from "@/pages/admin/_components";
import { DollarSign, Users, Store, TrendingUp, Clock, AlertTriangle, Ban, Info } from "lucide-react";

export default function Financial() {
  const { data, isLoading } = useQuery({ queryKey: ["a-financial"], queryFn: async () => (await api.get("/admin/financial")).data });
  if (isLoading || !data) return <Loading />;

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Financeiro" subtitle="Receita da OFF 360 — consumidores e empresários." />

      {!data.prices_configured && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-off-warning/40 bg-off-warning/10 p-4 text-off-warning">
          <Info className="h-5 w-5" /><span className="text-sm">Valores dos planos ainda não definidos. Configure em <b>Configurações</b> para calcular a receita.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <MetricCard icon={Users} label="Receita consumidores/mês" value={money(data.consumer_revenue)} />
        <MetricCard icon={Store} label="Receita empresários/mês" value={money(data.merchant_revenue)} />
        <MetricCard icon={DollarSign} label="Receita total/mês" value={money(data.total_revenue)} accent="text-off-success" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={TrendingUp} label="MRR (recorrente)" value={money(data.mrr)} />
        <MetricCard icon={Users} label="Assinaturas ativas (cons.)" value={data.active_consumer_subs} />
        <MetricCard icon={Store} label="Assinaturas ativas (emp.)" value={data.active_merchant_subs} />
        <MetricCard icon={Clock} label="Pendentes" value={data.pending_subs} accent="text-off-warning" />
        <MetricCard icon={AlertTriangle} label="Vencidas" value={data.expired_subs} accent="text-off-error" />
        <MetricCard icon={Ban} label="Canceladas" value={data.cancelled_subs} accent="text-off-error" />
      </div>
    </div>
  );
}
