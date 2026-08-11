import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { Loading, money, fmtDate, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, ShieldCheck, Clock, Inbox } from "lucide-react";

export default function Validate() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["m-pending"],
    queryFn: async () => (await api.get("/merchant/pending")).data,
    refetchInterval: 4000,
  });

  const act = async (id, action) => {
    try {
      await api.post(`/merchant/transactions/${id}/${action}`);
      toast.success(action === "confirm" ? "Pagamento confirmado!" : "Validação recusada");
      qc.invalidateQueries({ queryKey: ["m-pending"] });
      qc.invalidateQueries({ queryKey: ["m-dashboard"] });
    } catch (err) { toast.error(formatApiError(err)); }
  };

  if (isLoading) return <Loading />;

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Validar vendas</h1>
      <p className="text-sm text-gray-400">Confirme ou recuse as validações enviadas pelos clientes.</p>

      {data?.length ? (
        <div className="mt-5 space-y-4" data-testid="pending-list">
          {data.map((t) => (
            <div key={t.id} className="off-card p-5" data-testid={`pending-${t.id}`}>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-full off-gradient">
                  {t.consumer_photo ? <img alt="" src={fileUrl(t.consumer_photo)} className="h-full w-full object-cover" /> :
                    <div className="flex h-full w-full items-center justify-center font-bold text-white">{(t.consumer_name || "?")[0]}</div>}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-white">{t.consumer_name}</p>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-off-success"><ShieldCheck className="h-3 w-3" /> Assinante ativo</span>
                </div>
                <span className="flex items-center gap-1 text-xs text-off-warning"><Clock className="h-3 w-3" /> {fmtDate(t.created_at)}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-off-bg/60 p-3 text-center">
                <div><p className="text-[11px] text-gray-500">Valor</p><p className="font-bold text-white">{money(t.gross_amount)}</p></div>
                <div><p className="text-[11px] text-gray-500">Desconto ({t.discount_percent}%)</p><p className="font-bold text-off-orange">{money(t.discount_amount)}</p></div>
                <div><p className="text-[11px] text-gray-500">Final</p><p className="font-bold text-white">{money(t.final_amount)}</p></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button data-testid={`confirm-${t.id}`} onClick={() => act(t.id, "confirm")} className="h-12 rounded-xl bg-off-success font-semibold text-white hover:bg-off-success/90"><CheckCircle2 className="mr-2 h-5 w-5" /> Confirmar</Button>
                <Button data-testid={`reject-${t.id}`} onClick={() => act(t.id, "reject")} variant="outline" className="h-12 rounded-xl border-off-error/50 text-off-error hover:bg-off-error/10"><XCircle className="mr-2 h-5 w-5" /> Recusar</Button>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="mt-8"><EmptyState icon={Inbox} title="Nenhuma validação pendente" subtitle="As validações escaneadas pelos clientes aparecerão aqui em tempo real." /></div>}
    </div>
  );
}
