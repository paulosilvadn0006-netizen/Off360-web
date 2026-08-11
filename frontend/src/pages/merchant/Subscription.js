import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, SubscriptionBadge, fmtDate } from "@/components/shared";
import { CreditCard, Info } from "lucide-react";

export default function Subscription() {
  const { data, isLoading } = useQuery({ queryKey: ["m-sub"], queryFn: async () => (await api.get("/merchant/subscription")).data });
  if (isLoading || !data) return <Loading />;

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Assinatura</h1>

      <div className="mt-5 off-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="rounded-xl off-gradient p-3"><CreditCard className="h-6 w-6 text-white" /></div><div><p className="font-display font-bold text-white">Plano Empresário OFF 360</p><p className="text-sm text-gray-400">Cobrança mensal recorrente</p></div></div>
          <SubscriptionBadge status={data.status} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div><p className="text-xs text-gray-400">Valor</p><p className="font-display text-lg font-bold text-white">{data.price != null ? `R$ ${data.price}` : "Valor a definir"}</p></div>
          <div><p className="text-xs text-gray-400">Próximo vencimento</p><p className="font-display text-lg font-bold text-white">{data.next_due ? fmtDate(data.next_due, false) : "—"}</p></div>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-off-blue/40 bg-off-surface p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-off-orange" />
        <p className="text-sm text-gray-300">A cobrança recorrente por <b>Pix</b> e <b>cartão</b> será habilitada em breve. O valor do plano será definido pela administração da OFF 360.</p>
      </div>
    </div>
  );
}
