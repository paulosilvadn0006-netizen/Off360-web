import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading, EmptyState, fmtDate, fmtDesired, money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ClipboardList, X } from "lucide-react";
import { STATUS_META, SERVICE_LABEL } from "@/lib/requests";

function Pill({ status }) {
  const m = STATUS_META[status] || { label: status, cls: "text-gray-300 bg-white/10" };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

export default function MyRequests() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const focusId = params.get("req");
  const [highlight, setHighlight] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["c-requests"], queryFn: async () => (await api.get("/consumer/requests")).data });

  // Abre a solicitação correta vinda da notificação: rola até o cartão e destaca temporariamente.
  useEffect(() => {
    if (!focusId || !data?.length) return;
    setHighlight(focusId);
    const el = document.getElementById(`myreq-${focusId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(t);
  }, [focusId, data]);

  const cancel = async (r) => {
    try { await api.post(`/consumer/requests/${r.id}/cancel`); toast.success("Solicitação cancelada"); qc.invalidateQueries({ queryKey: ["c-requests"] }); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const canCancel = (s) => !["completed", "cancelled", "rejected", "expired"].includes(s);

  if (isLoading) return <div className="px-4 pt-8"><Loading /></div>;

  return (
    <div className="px-4 pt-6 animate-fade-up">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate("/home")} className="rounded-full bg-off-surface p-2 text-white"><ChevronLeft className="h-5 w-5" /></button>
        <h1 className="font-display text-xl font-bold text-white">Minhas solicitações</h1>
      </div>

      {data?.length ? (
        <div className="mt-5 space-y-3" data-testid="c-requests-list">
          {data.map((r) => {
            const responses = r.responses?.length ? r.responses : (r.merchant_response ? [{ message: r.merchant_response, at: r.updated_at }] : []);
            return (
            <div key={r.id} id={`myreq-${r.id}`} className={`off-card p-4 transition ${highlight === r.id ? "ring-2 ring-off-orange" : ""}`} data-testid={`c-req-${r.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-white">{r.establishment_name}</p>
                  <p className="text-xs text-gray-400">{SERVICE_LABEL[r.request_type] || r.request_type} · {r.code} · {fmtDate(r.created_at)}</p>
                </div>
                <Pill status={r.status} />
              </div>
              <div className="mt-2 space-y-0.5 text-sm text-gray-200">
                {r.product_service && <p>{r.product_service}</p>}
                {(r.desired_date || r.desired_time) && <p className="text-gray-300">Desejado: {fmtDesired(r.desired_date, r.desired_time)}</p>}
                {responses.length > 0 && (
                  <div className="rounded-lg bg-off-bg/60 p-2 text-xs" data-testid={`c-req-response-${r.id}`}>
                    {responses.slice().reverse().map((resp, i) => (
                      <p key={i} className={i === 0 ? "text-white" : "mt-1 text-gray-400"}>{i === 0 ? "Resposta: " : ""}{resp.message}</p>
                    ))}
                  </div>
                )}
                {r.status === "completed" && r.saved_amount > 0 && <p className="text-off-success">Desconto aplicado: {r.discount_percent}% — você economizou {money(r.saved_amount)}</p>}
                {["awaiting", "accepted", "in_preparation", "scheduled", "ready_pickup", "out_for_delivery"].includes(r.status) && r.discount_applies && (
                  <div className="rounded-lg bg-off-orange/10 p-2">
                    <p className="text-off-orange">Desconto previsto: {r.discount_percent}%</p>
                    <p className="text-[11px] text-gray-300">O desconto será aplicado após a confirmação do atendimento pelo estabelecimento.</p>
                  </div>
                )}
                {["rejected", "cancelled", "expired"].includes(r.status) && r.discount_applies && <p className="text-gray-400">Desconto não utilizado.</p>}
              </div>
              {canCancel(r.status) && (
                <Button data-testid={`c-req-cancel-${r.id}`} size="sm" variant="outline" onClick={() => cancel(r)} className="mt-3 rounded-lg border-off-error/50 text-off-error"><X className="mr-1 h-4 w-4" /> Cancelar</Button>
              )}
            </div>
          );})}
        </div>
      ) : <div className="mt-8"><EmptyState icon={ClipboardList} title="Nenhuma solicitação" subtitle="Suas solicitações a estabelecimentos aparecerão aqui." /></div>}
    </div>
  );
}
