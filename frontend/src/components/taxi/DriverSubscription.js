import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CreditCard, ShieldCheck, AlertTriangle } from "lucide-react";

const fmtDate = (s) => {
  if (!s) return "-";
  try { return new Date(s).toLocaleDateString("pt-BR"); } catch { return "-"; }
};

export default function DriverSubscription() {
  const { data } = useQuery({ queryKey: ["taxi-subscription"], queryFn: async () => (await api.get("/taxi/subscription")).data, refetchInterval: 30000 });
  const [busy, setBusy] = useState(false);

  if (!data) return null;
  const vencida = data.status_assinatura === "Vencido";
  const dias = data.dias_restantes ?? 0;

  const subscribeCard = async () => {
    setBusy(true);
    try {
      const { data: res } = await api.post("/taxi/subscription/card");
      if (res.init_point) { window.open(res.init_point, "_blank", "noopener"); toast.success("Abrimos o Mercado Pago para você autorizar o cartão. Os 30 dias grátis já estão ativos."); }
      else toast.error("Não foi possível iniciar a assinatura. Tente novamente.");
    } catch (err) { toast.error(formatApiError(err, "Falha ao iniciar assinatura no cartão.")); }
    finally { setBusy(false); }
  };

  return (
    <div className={`mb-4 rounded-2xl border p-4 ${vencida ? "border-off-error/50 bg-off-error/10" : "border-off-blue/40 bg-off-surface"}`} data-testid="taxi-driver-subscription">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {vencida ? <AlertTriangle className="h-5 w-5 text-off-error" /> : <ShieldCheck className="h-5 w-5 text-off-success" />}
          <div>
            <p className="font-display text-sm font-bold text-white">Assinatura 360Taxi</p>
            <p className="text-[11px] text-gray-400" data-testid="taxi-sub-status">
              {vencida
                ? "Vencida — renove para voltar a aceitar corridas."
                : `${data.status_assinatura} · vence em ${fmtDate(data.data_vencimento)} (${dias} dia${dias === 1 ? "" : "s"})`}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${vencida ? "bg-off-error/20 text-off-error" : "bg-off-success/15 text-off-success"}`}>{data.status_assinatura}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button data-testid="taxi-sub-card-btn" onClick={subscribeCard} disabled={busy} className="h-10 rounded-xl bg-off-blue text-xs font-semibold text-white hover:bg-off-blue/90">
          <CreditCard className="mr-1.5 h-4 w-4" /> Cartão (30 dias grátis)
        </Button>
      </div>
    </div>
  );
}
