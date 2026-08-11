import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { Loading, money, fmtDate, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, XCircle, ShieldCheck, Clock, Inbox } from "lucide-react";

export default function Validate() {
  const qc = useQueryClient();
  const [amounts, setAmounts] = useState({});
  const [busy, setBusy] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["m-pending"],
    queryFn: async () => (await api.get("/merchant/pending")).data,
    refetchInterval: 4000,
  });

  const calc = (t, val) => {
    const gross = parseFloat(String(val).replace(",", ".")) || 0;
    let discount = gross * (t.discount_percent || 0) / 100;
    if (t.discount_max_cap != null && discount > t.discount_max_cap) discount = t.discount_max_cap;
    return { gross, discount, final: gross - discount };
  };

  const confirm = async (t) => {
    const val = parseFloat(String(amounts[t.id] || "").replace(",", "."));
    if (!val || val <= 0) { toast.error("Informe o valor bruto da compra"); return; }
    setBusy(t.id);
    try {
      await api.post(`/merchant/transactions/${t.id}/confirm`, { gross_amount: val });
      toast.success("Transação confirmada!");
      setAmounts((a) => { const c = { ...a }; delete c[t.id]; return c; });
      qc.invalidateQueries({ queryKey: ["m-pending"] });
      qc.invalidateQueries({ queryKey: ["m-dashboard"] });
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(null); }
  };

  const reject = async (t) => {
    setBusy(t.id);
    try { await api.post(`/merchant/transactions/${t.id}/reject`); toast.success("Validação recusada"); qc.invalidateQueries({ queryKey: ["m-pending"] }); }
    catch (err) { toast.error(formatApiError(err)); } finally { setBusy(null); }
  };

  if (isLoading) return <Loading />;

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Validar vendas</h1>
      <p className="text-sm text-gray-400">Digite o valor bruto da compra e confirme após receber o pagamento.</p>

      {data?.length ? (
        <div className="mt-5 space-y-4" data-testid="pending-list">
          {data.map((t) => {
            const c = calc(t, amounts[t.id]);
            return (
              <div key={t.id} className="off-card p-5" data-testid={`pending-${t.id}`}>
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 overflow-hidden rounded-full off-gradient">
                    {t.consumer_photo ? <img alt="" src={fileUrl(t.consumer_photo)} className="h-full w-full object-cover" /> :
                      <div className="flex h-full w-full items-center justify-center font-bold text-white">{(t.consumer_name || "?")[0]}</div>}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-white">{t.consumer_name}</p>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-off-success"><ShieldCheck className="h-3 w-3" /> Assinante ativo · {t.discount_percent}%</span>
                  </div>
                  <div className="text-right">
                    <span className="flex items-center justify-end gap-1 text-xs text-off-warning"><Clock className="h-3 w-3" /> {fmtDate(t.created_at)}</span>
                    <p className="mt-0.5 font-mono text-xs text-gray-400">{t.transaction_code}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="text-xs text-gray-400">Valor bruto da compra (R$)</label>
                  <div className="mt-1 flex items-center rounded-xl border border-off-blue/40 bg-off-bg px-3">
                    <span className="text-sm font-bold text-gray-400">R$</span>
                    <Input data-testid={`amount-${t.id}`} inputMode="decimal" value={amounts[t.id] || ""} onChange={(e) => setAmounts({ ...amounts, [t.id]: e.target.value })} placeholder="0,00" className="h-12 border-0 bg-transparent text-lg font-bold text-white focus-visible:ring-0" />
                  </div>
                  {t.discount_min_purchase ? <p className="mt-1 text-[11px] text-gray-500">Compra mínima para o desconto: {money(t.discount_min_purchase)}</p> : null}
                </div>

                {c.gross > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-off-bg/60 p-3 text-center">
                    <div><p className="text-[11px] text-gray-500">Valor</p><p className="font-bold text-white">{money(c.gross)}</p></div>
                    <div><p className="text-[11px] text-gray-500">Desconto</p><p className="font-bold text-off-orange">{money(c.discount)}</p></div>
                    <div><p className="text-[11px] text-gray-500">Final</p><p className="font-bold text-white">{money(c.final)}</p></div>
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Button data-testid={`confirm-${t.id}`} disabled={busy === t.id} onClick={() => confirm(t)} className="h-12 rounded-xl bg-off-success font-semibold text-white hover:bg-off-success/90"><CheckCircle2 className="mr-2 h-5 w-5" /> Confirmar transação</Button>
                  <Button data-testid={`reject-${t.id}`} disabled={busy === t.id} onClick={() => reject(t)} variant="outline" className="h-12 rounded-xl border-off-error/50 text-off-error hover:bg-off-error/10"><XCircle className="mr-2 h-5 w-5" /> Recusar</Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="mt-8"><EmptyState icon={Inbox} title="Nenhuma validação pendente" subtitle="As leituras dos clientes aparecerão aqui em tempo real." /></div>}
    </div>
  );
}
