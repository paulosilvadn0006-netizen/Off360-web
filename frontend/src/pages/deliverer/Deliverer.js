import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Package, Bike, History, Wallet, CheckCircle2 } from "lucide-react";

const TABS = [
  { k: "new", label: "Nova entrega", icon: Package },
  { k: "active", label: "Em andamento", icon: Bike },
  { k: "history", label: "Histórico", icon: History },
  { k: "earn", label: "Meus ganhos", icon: Wallet },
];
const money = (v) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

export default function Deliverer() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("new");
  const [startOrder, setStartOrder] = useState(null);
  const [amount, setAmount] = useState("");
  const [earning, setEarning] = useState("");
  const [codeById, setCodeById] = useState({});

  const available = useQuery({ queryKey: ["d-available"], queryFn: async () => (await api.get("/deliverer/orders/available")).data, refetchInterval: 6000, enabled: tab === "new" });
  const active = useQuery({ queryKey: ["d-active"], queryFn: async () => (await api.get("/deliverer/orders?scope=active")).data, refetchInterval: 5000, enabled: tab === "active" });
  const history = useQuery({ queryKey: ["d-history"], queryFn: async () => (await api.get("/deliverer/orders?scope=history")).data, enabled: tab === "history" });
  const metrics = useQuery({ queryKey: ["d-metrics"], queryFn: async () => (await api.get("/deliverer/metrics")).data, enabled: tab === "earn" });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["d-available"] }); qc.invalidateQueries({ queryKey: ["d-active"] }); qc.invalidateQueries({ queryKey: ["d-history"] }); qc.invalidateQueries({ queryKey: ["d-metrics"] }); };

  const doStart = async () => {
    const oa = parseFloat(String(amount).replace(",", ".")); const er = parseFloat(String(earning).replace(",", "."));
    if (!(oa > 0) || !(er >= 0)) { toast.error("Informe valores válidos"); return; }
    try { await api.post(`/deliverer/orders/${startOrder.id}/start`, { order_amount: oa, earning: er }); toast.success("Entrega iniciada"); setStartOrder(null); setAmount(""); setEarning(""); setTab("active"); refresh(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const doArrive = async (id) => { try { await api.post(`/deliverer/orders/${id}/arrived`); toast.success("Cliente avisado"); refresh(); } catch (err) { toast.error(formatApiError(err)); } };
  const doValidate = async (id) => {
    const code = (codeById[id] || "").trim(); if (!code) { toast.error("Digite o código do consumidor"); return; }
    try { await api.post(`/deliverer/orders/${id}/validate-code`, { code }); toast.success("Entrega concluída!"); refresh(); } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-4 grid grid-cols-4 gap-1.5 rounded-2xl bg-off-surface p-1.5" data-testid="deliverer-tabs">
        {TABS.map((t) => (
          <button key={t.k} data-testid={`d-tab-${t.k}`} onClick={() => setTab(t.k)}
            className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors ${tab === t.k ? "off-gradient text-white" : "text-gray-400"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === "new" && (
        <div className="space-y-3" data-testid="d-list-new">
          {(available.data || []).length === 0 && <Empty text="Nenhuma entrega disponível no momento." />}
          {(available.data || []).map((o) => (
            <Card key={o.id} o={o}>
              <Button data-testid={`d-start-${o.id}`} onClick={() => { setStartOrder(o); }} className="h-10 w-full rounded-xl off-gradient font-semibold text-white">Iniciar entrega</Button>
            </Card>
          ))}
        </div>
      )}

      {tab === "active" && (
        <div className="space-y-3" data-testid="d-list-active">
          {(active.data || []).length === 0 && <Empty text="Nenhuma entrega em andamento." />}
          {(active.data || []).map((o) => (
            <Card key={o.id} o={o} showEarning>
              {o.status === "on_the_way" && (
                <Button data-testid={`d-arrive-${o.id}`} onClick={() => doArrive(o.id)} className="h-14 w-full rounded-xl bg-off-error text-lg font-bold text-white">CHEGUEI COM OFF360</Button>
              )}
              {o.status === "arrived" && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-300">Confirme pelo código do consumidor (uso único):</p>
                  <div className="flex gap-2">
                    <Input data-testid={`d-code-${o.id}`} value={codeById[o.id] || ""} onChange={(e) => setCodeById((s) => ({ ...s, [o.id]: e.target.value }))} placeholder="OFF-XXXX" className="off-input uppercase" />
                    <Button data-testid={`d-validate-${o.id}`} onClick={() => doValidate(o.id)} className="rounded-xl off-gradient font-semibold text-white"><CheckCircle2 className="h-4 w-4" /></Button>
                  </div>
                  <p className="text-[11px] text-gray-500">Ou peça ao consumidor para confirmar pelo QR no app dele.</p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-3" data-testid="d-list-history">
          {(history.data || []).length === 0 && <Empty text="Sem entregas no histórico." />}
          {(history.data || []).map((o) => <Card key={o.id} o={o} showEarning />)}
        </div>
      )}

      {tab === "earn" && metrics.data && (
        <div className="space-y-4" data-testid="d-earnings">
          {["today", "month", "all"].map((k) => (
            <div key={k} className="off-card p-4">
              <p className="text-xs font-semibold uppercase text-gray-400">{k === "today" ? "Hoje" : k === "month" ? "Este mês" : "Total"}</p>
              <div className="mt-2 flex items-center justify-between">
                <div><p className="text-2xl font-bold text-white" data-testid={`earn-count-${k}`}>{metrics.data[k].count}</p><p className="text-[11px] text-gray-400">entregas concluídas</p></div>
                <div className="text-right"><p className="text-2xl font-bold text-off-success" data-testid={`earn-value-${k}`}>{money(metrics.data[k].earnings)}</p><p className="text-[11px] text-gray-400">meus ganhos</p></div>
              </div>
              <p className="mt-2 border-t border-off-blue/20 pt-2 text-[11px] text-gray-500">Valor dos pedidos entregues (faturamento do estabelecimento, não é seu): {money(metrics.data[k].orders_total)}</p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!startOrder} onOpenChange={(v) => { if (!v) setStartOrder(null); }}>
        <DialogContent className="max-w-sm border-off-blue/40 bg-off-surface text-white" data-testid="d-start-dialog">
          <DialogHeader><DialogTitle>Iniciar entrega</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-300">{startOrder?.establishment_name}</p>
          <div className="mt-2 space-y-3">
            <div><label className="text-xs text-gray-400">Valor do pedido (R$)</label><Input data-testid="d-start-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="off-input" placeholder="Ex: 80,00" /></div>
            <div><label className="text-xs text-gray-400">Quanto você receberá por esta entrega (R$)</label><Input data-testid="d-start-earning" value={earning} onChange={(e) => setEarning(e.target.value)} inputMode="decimal" className="off-input" placeholder="Ex: 8,00" /><p className="mt-1 text-[11px] text-gray-500">Controle financeiro seu. Não altera o pedido nem o desconto do consumidor.</p></div>
            <Button data-testid="d-start-confirm" onClick={doStart} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">Confirmar e sair para entrega</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ o, children, showEarning }) {
  const money2 = (v) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
  return (
    <div className="off-card p-4" data-testid={`d-order-${o.id}`}>
      <div className="flex items-center justify-between">
        <p className="font-semibold text-white">{o.establishment_name}</p>
        <span className="text-[11px] text-gray-400">{o.mode === "delivery" ? "Entrega" : "Retirada"} · {o.code}</span>
      </div>
      {o.order_amount != null && <p className="text-xs text-gray-300">Pedido: {money2(o.order_amount)}</p>}
      {showEarning && o.deliverer_earning != null && <p className="text-xs text-off-success">Seu ganho: {money2(o.deliverer_earning)}</p>}
      {o.status === "delivered" && <p className="text-[11px] text-gray-500">Concluída</p>}
      {o.status === "cancelled" && <p className="text-[11px] text-off-error">Cancelada</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
function Empty({ text }) { return <div className="off-card p-8 text-center text-sm text-gray-400" data-testid="d-empty">{text}</div>; }
