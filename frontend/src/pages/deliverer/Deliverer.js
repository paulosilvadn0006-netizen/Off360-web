import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Package, Bike, History, Wallet, CheckCircle2, Link2, X, Bell, BellOff, VolumeX, Car } from "lucide-react";
import * as alertSound from "@/lib/deliveryAlert";
import TaxiDriver from "@/components/deliverer/TaxiDriver";

const TABS = [
  { k: "new", label: "Nova entrega", icon: Package },
  { k: "active", label: "Em andamento", icon: Bike },
  { k: "history", label: "Histórico", icon: History },
  { k: "earn", label: "Ganhos", icon: Wallet },
  { k: "links", label: "Vínculos", icon: Link2 },
];
const money = (v) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
const SOUND_KEY = "off360_deliverer_sound";

export default function Deliverer() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("new");
  const [mode, setMode] = useState("delivery"); // "delivery" | "taxi"
  const [startOrder, setStartOrder] = useState(null);
  const [amount, setAmount] = useState("");
  const [earning, setEarning] = useState("");
  const [codeById, setCodeById] = useState({});
  const [linkCode, setLinkCode] = useState("");
  const [linking, setLinking] = useState(false);

  // ---- alerta sonoro ----
  const [soundOn, setSoundOn] = useState(false);   // áudio liberado pelo navegador
  const [playing, setPlaying] = useState(false);   // alerta tocando agora
  const mutedIdsRef = useRef(new Set());           // ofertas silenciadas via "Parar som"

  const available = useQuery({ queryKey: ["d-available"], queryFn: async () => (await api.get("/deliverer/orders/available")).data, refetchInterval: 6000 });
  const active = useQuery({ queryKey: ["d-active"], queryFn: async () => (await api.get("/deliverer/orders?scope=active")).data, refetchInterval: 5000, enabled: tab === "active" });
  const history = useQuery({ queryKey: ["d-history"], queryFn: async () => (await api.get("/deliverer/orders?scope=history")).data, enabled: tab === "history" });
  const metrics = useQuery({ queryKey: ["d-metrics"], queryFn: async () => (await api.get("/deliverer/metrics")).data, enabled: tab === "earn" });
  const links = useQuery({ queryKey: ["d-links"], queryFn: async () => (await api.get("/deliverer/links")).data, enabled: tab === "links" });

  const refresh = () => { ["d-available", "d-active", "d-history", "d-metrics", "d-links"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };

  const offers = available.data || [];
  const offerIds = offers.map((o) => o.id);

  // libera áudio na 1ª interação (respeitando preferência salva)
  const enableSound = async () => {
    const ok = await alertSound.unlock();
    setSoundOn(ok);
    if (ok) { localStorage.setItem(SOUND_KEY, "1"); toast.success("Alertas sonoros ativados"); }
    else toast.error("Seu navegador bloqueou o áudio. Toque novamente para ativar.");
  };
  const stopSound = () => { alertSound.stop(); setPlaying(false); mutedIdsRef.current = new Set(offerIds); };

  // tenta reativar se o usuário já havia ativado antes (pode exigir novo gesto)
  useEffect(() => {
    if (localStorage.getItem(SOUND_KEY) === "1") {
      alertSound.unlock().then((ok) => setSoundOn(ok));
    }
  }, []);

  // controlador único: liga/desliga o loop conforme ofertas elegíveis pendentes
  useEffect(() => {
    // limpa ofertas silenciadas que já não existem mais
    mutedIdsRef.current = new Set([...mutedIdsRef.current].filter((id) => offerIds.includes(id)));
    const pendingNotMuted = offerIds.filter((id) => !mutedIdsRef.current.has(id));
    if (soundOn && pendingNotMuted.length > 0) {
      alertSound.start();
      setPlaying(alertSound.isPlaying());
    } else {
      alertSound.stop();
      setPlaying(false);
    }
  }, [soundOn, offerIds.join(",")]); // eslint-disable-line

  // para o som ao desmontar a área do entregador
  useEffect(() => () => { alertSound.stop(); }, []);

  const doAccept = async (id) => {
    alertSound.stop(); setPlaying(false);
    try {
      await api.post(`/deliverer/orders/${id}/accept`);
      toast.success("Entrega aceita! Confira em 'Em andamento'.");
      setTab("active"); refresh();
    } catch (err) {
      if (err?.response?.status === 409) toast.error("Esta entrega já foi aceita por outro entregador.");
      else toast.error(formatApiError(err));
      mutedIdsRef.current.add(id); // não reinicia o som para esta oferta encerrada
      qc.invalidateQueries({ queryKey: ["d-available"] });
    }
  };
  const doReject = async (id) => {
    alertSound.stop(); setPlaying(false);
    mutedIdsRef.current.add(id);
    try { await api.post(`/deliverer/orders/${id}/reject`); toast("Oferta recusada."); qc.invalidateQueries({ queryKey: ["d-available"] }); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const doStart = async () => {
    const oa = parseFloat(String(amount).replace(",", ".")); const er = parseFloat(String(earning).replace(",", "."));
    if (!(oa > 0) || !(er >= 0)) { toast.error("Informe valores válidos"); return; }
    try { await api.post(`/deliverer/orders/${startOrder.id}/start`, { order_amount: oa, earning: er }); toast.success("Entrega iniciada"); setStartOrder(null); setAmount(""); setEarning(""); setTab("active"); refresh(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const doStartDirect = async (o) => {
    try { await api.post(`/deliverer/orders/${o.id}/start`, {}); toast.success("Entrega iniciada"); setTab("active"); refresh(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const doArrive = async (id) => { try { await api.post(`/deliverer/orders/${id}/arrived`); toast.success("Cliente avisado"); refresh(); } catch (err) { toast.error(formatApiError(err)); } };
  const doValidate = async (id) => {
    const code = (codeById[id] || "").trim(); if (!code) { toast.error("Digite o código do consumidor"); return; }
    try { await api.post(`/deliverer/orders/${id}/validate-code`, { code }); toast.success("Entrega concluída!"); refresh(); } catch (err) { toast.error(formatApiError(err)); }
  };
  const requestLink = async () => {
    const code = linkCode.trim(); if (!code) { toast.error("Digite o código do estabelecimento"); return; }
    setLinking(true);
    try { await api.post("/deliverer/link", { code }); toast.success("Solicitação enviada! Aguarde a aprovação do estabelecimento."); setLinkCode(""); qc.invalidateQueries({ queryKey: ["d-links"] }); }
    catch (err) { toast.error(formatApiError(err)); }
    finally { setLinking(false); }
  };

  return (
    <div className="animate-fade-up">
      {/* Alternância de modo: Entregas x 360Taxi */}
      <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-off-surface p-1.5" data-testid="deliverer-mode">
        <button data-testid="mode-delivery" onClick={() => setMode("delivery")}
          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-colors ${mode === "delivery" ? "off-gradient text-white" : "text-gray-400"}`}>
          <span>🛵</span> Entregas
        </button>
        <button data-testid="mode-taxi" onClick={() => setMode("taxi")}
          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-colors ${mode === "taxi" ? "off-gradient text-white" : "text-gray-400"}`}>
          <span>🚗</span> 360Taxi
        </button>
      </div>

      {mode === "taxi" ? <TaxiDriver /> : (<>
      {/* Banner de nova entrega + controle de som */}
      {offers.length > 0 && (
        <div className="mb-3 rounded-2xl border border-off-orange/40 bg-off-orange/10 p-3" data-testid="d-new-offer-banner">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">🛵</span>
              <div>
                <p className="font-display text-sm font-bold text-off-orange">NOVA ENTREGA OFF360</p>
                <p className="text-[11px] text-gray-300" data-testid="d-offer-count">{offers.length} entrega(s) disponível(is) para você.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {tab !== "new" && <Button data-testid="d-goto-new" onClick={() => setTab("new")} size="sm" className="rounded-lg off-gradient font-semibold text-white">Ver</Button>}
              {playing && <Button data-testid="d-stop-sound" onClick={stopSound} size="sm" variant="outline" className="rounded-lg border-off-blue/40 text-gray-200"><VolumeX className="mr-1 h-4 w-4" /> Parar som</Button>}
            </div>
          </div>
        </div>
      )}

      {/* Ativar alertas sonoros (política de autoplay) */}
      {!soundOn && (
        <button data-testid="d-enable-sound" onClick={enableSound} className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-off-blue/40 bg-off-surface py-2.5 text-sm font-semibold text-gray-200">
          <Bell className="h-4 w-4 text-off-orange" /> 🔔 Ativar alertas sonoros
        </button>
      )}
      {soundOn && (
        <div className="mb-3 flex items-center justify-center gap-1.5 text-[11px] text-gray-500" data-testid="d-sound-active"><BellOff className="h-3.5 w-3.5" /> Alertas sonoros ativos neste dispositivo</div>
      )}

      <div className="mb-4 grid grid-cols-5 gap-1.5 rounded-2xl bg-off-surface p-1.5" data-testid="deliverer-tabs">
        {TABS.map((t) => (
          <button key={t.k} data-testid={`d-tab-${t.k}`} onClick={() => setTab(t.k)}
            className={`relative flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition-colors ${tab === t.k ? "off-gradient text-white" : "text-gray-400"}`}>
            <t.icon className="h-4 w-4" />{t.label}
            {t.k === "new" && offers.length > 0 && <span data-testid="d-new-badge" className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-off-error px-1 text-[9px] font-bold text-white">{offers.length}</span>}
          </button>
        ))}
      </div>

      {tab === "new" && (
        <div className="space-y-3" data-testid="d-list-new">
          {offers.length === 0 && <Empty text="Nenhuma entrega disponível no momento." />}
          {offers.map((o) => (
            <Card key={o.id} o={o} highlight>
              <div className="flex gap-2">
                <Button data-testid={`d-accept-${o.id}`} onClick={() => doAccept(o.id)} className="h-11 flex-1 rounded-xl off-gradient font-bold text-white">ACEITAR ENTREGA</Button>
                <Button data-testid={`d-reject-${o.id}`} variant="outline" onClick={() => doReject(o.id)} className="h-11 rounded-xl border-off-error/50 px-4 text-off-error"><X className="h-4 w-4" /> Recusar</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === "active" && (
        <div className="space-y-3" data-testid="d-list-active">
          {(active.data || []).length === 0 && <Empty text="Nenhuma entrega em andamento." />}
          {(active.data || []).map((o) => (
            <Card key={o.id} o={o} showEarning>
              {o.status === "ready" && (
                <Button data-testid={`d-start-${o.id}`} onClick={() => { if (o.deliverer_earning != null) doStartDirect(o); else setStartOrder(o); }} className="h-12 w-full rounded-xl off-gradient font-semibold text-white">Iniciar entrega{o.deliverer_earning != null ? ` · você recebe R$ ${Number(o.deliverer_earning).toFixed(2).replace(".", ",")}` : ""}</Button>
              )}
              {o.status === "on_the_way" && (
                <Button data-testid={`d-arrive-${o.id}`} onClick={() => doArrive(o.id)} className="h-14 w-full rounded-xl bg-off-error text-lg font-bold text-white">CHEGUEI COM OFF360</Button>
              )}
              {o.status === "arrived" && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-300">Confirme pelo código do consumidor (uso único):</p>
                  <div className="flex gap-2">
                    <Input data-testid={`d-code-${o.id}`} value={codeById[o.id] || ""} onChange={(e) => setCodeById((s) => ({ ...s, [o.id]: e.target.value }))} placeholder="0000" inputMode="numeric" maxLength={4} className="off-input" />
                    <Button data-testid={`d-validate-${o.id}`} onClick={() => doValidate(o.id)} className="rounded-xl off-gradient font-semibold text-white"><CheckCircle2 className="h-4 w-4" /></Button>
                  </div>
                  <p className="text-[11px] text-gray-500">Aguardando o consumidor informar o código de 4 números.</p>
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

      {tab === "links" && (
        <div className="space-y-4" data-testid="d-links">
          <div className="off-card p-4">
            <p className="font-display text-sm font-bold tracking-wide text-off-orange">VINCULAR-SE A UM ESTABELECIMENTO</p>
            <p className="mt-1 text-[11px] text-gray-500">Peça o <b>código de vínculo</b> ao estabelecimento e digite abaixo. Após a aprovação, você recebe as entregas próprias dele.</p>
            <div className="mt-3 flex gap-2">
              <Input data-testid="d-link-code" value={linkCode} onChange={(e) => setLinkCode(e.target.value)} placeholder="Código do estabelecimento" className="off-input" />
              <Button data-testid="d-link-request" onClick={requestLink} disabled={linking} className="rounded-xl off-gradient font-semibold text-white">{linking ? "..." : "Solicitar"}</Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-400">Meus vínculos</p>
            {(links.data || []).length === 0 && <Empty text="Você ainda não solicitou vínculo com nenhum estabelecimento." />}
            {(links.data || []).map((l) => (
              <div key={l.id} className="off-card flex items-center justify-between p-3" data-testid={`d-link-${l.id}`}>
                <span className="text-sm font-semibold text-white">{l.establishment_name}</span>
                <LinkStatus status={l.status} />
              </div>
            ))}
          </div>
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
      </>)}
    </div>
  );
}

function LinkStatus({ status }) {
  const map = {
    pending: { t: "Pendente", c: "bg-off-warning/15 text-off-warning" },
    active: { t: "Ativo", c: "bg-off-success/15 text-off-success" },
    rejected: { t: "Recusado", c: "bg-off-error/15 text-off-error" },
  };
  const s = map[status] || map.pending;
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.c}`} data-testid={`d-link-status-${status}`}>{s.t}</span>;
}

function Card({ o, children, showEarning, highlight }) {
  const money2 = (v) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
  return (
    <div className={`off-card p-4 ${highlight ? "ring-1 ring-off-orange/40" : ""}`} data-testid={`d-order-${o.id}`}>
      {highlight && <p className="mb-1 text-[11px] font-bold text-off-orange">🛵 NOVA ENTREGA OFF360</p>}
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold text-white">
          {["ready", "on_the_way", "arrived"].includes(o.status) && <span className="off-blink" data-testid={`d-status-dot-${o.id}`} style={{ width: 10, height: 10, borderRadius: 9999, background: o.status === "on_the_way" ? "#22c55e" : o.status === "arrived" ? "#3b82f6" : "#f97316", display: "inline-block" }} />}
          {o.establishment_name}
        </p>
        <span className="text-[11px] text-gray-400">{o.mode === "delivery" ? "Entrega" : "Retirada"} · Pedido nº {o.number || "----"}</span>
      </div>
      {highlight && <span className="mt-1 inline-block rounded-full bg-off-orange/15 px-2 py-0.5 text-[10px] font-semibold text-off-orange" data-testid={`d-scope-${o.id}`}>{o.offer_scope === "own" ? "Loja vinculada" : "Entrega externa"}</span>}
      {!highlight && o.offer_scope === "own" && <span className="mt-1 inline-block rounded-full bg-off-orange/15 px-2 py-0.5 text-[10px] font-semibold text-off-orange" data-testid={`d-own-badge-${o.id}`}>Loja vinculada</span>}
      {highlight && o.deliverer_earning != null && <p className="text-xs font-semibold text-off-success" data-testid={`d-ride-fee-${o.id}`}>Você recebe pela entrega: {money2(o.deliverer_earning)}</p>}
      {o.order_amount != null && <p className="text-xs text-gray-300">Pedido: {money2(o.order_amount)}</p>}
      {showEarning && o.deliverer_earning != null && <p className="text-xs text-off-success">Seu ganho: {money2(o.deliverer_earning)}</p>}
      {o.status !== "delivered" && o.status !== "cancelled" && <AddressBlock a={o.establishment_address} name={o.establishment_name} />}
      {o.status !== "delivered" && o.status !== "cancelled" && o.customer_address && <CustomerBlock address={o.customer_address} name={o.customer_name} />}
      {o.status === "delivered" && <p className="text-[11px] text-gray-500">Concluída</p>}
      {o.status === "cancelled" && <p className="text-[11px] text-off-error">Cancelada</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
function Empty({ text }) { return <div className="off-card p-8 text-center text-sm text-gray-400" data-testid="d-empty">{text}</div>; }

function AddressBlock({ a, name }) {
  if (!a) return null;
  const parts = [a.street, a.number, a.neighborhood, a.city].filter(Boolean);
  if (parts.length === 0 && !a.legacy && !a.complement) return null;
  const q = encodeURIComponent(parts.join(", ") || a.legacy || name || "");
  return (
    <div className="mt-2 rounded-lg border border-off-blue/30 bg-off-bg/50 p-2.5 text-[11px] text-gray-300" data-testid="d-address">
      <p className="mb-1 font-semibold text-gray-200">Onde buscar o pedido</p>
      {a.street ? <p>Rua: {a.street}{a.number ? ` · Nº ${a.number}` : ""}</p> : (a.legacy ? <p>{a.legacy}</p> : null)}
      {a.neighborhood && <p>Bairro: {a.neighborhood}</p>}
      {a.city && <p>Cidade: {a.city}</p>}
      {a.complement && <p>Complemento: {a.complement}</p>}
      <a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer" data-testid="d-maps-link" className="mt-2 inline-flex items-center gap-1 rounded-md off-gradient px-2.5 py-1 font-semibold text-white">Como chegar</a>
    </div>
  );
}

function CustomerBlock({ address, name }) {
  if (!address) return null;
  const q = encodeURIComponent(address);
  return (
    <div className="mt-2 rounded-lg border border-off-success/30 bg-off-success/5 p-2.5 text-[11px] text-gray-300" data-testid="d-customer-address">
      <p className="mb-1 font-semibold text-gray-200">Entregar para o cliente</p>
      {name && <p>Cliente: {name}</p>}
      <p>{address}</p>
      <a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer" data-testid="d-customer-maps" className="mt-2 inline-flex items-center gap-1 rounded-md off-gradient px-2.5 py-1 font-semibold text-white">Como chegar ao cliente</a>
    </div>
  );
}
