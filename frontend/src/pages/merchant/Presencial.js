import React, { useState, useEffect, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import * as merchantAlert from "@/lib/merchantAlert";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Utensils, QrCode, Users, ChefHat, Receipt, Bell, Settings as Cog, Trash2, Plus, Printer, Star, Maximize, X, ScanLine, RotateCcw, Copy, MessageCircle, Clock, CheckCircle2, Sparkles, Download } from "lucide-react";

const TABS = [
  { k: "config", label: "Config", icon: Cog },
  { k: "tables", label: "Mesas", icon: QrCode },
  { k: "waiters", label: "Garçons", icon: Users },
  { k: "kitchen", label: "Cozinha", icon: ChefHat },
  { k: "comandas", label: "Comandas", icon: Receipt },
  { k: "calls", label: "Chamadas", icon: Bell },
  { k: "ratings", label: "Avaliações", icon: Star },
];

export default function Presencial() {
  const { selectedId, establishments } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const est = establishments?.find((x) => x.id === eid) || establishments?.[0];
  const [tab, setTab] = useState("config");
  if (!eid) return <p className="text-gray-400">Selecione um estabelecimento no topo.</p>;
  return (
    <div className="animate-fade-up" data-testid="presencial-page">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl off-gradient"><Utensils className="h-5 w-5 text-white" /></span>
        <div><h1 className="font-display text-2xl font-bold text-white">Operação Presencial</h1><p className="text-sm text-gray-400">Cardápio digital, mesas, garçons, cozinha e comandas.</p></div>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t.k} data-testid={`presencial-tab-${t.k}`} onClick={() => setTab(t.k)}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${tab === t.k ? "border-off-orange bg-off-orange/10 text-white" : "border-off-blue/40 text-gray-300"}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === "config" && <ConfigTab eid={eid} est={est} />}
        {tab === "tables" && <TablesTab eid={eid} est={est} />}
        {tab === "waiters" && <WaitersTab eid={eid} est={est} />}
        {tab === "kitchen" && <KitchenTab eid={eid} />}
        {tab === "comandas" && <ComandasTab eid={eid} />}
        {tab === "calls" && <CallsTab eid={eid} />}
        {tab === "ratings" && <RatingsTab eid={eid} />}
      </div>
    </div>
  );
}

function ConfigTab({ eid, est }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pconfig", eid], queryFn: async () => (await api.get("/merchant/presencial/config", { params: { establishment_id: eid } })).data });
  const [f, setF] = useState(null);
  React.useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return null;
  const save = async () => {
    if (f.menu_mode === "external" && !String(f.menu_external_url || "").trim()) { toast.error("Informe o link do cardápio externo"); return; }
    try { await api.put("/merchant/presencial/config", { establishment_id: eid, service_fee_percent: parseFloat(String(f.service_fee_percent).replace(",", ".")) || 0, presencial_flow: f.presencial_flow, print_enabled: !!f.print_enabled, nfc_enabled: !!f.nfc_enabled, menu_mode: f.menu_mode || "native", menu_external_url: String(f.menu_external_url || "").trim(), google_review_url: String(f.google_review_url || "").trim() }); toast.success("Configuração salva"); qc.invalidateQueries({ queryKey: ["pconfig", eid] }); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  return (
    <div className="off-card space-y-4 p-5" data-testid="presencial-config">
      <PlaquinhasBanner est={est} />
      {!f.modules?.presencial && <div className="rounded-xl border border-off-warning/40 bg-off-warning/10 p-3 text-xs text-off-warning">O módulo Operação Presencial está desativado. Ative em Gerenciar → "Como deseja utilizar o OFF360?".</div>}
      <div>
        <p className="text-sm font-semibold text-white">Fluxo de pedidos</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[["waiter", "Cliente → Garçom → Cozinha", "O garçom confere e envia à cozinha"], ["direct", "Cliente → Cozinha", "O pedido vai direto para a cozinha"]].map(([k, t, d]) => (
            <button key={k} data-testid={`flow-${k}`} onClick={() => setF({ ...f, presencial_flow: k })} className={`rounded-xl border p-3 text-left ${f.presencial_flow === k ? "border-off-orange bg-off-orange/10" : "border-off-blue/40"}`}>
              <p className="text-sm font-bold text-white">{t}</p><p className="text-[11px] text-gray-400">{d}</p>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-white">Origem do cardápio (QR / NFC da mesa)</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[["native", "Cardápio nativo OFF360", "O QR abre o cardápio digital do sistema, com pedidos e comanda"], ["external", "Link / PDF externo", "O QR redireciona direto para um link seu (Canva, site, PDF...)"]].map(([k, t, d]) => (
            <button key={k} data-testid={`menumode-${k}`} onClick={() => setF({ ...f, menu_mode: k })} className={`rounded-xl border p-3 text-left ${(f.menu_mode || "native") === k ? "border-off-orange bg-off-orange/10" : "border-off-blue/40"}`}>
              <p className="text-sm font-bold text-white">{t}</p><p className="text-[11px] text-gray-400">{d}</p>
            </button>
          ))}
        </div>
        {(f.menu_mode || "native") === "external" && (
          <div className="mt-2">
            <Input data-testid="menu-external-url" value={f.menu_external_url || ""} onChange={(e) => setF({ ...f, menu_external_url: e.target.value })} placeholder="https://seulink.com/cardapio" className="off-input" />
            <p className="mt-1 text-[11px] text-gray-500">Ao escanear o QR da mesa, o cliente será levado direto para este link.</p>
          </div>
        )}
      </div>
      <div className="max-w-xs">
        <p className="text-sm font-semibold text-white">Taxa de serviço (%)</p>
        <Input data-testid="service-fee" value={f.service_fee_percent} onChange={(e) => setF({ ...f, service_fee_percent: e.target.value })} inputMode="decimal" placeholder="Ex: 10" className="off-input mt-1.5" />
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-gray-200">
        <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="print-enabled" checked={!!f.print_enabled} onChange={(e) => setF({ ...f, print_enabled: e.target.checked })} /> <Printer className="h-4 w-4" /> Impressão térmica</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="nfc-enabled" checked={!!f.nfc_enabled} onChange={(e) => setF({ ...f, nfc_enabled: e.target.checked })} /> NFC nas mesas</label>
      </div>
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white"><Star className="h-4 w-4 text-off-orange" /> Avaliação no Google Meu Negócio</p>
        <p className="mt-1 text-[11px] text-gray-400">Cole o link de avaliações do seu Google. Um botão "Avaliar no Google" aparecerá para o cliente no cardápio da mesa. As avaliações nativas do OFF360 continuam funcionando normalmente.</p>
        <Input data-testid="google-review-url" value={f.google_review_url || ""} onChange={(e) => setF({ ...f, google_review_url: e.target.value })} placeholder="https://g.page/r/... ou https://search.google.com/local/writereview?placeid=..." className="off-input mt-2" />
      </div>
      <Button data-testid="config-save" onClick={save} className="h-11 rounded-xl off-gradient font-semibold text-white">Salvar configuração</Button>
    </div>
  );
}

function TablesTab({ eid, est }) {
  const qc = useQueryClient();
  const { data: tables } = useQuery({ queryKey: ["ptables", eid], queryFn: async () => (await api.get("/merchant/presencial/tables", { params: { establishment_id: eid } })).data });
  const [name, setName] = useState("");
  const add = async () => { if (!name.trim()) return; try { await api.post("/merchant/presencial/tables", { establishment_id: eid, name: name.trim() }); setName(""); qc.invalidateQueries({ queryKey: ["ptables", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const del = async (id) => { try { await api.delete(`/merchant/presencial/tables/${id}`); qc.invalidateQueries({ queryKey: ["ptables", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const resetScans = async (id) => { try { await api.post(`/merchant/presencial/tables/${id}/reset-scans`); toast.success("Contador zerado"); qc.invalidateQueries({ queryKey: ["ptables", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const downloadQR = (t) => { const c = document.getElementById(`qrwrap-${t.id}`)?.querySelector("canvas"); if (!c) return; const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = `qrcode-${String(t.name).replace(/\s+/g, "-")}.png`; a.click(); toast.success("QR Code baixado"); };
  const origin = "https://off360.com.br";
  return (
    <div className="space-y-4" data-testid="presencial-tables">
      <PlaquinhasBanner est={est} />
      <div className="off-card flex items-end gap-2 p-4">
        <div className="flex-1"><p className="text-xs text-gray-400">Nome/Número da mesa</p><Input data-testid="table-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Mesa 1" className="off-input mt-1" /></div>
        <Button data-testid="table-add" onClick={add} className="h-11 rounded-xl off-gradient font-semibold text-white"><Plus className="mr-1 h-4 w-4" /> Adicionar</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(tables || []).map((t) => {
          const link = `${origin}/mesa/${t.qr_token || t.id}`;
          return (
            <div key={t.id} className="off-card p-4 text-center" data-testid={`table-card-${t.id}`}>
              <div className="flex items-center justify-between"><p className="font-display font-bold text-white">{t.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.status === "occupied" ? "bg-off-orange/20 text-off-orange" : "bg-off-success/15 text-off-success"}`}>{t.status === "occupied" ? "Ocupada" : "Livre"}</span></div>
              <div id={`qrwrap-${t.id}`} className="mx-auto mt-3 w-fit rounded-lg bg-white p-2"><QRCodeCanvas value={link} size={128} /></div>
              <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-gray-400" data-testid={`table-scans-${t.id}`}>
                <ScanLine className="h-3.5 w-3.5 text-off-blue" /> <b className="text-white">{t.scan_count || 0}</b> escaneamento{(t.scan_count || 0) === 1 ? "" : "s"}
                <button data-testid={`table-reset-scans-${t.id}`} onClick={() => resetScans(t.id)} title="Zerar contador" className="ml-1 rounded border border-off-blue/40 px-1.5 py-0.5 text-[10px] text-gray-300 hover:text-white"><RotateCcw className="h-3 w-3" /></button>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button size="sm" data-testid={`table-copy-link-${t.id}`} onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copiado (use para gravar a tag NFC)"); }} className="flex-1 rounded-lg bg-off-blue text-xs text-white">Copiar link (NFC)</Button>
                  <Button size="sm" data-testid={`table-download-qr-${t.id}`} onClick={() => downloadQR(t)} className="flex-1 rounded-lg off-gradient text-xs text-white"><Download className="mr-1 h-3.5 w-3.5" /> Baixar QR</Button>
                  <button data-testid={`table-del-${t.id}`} onClick={() => del(t.id)} className="rounded-lg border border-off-error/50 px-2 text-off-error"><Trash2 className="h-4 w-4" /></button>
                </div>
                <p className="text-[10px] text-gray-500">Grave o link numa tag NFC, imprima o QR Code, ou use os dois — como preferir.</p>
              </div>
            </div>
          );
        })}
        {(tables || []).length === 0 && <p className="text-sm text-gray-400">Nenhuma mesa cadastrada.</p>}
      </div>
    </div>
  );
}

function PlaquinhasBanner({ est }) {
  const link = () => `https://wa.me/5519996662873?text=${encodeURIComponent("Olá! Gostaria de encomendar o Kit de Plaquinhas OFF360")}`;
  const opts = [
    ["Encomendar Plaquinhas de Mesa (Cardápio NFC / QR Code)", "Kit Plaquinhas de Mesa — Cardápio NFC / QR Code"],
    ["Encomendar Plaquinhas de Avaliação Google", "Kit Plaquinhas de Avaliação Google"],
    ["Pedir Combo Completo (Cardápio + Google)", "Combo Completo — Cardápio NFC/QR + Avaliação Google"],
  ];
  return (
    <div className="rounded-2xl border border-off-orange/40 bg-gradient-to-br from-off-orange/15 to-off-blue/10 p-4" data-testid="plaquinhas-banner">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-off-orange" />
        <div>
          <p className="font-display text-sm font-bold text-white sm:text-base">Garanta o Kit de Plaquinhas Físicas Personalizadas (NFC + QR Code)</p>
          <p className="mt-1 text-xs text-gray-300">Deixe seu salão moderno, agilize os pedidos do Cardápio Digital e multiplique suas Avaliações no Google com acrílicos/adesivos prontos.</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {opts.map(([label, kit], i) => (
          <a key={i} data-testid={`plaquinha-cta-${i}`} href={link(kit)} target="_blank" rel="noreferrer"
             className="flex items-center justify-center gap-1.5 rounded-xl off-gradient px-3 py-2.5 text-center text-[11px] font-bold text-white transition-transform hover:scale-[1.02]">
            <MessageCircle className="h-3.5 w-3.5 shrink-0" /> {label}
          </a>
        ))}
      </div>
    </div>
  );
}

function WaitersTab({ eid, est }) {
  const qc = useQueryClient();
  const { data: waiters } = useQuery({ queryKey: ["pwaiters", eid], queryFn: async () => (await api.get("/merchant/presencial/waiters", { params: { establishment_id: eid } })).data });
  const del = async (id) => { try { await api.delete(`/merchant/presencial/waiters/${id}`); qc.invalidateQueries({ queryKey: ["pwaiters", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const approve = async (w) => {
    try {
      await api.put(`/merchant/presencial/waiters/${w.id}`, { status: "active" });
      qc.invalidateQueries({ queryKey: ["pwaiters", eid] });
      toast.success("Garçom aprovado!");
      if (w.phone) {
        const msg = encodeURIComponent(`Olá, ${w.name}! Seu cadastro na equipe de ${est?.fantasy_name || "nosso estabelecimento"} foi aprovado no OFF360. Já pode acessar o painel em ${window.location.origin}/garcom com seu login e senha. 🎉`);
        window.open(`https://wa.me/${w.phone}?text=${msg}`, "_blank");
      }
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const toggle = async (w) => { try { await api.put(`/merchant/presencial/waiters/${w.id}`, { status: w.status === "active" ? "inactive" : "active" }); qc.invalidateQueries({ queryKey: ["pwaiters", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const link = `https://off360.com.br/garcom/convite?loja=${eid}`;
  const copyLink = () => { navigator.clipboard.writeText(link); toast.success("Link da equipe copiado!"); };
  const waShare = `https://wa.me/?text=${encodeURIComponent(`Olá! Você foi convidado para a equipe de garçons de ${est?.fantasy_name || "nosso estabelecimento"} no OFF360. Faça seu cadastro aqui: ${link}`)}`;
  const pending = (waiters || []).filter((w) => w.status === "pending");
  const active = (waiters || []).filter((w) => w.status !== "pending");
  return (
    <div className="space-y-4" data-testid="presencial-waiters">
      <div className="off-card p-4">
        <p className="text-sm font-semibold text-white">Convide sua equipe</p>
        <p className="mt-1 text-[11px] text-gray-400">Compartilhe o link e cada garçom cria o próprio acesso (nome, login, senha e foto). Você aprova antes de liberar.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button data-testid="copy-team-link" onClick={copyLink} className="rounded-xl bg-off-blue text-xs font-semibold text-white"><Copy className="mr-1.5 h-4 w-4" /> Copiar Link da Equipe</Button>
          <a data-testid="whatsapp-invite" href={waShare} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-xl off-gradient px-3 py-2 text-xs font-semibold text-white"><MessageCircle className="mr-1.5 h-4 w-4" /> Enviar Convite no WhatsApp</a>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="off-card p-4" data-testid="waiters-pending">
          <p className="flex items-center gap-1.5 text-sm font-bold text-off-orange"><Clock className="h-4 w-4" /> Pendentes de aprovação ({pending.length})</p>
          <div className="mt-2 space-y-2">
            {pending.map((w) => (
              <div key={w.id} className="flex items-center gap-2 rounded-lg border border-off-orange/30 bg-off-orange/5 p-2" data-testid={`waiter-pending-${w.id}`}>
                {w.photo_url ? <img alt="" src={fileUrl(w.photo_url)} className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-off-bg text-off-orange"><Users className="h-4 w-4" /></span>}
                <div className="flex-1"><p className="text-sm font-semibold text-white">{w.name}</p><p className="text-[11px] text-gray-400">login: {w.login}</p></div>
                <Button size="sm" data-testid={`waiter-approve-${w.id}`} onClick={() => approve(w)} className="rounded-lg bg-off-success text-xs text-white"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Aprovar</Button>
                <button data-testid={`waiter-reject-${w.id}`} onClick={() => del(w.id)} className="rounded-lg border border-off-error/50 px-2 py-1 text-off-error"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {active.map((w) => (
          <div key={w.id} className="off-card flex items-center gap-2 p-3" data-testid={`waiter-${w.id}`}>
            {w.photo_url ? <img alt="" src={fileUrl(w.photo_url)} className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-off-bg text-off-orange"><Users className="h-4 w-4" /></span>}
            <div className="flex-1"><p className="text-sm font-semibold text-white">{w.name}</p><p className="text-[11px] text-gray-400">login: {w.login}</p></div>
            <button onClick={() => toggle(w)} className="rounded-lg border border-off-blue/40 px-2 py-1 text-[10px] text-gray-300">{w.status === "active" ? "Ativo" : "Inativo"}</button>
            <button data-testid={`waiter-del-${w.id}`} onClick={() => del(w.id)} className="rounded-lg border border-off-error/50 px-2 py-1 text-off-error"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {(waiters || []).length === 0 && <p className="text-sm text-gray-400">Nenhum garçom ainda. Compartilhe o link acima para sua equipe se cadastrar.</p>}
      </div>
    </div>
  );
}

function KitchenTab({ eid }) {
  const qc = useQueryClient();
  const [tv, setTv] = useState(false);
  const { data } = useQuery({ queryKey: ["pkitchen", eid], queryFn: async () => (await api.get("/merchant/presencial/kitchen", { params: { establishment_id: eid } })).data, refetchInterval: 5000 });
  const board = data || { new: [], preparing: [], ready: [] };
  const prevNew = useRef(0);
  useEffect(() => {
    if (board.new.length > prevNew.current && prevNew.current !== 0) merchantAlert.playChime();
    prevNew.current = board.new.length;
  }, [board.new.length]);
  const setStatus = async (it, status) => { try { await api.post("/merchant/presencial/kitchen/status", { comanda_id: it.comanda_id, idx: it.idx, status }); qc.invalidateQueries({ queryKey: ["pkitchen", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const cols = [["new", "Novos", "preparing", "Preparar"], ["preparing", "Em preparo", "ready", "Pronto"], ["ready", "Prontos", "delivered", "Entregue"]];
  const boardUi = (
    <div className="grid gap-3 md:grid-cols-3" data-testid="presencial-kitchen">
      {cols.map(([key, title, next, nextLabel]) => (
        <div key={key} className="off-card p-3">
          <p className={`mb-2 font-display font-bold text-off-orange ${tv ? "text-lg" : "text-sm"}`}>{title} ({(board[key] || []).length})</p>
          <div className="space-y-2">
            {(board[key] || []).map((it, i) => (
              <div key={i} className="rounded-lg border border-off-blue/30 bg-off-bg/50 p-2" data-testid={`kds-${key}-${i}`}>
                <p className={`font-semibold text-white ${tv ? "text-lg" : "text-sm"}`}>{it.qty}× {it.name}</p>
                <p className={`text-gray-400 ${tv ? "text-sm" : "text-[11px]"}`}>{it.table_name}{it.observations ? ` · ${it.observations}` : ""}</p>
                {(it.addons || []).length > 0 && <p className="text-[10px] text-gray-500">+ {it.addons.map((a) => a.name).join(", ")}</p>}
                <Button size="sm" onClick={() => setStatus(it, next)} className={`mt-2 w-full rounded-lg off-gradient text-white ${tv ? "h-10 text-sm" : "h-8 text-[11px]"}`}>{nextLabel}</Button>
              </div>
            ))}
            {(board[key] || []).length === 0 && <p className="text-xs text-gray-500">—</p>}
          </div>
        </div>
      ))}
    </div>
  );
  if (tv) return (
    <div className="fixed inset-0 z-50 overflow-auto bg-off-bg p-4" data-testid="kds-tv">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-white">Cozinha — Modo TV</h2>
        <button data-testid="kds-tv-close" onClick={() => setTv(false)} className="rounded-lg border border-off-blue/40 px-3 py-1.5 text-sm text-gray-200"><X className="mr-1 inline h-4 w-4" />Sair</button>
      </div>
      {boardUi}
    </div>
  );
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button data-testid="kds-tv-open" size="sm" onClick={() => { merchantAlert.unlock(); setTv(true); }} className="rounded-lg bg-off-blue text-xs text-white"><Maximize className="mr-1 h-4 w-4" />Modo TV</Button></div>
      {boardUi}
    </div>
  );
}

function RatingsTab({ eid }) {
  const { data } = useQuery({ queryKey: ["pratings", eid], queryFn: async () => (await api.get("/merchant/presencial/ratings-summary", { params: { establishment_id: eid } })).data, refetchInterval: 15000 });
  if (!data) return null;
  const stars = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
  return (
    <div className="space-y-4" data-testid="presencial-ratings">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="off-card p-4 text-center"><p className="text-xs text-gray-400">Nota do estabelecimento</p><p className="mt-1 font-display text-3xl font-bold text-off-orange">{data.avg_service || "—"}</p><p className="text-off-orange">{data.count ? stars(data.avg_service) : ""}</p><p className="text-[11px] text-gray-500">{data.count} avaliações</p></div>
        <div className="off-card p-4"><p className="mb-2 text-sm font-bold text-white">Ranking de garçons</p>
          {data.waiter_ranking.length === 0 ? <p className="text-xs text-gray-500">Sem avaliações de garçom ainda.</p> : data.waiter_ranking.map((w, i) => (
            <div key={w.waiter_id} className="flex items-center justify-between border-b border-off-blue/10 py-1.5 text-sm" data-testid={`waiter-rank-${i}`}>
              <span className="text-gray-200">{i + 1}. {w.name}</span><span className="text-off-orange">{w.avg} <span className="text-[10px] text-gray-500">({w.count})</span></span>
            </div>
          ))}
        </div>
      </div>
      <div className="off-card p-4">
        <p className="mb-2 text-sm font-bold text-white">Avaliações recentes</p>
        {data.recent.length === 0 ? <p className="text-xs text-gray-500">Nenhuma avaliação ainda.</p> : data.recent.map((r, i) => (
          <div key={i} className="border-b border-off-blue/10 py-2 text-sm" data-testid={`rating-recent-${i}`}>
            <div className="flex justify-between"><span className="text-off-orange">{stars(r.stars)}</span><span className="text-[11px] text-gray-500">{r.table_name}</span></div>
            {r.waiter_stars ? <p className="text-[11px] text-gray-400">Garçom: {stars(r.waiter_stars)}</p> : null}
            {r.comment ? <p className="text-[12px] text-gray-300">"{r.comment}"</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComandasTab({ eid }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pcomandas", eid], queryFn: async () => (await api.get("/merchant/presencial/comandas", { params: { establishment_id: eid } })).data, refetchInterval: 6000 });
  const close = async (id) => { try { await api.post(`/merchant/presencial/comandas/${id}/close`); qc.invalidateQueries({ queryKey: ["pcomandas", eid] }); toast.success("Comanda encerrada"); } catch (e) { toast.error(formatApiError(e)); } };
  const print = (c) => {
    const w = window.open("", "_blank");
    const rows = c.items.map((i) => `<tr><td>${i.qty}× ${i.name}</td><td style="text-align:right">${money((i.unit_price) * i.qty)}</td></tr>`).join("");
    w.document.write(`<h3>${c.table_name}</h3><table style="width:100%">${rows}</table><hr/><p>Subtotal: ${money(c.subtotal)}<br/>Taxa (${c.service_fee_percent}%): ${money(c.service_fee)}<br/><b>Total: ${money(c.total)}</b></p>`);
    w.document.close(); w.print();
  };
  return (
    <div className="space-y-3" data-testid="presencial-comandas">
      {(data || []).map((c) => (
        <div key={c.id} className={`off-card p-4 ${c.status === "bill_requested" ? "border-off-orange" : ""}`} data-testid={`comanda-${c.id}`}>
          <div className="flex items-center justify-between"><p className="font-display font-bold text-white">{c.table_name}</p>{c.status === "bill_requested" && <span className="rounded-full bg-off-orange/20 px-2 py-0.5 text-[10px] font-bold text-off-orange">Conta solicitada</span>}</div>
          <div className="mt-2 space-y-1">
            {c.items.map((i, idx) => (<div key={idx} className="flex justify-between text-sm text-gray-200"><span>{i.qty}× {i.name} <span className="text-[10px] text-gray-500">({i.status})</span></span><span>{money(i.unit_price * i.qty)}</span></div>))}
          </div>
          <div className="mt-2 border-t border-off-blue/20 pt-2 text-sm text-gray-300">
            <div className="flex justify-between"><span>Subtotal</span><span>{money(c.subtotal)}</span></div>
            <div className="flex justify-between"><span>Taxa de serviço ({c.service_fee_percent}%)</span><span>{money(c.service_fee)}</span></div>
            <div className="flex justify-between font-bold text-white"><span>Total</span><span className="text-off-orange">{money(c.total)}</span></div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => print(c)} className="rounded-lg bg-off-blue text-xs text-white"><Printer className="mr-1 h-3.5 w-3.5" /> Imprimir</Button>
            <Button data-testid={`comanda-close-${c.id}`} size="sm" onClick={() => close(c.id)} className="rounded-lg off-gradient text-xs text-white">Encerrar comanda</Button>
          </div>
        </div>
      ))}
      {(data || []).length === 0 && <p className="text-sm text-gray-400">Nenhuma comanda aberta.</p>}
    </div>
  );
}

function CallsTab({ eid }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pcalls", eid], queryFn: async () => (await api.get("/merchant/presencial/calls", { params: { establishment_id: eid } })).data, refetchInterval: 4000 });
  const attend = async (id) => { try { await api.post(`/merchant/presencial/calls/${id}/attend`); qc.invalidateQueries({ queryKey: ["pcalls", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  return (
    <div className="space-y-2" data-testid="presencial-calls">
      {(data || []).map((c) => (
        <div key={c.id} className="off-card flex items-center gap-2 p-3" data-testid={`call-${c.id}`}>
          <Bell className="h-5 w-5 text-off-orange" />
          <div className="flex-1"><p className="text-sm font-semibold text-white">{c.table_name}</p>{c.note && <p className="text-[11px] text-gray-400">{c.note}</p>}</div>
          <Button data-testid={`call-attend-${c.id}`} size="sm" onClick={() => attend(c.id)} className="rounded-lg off-gradient text-xs text-white">Atender</Button>
        </div>
      ))}
      {(data || []).length === 0 && <p className="text-sm text-gray-400">Nenhuma chamada no momento.</p>}
    </div>
  );
}
