import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, SubscriptionBadge, money, fmtDate } from "@/components/shared";
import { CreditCard, Info } from "lucide-react";

export default function Subscription() {
  const { data, isLoading } = useQuery({ queryKey: ["m-sub"], queryFn: async () => (await api.get("/merchant/subscription")).data });
  if (isLoading || !data) return <Loading />;

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Assinatura</h1>

      <div className="mt-5 off-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="rounded-xl off-gradient p-3"><CreditCard className="h-6 w-6 text-white" /></div><div><p className="font-display font-bold text-white">Plano por estabelecimento</p><p className="text-sm text-gray-400">Uma assinatura mensal para cada unidade ativa</p></div></div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div><p className="text-xs text-gray-400">Valor por unidade</p><p className="font-display text-lg font-bold text-white">{data.price_per_establishment != null ? money(data.price_per_establishment) : "A definir"}</p></div>
          <div><p className="text-xs text-gray-400">Unidades ativas</p><p className="font-display text-lg font-bold text-white">{data.active_count}/{data.count}</p></div>
          <div><p className="text-xs text-gray-400">Mensalidade total</p><p className="font-display text-lg font-bold text-off-orange">{data.monthly_total != null ? money(data.monthly_total) : "A definir"}</p></div>
        </div>
      </div>

      <div className="mt-4 off-card p-5">
        <h2 className="mb-3 font-display font-bold text-white">Composição por estabelecimento</h2>
        <div className="space-y-2">
          {data.establishments.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-xl bg-off-bg/60 px-4 py-3">
              <div><p className="font-medium text-white">{e.fantasy_name}</p><p className="text-xs text-gray-500">Vencimento: {e.next_due ? fmtDate(e.next_due, false) : "—"}</p></div>
              <div className="flex items-center gap-3"><span className="text-sm text-gray-300">{e.value != null ? money(e.value) : "A definir"}</span><SubscriptionBadge status={e.subscription_status} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-off-blue/40 bg-off-surface p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-off-orange" />
        <p className="text-sm text-gray-300">A cobrança recorrente por <b>Pix</b> e <b>cartão</b> será habilitada em breve. Os valores serão definidos pela administração da OFF 360.</p>
      </div>
    </div>
  );
}
