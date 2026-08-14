import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Package, Bike, Copy, Check, X, Users } from "lucide-react";

const STATUS = {
  new: { label: "Novo", color: "#9ca3af", blink: false },
  preparing: { label: "Em preparo", color: "#facc15", blink: true },
  ready: { label: "Pronto", color: "#fb923c", blink: true },
  on_the_way: { label: "A caminho", color: "#22c55e", blink: true },
  arrived: { label: "Chegou", color: "#ef4444", blink: true },
  delivered: { label: "Entregue", color: "#374151", blink: false },
  cancelled: { label: "Cancelado", color: "#6b7280", blink: false },
};
const money = (v) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

export default function Orders() {
  const { selectedId, establishments } = useOutletContext();
  const qc = useQueryClient();
  const [cancel, setCancel] = useState(null);
  const [reason, setReason] = useState("");
  const [amtById, setAmtById] = useState({});
  const [codeById, setCodeById] = useState({});
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState({ consumer_identifier: "", order_amount: "", mode: "delivery", offer_scope: "external" });
  const [copied, setCopied] = useState(false);

  const eff = (selectedId && selectedId !== "all") ? selectedId : establishments?.[0]?.id;
  const { data } = useQuery({ queryKey: ["m-orders", selectedId], queryFn: async () => (await api.get("/merchant/orders", { params: { establishment_id: selectedId } })).data, refetchInterval: 5000 });
  const dlv = useQuery({ enabled: !!eff, queryKey: ["m-deliverers", eff], queryFn: async () => (await api.get("/merchant/deliverers", { params: { establishment_id: eff } })).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ["m-orders"] });
  const refreshDlv = () => qc.invalidateQueries({ queryKey: ["m-deliverers"] });

  const copyCode = () => { const c = dlv.data?.link_code; if (!c) return; navigator.clipboard?.writeText(c); setCopied(true); toast.success("Código copiado"); setTimeout(() => setCopied(false), 1500); };
  const linkAct = async (linkId, action) => {
    try { await api.post(`/merchant/deliverer-links/${linkId}/${action}`); toast.success(action === "approve" ? "Entregador aprovado" : "Solicitação recusada"); refreshDlv(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const act = async (id, path, body) => {
    try { await api.post(`/merchant/orders/${id}/${path}`, body || {}); refresh(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const doReady = async (o) => { const a = amtById[o.id]; await act(o.id, "ready", a ? { order_amount: parseFloat(String(a).replace(",", ".")) } : {}); };
  const doValidate = async (o) => {
    const code = (codeById[o.id] || "").trim(); const a = amtById[o.id];
    if (!code) { toast.error("Informe o código do consumidor"); return; }
    if (!a) { toast.error("Informe o valor do pedido"); return; }
    try { await api.post(`/merchant/orders/${o.id}/validate-code`, { code, order_amount: parseFloat(String(a).replace(",", ".")) }); toast.success("Retirada concluída!"); refresh(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const doCancel = async () => { if (!reason.trim()) { toast.error("Informe o motivo"); return; } await act(cancel.id, "cancel", { reason }); setCancel(null); setReason(""); toast.success("Pedido cancelado"); };
  const createNew = async () => {
    const amount = parseFloat(String(nf.order_amount).replace(",", "."));
    if (!nf.consumer_identifier.trim()) { toast.error("Informe o e-mail/WhatsApp do consumidor"); return; }
    if (!(amount > 0)) { toast.error("Informe o valor do pedido"); return; }
    const eid = eff;
    if (!eid) { toast.error("Selecione um estabelecimento"); return; }
    try {
      const { data } = await api.post("/merchant/orders", { establishment_id: eid, consumer_identifier: nf.consumer_identifier.trim(), order_amount: amount, mode: nf.mode, offer_scope: nf.mode === "delivery" ? nf.offer_scope : "external" });
      toast.success(nf.mode === "delivery" ? "Entrega criada e enviada aos entregadores!" : "Retirada criada!");
      setNewOpen(false); setNf({ consumer_identifier: "", order_amount: "", mode: "delivery", offer_scope: "external" }); refresh();
      return data;
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const orders = data || [];
  return (
    <div className="animate-fade-up" data-testid="merchant-orders">
      <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2"><Package className="h-6 w-6 text-off-orange" /> Pedidos OFF360</h1>
      <p className="text-sm text-gray-400">Entrega e retirada. O pagamento é feito diretamente ao estabelecimento.</p>
      <Button data-testid="m-new-order-btn" onClick={() => setNewOpen(true)} className="mt-3 h-11 w-full rounded-xl off-gradient font-semibold text-white">+ Nova entrega OFF360</Button>

      {/* ==================== MEUS ENTREGADORES ==================== */}
      <div className="mt-5 off-card p-4" data-testid="m-deliverers-section">
        <div className="flex items-center gap-2"><Users className="h-5 w-5 text-off-orange" /><p className="font-display text-sm font-bold tracking-wide text-off-orange">MEUS ENTREGADORES</p></div>
        <p className="mt-1 text-[11px] text-gray-500">Entregadores vinculados recebem suas entregas próprias. Compartilhe o código abaixo com quem você quer na sua frota.</p>

        <div className="mt-3 rounded-xl border border-off-blue/40 bg-off-bg/40 p-3">
          <p className="text-[11px] text-gray-400">Código de vínculo do estabelecimento</p>
          <div className="mt-1 flex items-center gap-2">
            <span data-testid="m-link-code" className="font-display text-2xl font-bold tracking-widest text-white">{dlv.data?.link_code || "----"}</span>
            <Button data-testid="m-link-code-copy" onClick={copyCode} variant="outline" size="sm" className="rounded-lg border-off-blue/40 text-gray-200">{copied ? <Check className="h-4 w-4 text-off-success" /> : <Copy className="h-4 w-4" />}</Button>
          </div>
        </div>

        {(dlv.data?.pending || []).length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase text-off-warning">Solicitações pendentes</p>
            <div className="mt-2 space-y-2">
              {(dlv.data.pending).map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg bg-off-bg/60 px-3 py-2" data-testid={`m-link-pending-${l.id}`}>
                  <span className="text-sm text-white">{l.deliverer_name}</span>
                  <div className="flex gap-2">
                    <Button data-testid={`m-link-approve-${l.id}`} onClick={() => linkAct(l.id, "approve")} size="sm" className="rounded-lg off-gradient font-semibold text-white"><Check className="h-4 w-4" /></Button>
                    <Button data-testid={`m-link-reject-${l.id}`} onClick={() => linkAct(l.id, "reject")} size="sm" variant="outline" className="rounded-lg border-off-error/50 text-off-error"><X className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3">
          <p className="text-xs font-semibold uppercase text-gray-400">Entregadores vinculados</p>
          {(dlv.data?.active || []).length === 0 ? (
            <p className="mt-1 text-[11px] text-gray-500" data-testid="m-deliverers-empty">Nenhum entregador vinculado ainda.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {(dlv.data.active).map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg bg-off-bg/60 px-3 py-2" data-testid={`m-link-active-${l.id}`}>
                  <span className="flex items-center gap-2 text-sm text-white"><Bike className="h-4 w-4 text-off-success" /> {l.deliverer_name}</span>
                  <span className="rounded-full bg-off-success/15 px-2.5 py-1 text-[11px] font-semibold text-off-success">Ativo</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {orders.length === 0 && <div className="off-card p-8 text-center text-sm text-gray-400" data-testid="m-orders-empty">Nenhum pedido ainda.</div>}
        {orders.map((o) => {
          const m = STATUS[o.status] || STATUS.new;
          return (
            <div key={o.id} className="off-card p-4" data-testid={`m-order-${o.id}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={m.blink ? "off-blink" : ""} style={{ width: 12, height: 12, borderRadius: 9999, background: m.color }} />
                  <span className="font-semibold text-white" data-testid={`m-order-status-${o.id}`}>{m.label}</span>
                </div>
                <span className="text-[11px] text-gray-400">{o.mode === "delivery" ? "Entrega" : "Retirada"} · Pedido nº {o.number || "----"}</span>
              </div>
              <p className="mt-1 text-sm text-gray-200">{o.consumer_name}</p>
              {o.payment_method && <p className="text-[11px] text-gray-400">Pagamento: {o.payment_method}{o.needs_change && o.change_for ? ` · troco p/ ${money(o.change_for)}` : ""}</p>}
              {o.final_amount != null && <p className="text-[11px] text-off-success">Venda: {money(o.final_amount)} · desconto {money(o.discount_amount)}</p>}

              <div className="mt-3 flex flex-wrap gap-2">
                {o.status === "new" && <Button data-testid={`m-startprep-${o.id}`} onClick={() => act(o.id, "start-prep")} className="rounded-xl off-gradient font-semibold text-white">Iniciar preparo</Button>}
                {o.status === "preparing" && (
                  <div className="flex w-full flex-wrap items-center gap-2">
                    {o.mode === "pickup" && <Input data-testid={`m-amt-${o.id}`} value={amtById[o.id] || ""} onChange={(e) => setAmtById((s) => ({ ...s, [o.id]: e.target.value }))} placeholder="Valor do pedido (R$)" className="off-input w-44" />}
                    <Button data-testid={`m-ready-${o.id}`} onClick={() => doReady(o)} className="rounded-xl off-gradient font-semibold text-white">Pedido pronto</Button>
                  </div>
                )}
                {o.status === "ready" && o.mode === "delivery" && <Button data-testid={`m-otw-${o.id}`} onClick={() => act(o.id, "on-the-way")} className="rounded-xl off-gradient font-semibold text-white">Marcar a caminho</Button>}
                {o.status === "ready" && o.mode === "pickup" && (
                  <div className="flex w-full flex-wrap items-center gap-2">
                    <Input data-testid={`m-amt2-${o.id}`} value={amtById[o.id] || (o.order_amount ?? "")} onChange={(e) => setAmtById((s) => ({ ...s, [o.id]: e.target.value }))} placeholder="Valor (R$)" className="off-input w-32" />
                    <Input data-testid={`m-code-${o.id}`} value={codeById[o.id] || ""} onChange={(e) => setCodeById((s) => ({ ...s, [o.id]: e.target.value }))} placeholder="Código do cliente" className="off-input w-40 uppercase" />
                    <Button data-testid={`m-validate-${o.id}`} onClick={() => doValidate(o)} className="rounded-xl off-gradient font-semibold text-white">Validar retirada</Button>
                  </div>
                )}
                {!["delivered", "cancelled"].includes(o.status) && (
                  <Button data-testid={`m-cancel-${o.id}`} variant="outline" onClick={() => setCancel(o)} className="rounded-xl border-off-error/50 text-off-error">Cancelar</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-sm border-off-blue/40 bg-off-surface text-white" data-testid="m-new-order-dialog">
          <DialogHeader><DialogTitle>+ Nova entrega OFF360</DialogTitle></DialogHeader>
          <p className="-mt-1 text-[11px] text-gray-400">Crie o pedido após fechar pelo WhatsApp. O entregador informará o próprio ganho ao assumir a entrega.</p>
          <div className="mt-1 space-y-3">
            <div>
              <label className="text-xs text-gray-400">Consumidor (e-mail ou WhatsApp)</label>
              <Input data-testid="m-new-consumer" value={nf.consumer_identifier} onChange={(e) => setNf({ ...nf, consumer_identifier: e.target.value })} className="off-input" placeholder="cliente@email.com ou (11)99999-9999" />
            </div>
            <div>
              <label className="text-xs text-gray-400">Valor final do pedido (R$)</label>
              <Input data-testid="m-new-amount" value={nf.order_amount} onChange={(e) => setNf({ ...nf, order_amount: e.target.value })} inputMode="decimal" className="off-input" placeholder="Ex: 80,00" />
            </div>
            <div>
              <label className="text-xs text-gray-400">Tipo</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button type="button" data-testid="m-new-mode-delivery" onClick={() => setNf({ ...nf, mode: "delivery" })} className={`rounded-xl py-2.5 text-sm font-semibold ${nf.mode === "delivery" ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>Entrega</button>
                <button type="button" data-testid="m-new-mode-pickup" onClick={() => setNf({ ...nf, mode: "pickup" })} className={`rounded-xl py-2.5 text-sm font-semibold ${nf.mode === "pickup" ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>Retirada</button>
              </div>
            </div>
            {nf.mode === "delivery" && (
              <div data-testid="m-new-scope">
                <label className="text-xs text-gray-400">Enviar para quais entregadores?</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button type="button" data-testid="m-new-scope-own" onClick={() => setNf({ ...nf, offer_scope: "own" })} className={`rounded-xl py-2.5 text-xs font-semibold ${nf.offer_scope === "own" ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>Meus vinculados</button>
                  <button type="button" data-testid="m-new-scope-external" onClick={() => setNf({ ...nf, offer_scope: "external" })} className={`rounded-xl py-2.5 text-xs font-semibold ${nf.offer_scope === "external" ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>Independentes</button>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">{nf.offer_scope === "own" ? "Só entregadores vinculados ao seu estabelecimento verão esta oferta." : "Entregadores independentes da região verão esta oferta."}</p>
              </div>
            )}
            <Button data-testid="m-new-create" onClick={createNew} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">Criar {nf.mode === "delivery" ? "entrega" : "retirada"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancel} onOpenChange={(v) => { if (!v) setCancel(null); }}>
        <DialogContent className="max-w-sm border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle>Cancelar pedido</DialogTitle></DialogHeader>
          <Input data-testid="m-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo do cancelamento" className="off-input" />
          <Button data-testid="m-cancel-confirm" onClick={doCancel} className="mt-2 h-11 w-full rounded-xl bg-off-error font-semibold text-white">Confirmar cancelamento</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
