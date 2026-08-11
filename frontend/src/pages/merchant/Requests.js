import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading, EmptyState, fmtDate, fmtDesired, money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Inbox, Check, X, MessageSquare, CheckCircle2, Search } from "lucide-react";
import { STATUS_META, MERCHANT_STEPS, SERVICE_TYPES, SERVICE_LABEL } from "@/lib/requests";

function Pill({ status }) {
  const m = STATUS_META[status] || { label: status, cls: "text-gray-300 bg-white/10" };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

export default function Requests() {
  const { selectedId } = useOutletContext();
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [confirmReq, setConfirmReq] = useState(null);
  const [respondReq, setRespondReq] = useState(null);
  const [amount, setAmount] = useState("");
  const [respText, setRespText] = useState("");
  const [busy, setBusy] = useState(false);

  const params = { establishment_id: selectedId || "all" };
  if (status !== "all") params.status = status;
  if (type !== "all") params.type = type;
  if (q) params.q = q;
  const { data, isLoading } = useQuery({ queryKey: ["m-requests", params], queryFn: async () => (await api.get("/merchant/requests", { params })).data });

  const refresh = () => qc.invalidateQueries({ queryKey: ["m-requests"] });
  const act = async (fn) => { setBusy(true); try { await fn(); refresh(); } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); } };

  const accept = (r) => act(async () => { await api.post(`/merchant/requests/${r.id}/accept`); toast.success("Solicitação aceita"); });
  const reject = (r) => act(async () => { await api.post(`/merchant/requests/${r.id}/reject`); toast.success("Solicitação recusada"); });
  const setStep = (r, s) => act(async () => { await api.post(`/merchant/requests/${r.id}/status`, { status: s }); toast.success("Status atualizado"); });

  const openConfirm = (r) => { setConfirmReq(r); setAmount(""); };
  const doConfirm = async () => {
    setBusy(true);
    try {
      const payload = confirmReq.discount_applies ? { gross_amount: parseFloat(String(amount).replace(",", ".")) } : {};
      await api.post(`/merchant/requests/${confirmReq.id}/confirm`, payload);
      toast.success("Atendimento confirmado. Desconto registrado.");
      setConfirmReq(null); refresh();
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };
  const doRespond = async () => {
    setBusy(true);
    try { await api.post(`/merchant/requests/${respondReq.id}/respond`, { message: respText }); toast.success("Resposta enviada"); setRespondReq(null); setRespText(""); refresh(); }
    catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  const done = (s) => ["completed", "cancelled", "rejected", "expired"].includes(s);

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Solicitações</h1>
      <p className="text-sm text-gray-400">Agendamentos, reservas, orçamentos, entregas, retiradas e encomendas.</p>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" /><Input data-testid="req-search" value={q} onChange={(e) => setQ(e.target.value)} className="off-input pl-9" placeholder="Buscar por cliente ou código" /></div>
        <Select value={status} onValueChange={setStatus}><SelectTrigger data-testid="req-filter-status" className="off-input"><SelectValue /></SelectTrigger>
          <SelectContent className="border-off-blue/40 bg-off-surface text-white"><SelectItem value="all">Todos os status</SelectItem>{Object.entries(STATUS_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}</SelectContent></Select>
        <Select value={type} onValueChange={setType}><SelectTrigger data-testid="req-filter-type" className="off-input"><SelectValue /></SelectTrigger>
          <SelectContent className="border-off-blue/40 bg-off-surface text-white"><SelectItem value="all">Todos os tipos</SelectItem>{SERVICE_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
      </div>

      {isLoading ? <Loading /> : (data?.length ? (
        <div className="mt-4 space-y-3" data-testid="m-requests-list">
          {data.map((r) => (
            <div key={r.id} className="off-card p-4" data-testid={`req-card-${r.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-white">{r.consumer_name} <span className="ml-1 text-xs font-normal text-gray-500">{r.code}</span></p>
                  <p className="text-xs text-gray-400">{SERVICE_LABEL[r.request_type] || r.request_type} · {r.establishment_name} · {fmtDate(r.created_at)}</p>
                </div>
                <Pill status={r.status} />
              </div>
              <div className="mt-2 space-y-0.5 text-sm text-gray-300">
                {r.product_service && <p>Produto/Serviço: <span className="text-white">{r.product_service}</span></p>}
                {(r.desired_date || r.desired_time) && <p>Desejado: {fmtDesired(r.desired_date, r.desired_time)}</p>}
                {r.address && <p>Endereço: {r.address}</p>}
                {r.phone && <p>Contato: {r.phone}</p>}
                {r.message && <p className="text-gray-400">"{r.message}"</p>}
                {r.discount_applies && r.status !== "completed" && <p className="text-off-orange">Desconto previsto: {r.discount_percent}%{r.discount_valid_until ? ` · prazo: ${r.discount_valid_until}` : ""} — aplicado após a confirmação</p>}
                {r.status === "completed" && r.gross_amount != null && <p className="text-off-success">Desconto aplicado: registrado {money(r.gross_amount)} → economia {money(r.saved_amount)} · paga {money(r.final_amount)}</p>}
              </div>

              {!done(r.status) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.status === "awaiting" && <>
                    <Button data-testid={`req-accept-${r.id}`} size="sm" onClick={() => accept(r)} disabled={busy} className="rounded-lg bg-off-success text-white"><Check className="mr-1 h-4 w-4" /> Aceitar</Button>
                    <Button data-testid={`req-reject-${r.id}`} size="sm" variant="outline" onClick={() => reject(r)} disabled={busy} className="rounded-lg border-off-error/50 text-off-error"><X className="mr-1 h-4 w-4" /> Recusar</Button>
                  </>}
                  {r.status !== "awaiting" && (
                    <Select onValueChange={(s) => setStep(r, s)}>
                      <SelectTrigger className="h-9 w-48 rounded-lg border-off-blue/40 bg-off-bg text-sm text-white"><SelectValue placeholder="Atualizar status" /></SelectTrigger>
                      <SelectContent className="border-off-blue/40 bg-off-surface text-white">{MERCHANT_STEPS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <Button size="sm" variant="outline" onClick={() => { setRespondReq(r); setRespText(r.merchant_response || ""); }} className="rounded-lg border-off-blue/40 text-white"><MessageSquare className="mr-1 h-4 w-4" /> Responder</Button>
                  {r.status !== "awaiting" && <Button data-testid={`req-confirm-${r.id}`} size="sm" onClick={() => openConfirm(r)} disabled={busy} className="rounded-lg off-gradient text-white"><CheckCircle2 className="mr-1 h-4 w-4" /> Confirmar atendimento</Button>}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : <div className="mt-6" data-testid="m-requests-list"><EmptyState icon={Inbox} title="Nenhuma solicitação" subtitle="As solicitações dos consumidores aparecerão aqui." /></div>)}

      {/* Confirmar atendimento */}
      <Dialog open={!!confirmReq} onOpenChange={(v) => !v && setConfirmReq(null)}>
        <DialogContent className="max-w-sm border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle>Confirmar atendimento</DialogTitle></DialogHeader>
          {confirmReq && (
            <div className="space-y-3">
              <p className="text-sm text-gray-300">Confirma a conclusão de <b className="text-white">{confirmReq.code}</b> de {confirmReq.consumer_name}?</p>
              {confirmReq.discount_applies ? (
                <div>
                  <Label className="text-gray-300">Valor total da compra (R$)</Label>
                  <Input data-testid="req-confirm-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="off-input mt-1" placeholder="0,00" />
                  <p className="mt-1 text-[11px] text-gray-500">O desconto de {confirmReq.discount_percent}% será calculado e registrado.</p>
                </div>
              ) : <p className="text-xs text-gray-500">Esta modalidade não aplica desconto — apenas conclui a solicitação.</p>}
              <Button data-testid="req-confirm-submit" onClick={doConfirm} disabled={busy} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">{busy ? "Confirmando..." : "Confirmar e concluir"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Responder */}
      <Dialog open={!!respondReq} onOpenChange={(v) => !v && setRespondReq(null)}>
        <DialogContent className="max-w-sm border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle>Responder ao cliente</DialogTitle></DialogHeader>
          <Textarea value={respText} onChange={(e) => setRespText(e.target.value)} className="border-off-blue/40 bg-off-bg text-white" placeholder="Digite sua resposta" />
          <Button onClick={doRespond} disabled={busy || !respText} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">{busy ? "Enviando..." : "Enviar resposta"}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
