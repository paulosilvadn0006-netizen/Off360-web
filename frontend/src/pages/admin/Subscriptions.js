import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading } from "@/components/shared";
import { AdminHeader, MetricCard } from "@/pages/admin/_components";
import { CheckCircle2, Clock, XCircle, AlertTriangle, Ban } from "lucide-react";

export default function Subscriptions() {
  const { data, isLoading } = useQuery({ queryKey: ["a-subs"], queryFn: async () => (await api.get("/admin/subscriptions")).data });
  if (isLoading || !data) return <Loading />;

  const Block = ({ title, s }) => (
    <div className="off-card p-5">
      <h3 className="mb-3 font-display font-bold text-white">{title}</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard icon={CheckCircle2} label="Ativas" value={s.active} accent="text-off-success" />
        <MetricCard icon={Clock} label="Pendentes" value={s.pending} accent="text-off-warning" />
        <MetricCard icon={AlertTriangle} label="Vencidas" value={s.expired} accent="text-off-error" />
        <MetricCard icon={Ban} label="Canceladas" value={s.cancelled} accent="text-off-error" />
        <MetricCard icon={XCircle} label="Inativas" value={s.inactive} accent="text-gray-400" />
      </div>
    </div>
  );

  return (
    <div className="animate-fade-up space-y-4">
      <AdminHeader title="Assinaturas" subtitle="Situação das assinaturas de consumidores e empresários." />
      <Block title="Consumidores" s={data.consumers} />
      <Block title="Empresários" s={data.merchants} />
    </div>
  );
}
