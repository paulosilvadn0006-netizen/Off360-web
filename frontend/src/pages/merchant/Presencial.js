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
import { Utensils, QrCode, Users, ChefHat, Receipt, Bell, Settings as Cog, Trash2, Plus, Printer, Star, Maximize, X, ScanLine, RotateCcw, Copy, MessageCircle, Clock, CheckCircle2, Sparkles, Download, History } from "lucide-react";

// Backend should always send plain strings, but never trust it blindly as a React child
// (an object/array there throws "Objects are not valid as a React child" and trips the ErrorBoundary).
const safeText = (v, fallback = "") => (typeof v === "string" ? v : v == null ? fallback : String(v));
const safeNum = (v, fallback = 0) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
};

const TABS = [
  { k: "config", label: "Config", icon: Cog },
  { k: "tables", label: "Mesas", icon: QrCode },
  { k: "waiters", label: "Garçons", icon: Users },
  { k: "kitchen", label: "Cozinha", icon: ChefHat },
  { k: "comandas", label: "Comandas", icon: Receipt },
  { k: "history", label: "Histórico", icon: History },
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
        {tab === "history" && <HistoryTab eid={eid} />}
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
              <div className="flex items-center justify-between"><p className="font-display font-bold text-white">{safeText(t.name)}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.status === "occupied" ? "bg-off-orange/20 text-off-orange" : "bg-off-success/15 text-off-success"}`}>{t.status === "occupied" ? "Ocupada" : "Livre"}</span></div>
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
        const msg = encodeURIComponent(`Olá, ${w.name}! Seu cadastro na equipe de ${est?.fantasy_name || "nosso estabelecimento"} foi aprovado no OFF360. Já pode acessar o painel em https://off360.com.br/garcom/login com seu login e senha. 🎉`);
        window.open(`https://wa.me/${w.phone}?text=${msg}`, "_blank");
      }
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const toggle = async (w) => { try { await api.put(`/merchant/presencial/waiters/${w.id}`, { status: w.status === "active" ? "inactive" : "active" }); qc.invalidateQueries({ queryKey: ["pwaiters", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const inviteUrl = `https://off360.com.br/garcom?token=${eid}`;
  const loginUrl = `https://off360.com.br/garcom/login`;
  const copyLink = () => { navigator.clipboard.writeText(loginUrl); toast.success("Link de acesso copiado! Os garçons aprovados salvam no navegador para entrar todo dia."); };
  const waShare = `https://wa.me/?text=${encodeURIComponent(`Olá! Você foi convidado para a equipe de garçons de ${est?.fantasy_name || "nosso estabelecimento"} no OFF360. Faça seu cadastro aqui: ${inviteUrl}`)}`;
  const pending = (waiters || []).filter((w) => w.status === "pending");
  const active = (waiters || []).filter((w) => w.status !== "pending");
  const [qrFull, setQrFull] = useState(false);
  const downloadTeamQR = () => { const c = document.getElementById("team-qr-canvas"); if (!c) return; const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = "qr-acesso-equipe.png"; a.click(); toast.success("QR Code baixado"); };
  const printTeamQR = () => {
    const c = document.getElementById("team-qr-canvas"); if (!c) return;
    const dataUrl = c.toDataURL("image/png");
    const w = window.open("", "_blank"); if (!w) { toast.error("Permita pop-ups para imprimir"); return; }
    w.document.write(`<html><head><title>QR Acesso da Equipe</title><style>*{font-family:Arial,Helvetica,sans-serif}body{margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}.wrap{text-align:center;padding:40px}h1{font-size:26px;margin:0 0 6px}h2{font-size:16px;color:#444;margin:0 0 24px;font-weight:normal}img{width:340px;height:340px}p{font-size:15px;color:#333;margin-top:20px}.url{font-size:13px;color:#888;margin-top:6px}</style></head><body><div class="wrap"><h1>${est?.fantasy_name || "OFF360"}</h1><h2>Acesso da Equipe — Garçons</h2><img src="${dataUrl}" alt="QR"/><p>Escaneie para acessar o painel do garçom</p><p class="url">off360.com.br/garcom/login</p></div><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
    w.document.close();
  };
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

      <div className="off-card p-4" data-testid="team-access-qr">
        <p className="text-sm font-semibold text-white">QR Code de Acesso da Equipe</p>
        <p className="mt-1 text-[11px] text-gray-400">Fixe no balcão ou mostre na tela do caixa. O garçom escaneia, abre a tela de login e o navegador salva a senha — nos próximos acessos entra em 1 toque.</p>
        <div className="mt-3 flex flex-col items-center">
          <div className="rounded-lg bg-white p-2"><QRCodeCanvas id="team-qr-canvas" value={loginUrl} size={160} /></div>
          <p className="mt-1 text-[10px] text-gray-500">off360.com.br/garcom/login</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button data-testid="team-qr-fullscreen" onClick={() => setQrFull(true)} className="flex-1 rounded-xl bg-off-blue text-xs font-semibold text-white"><Maximize className="mr-1.5 h-4 w-4" /> Exibir em Tela Cheia</Button>
          <Button data-testid="team-qr-print" onClick={printTeamQR} className="flex-1 rounded-xl off-gradient text-xs font-semibold text-white"><Printer className="mr-1.5 h-4 w-4" /> Imprimir QR Code</Button>
          <Button data-testid="team-qr-download" onClick={downloadTeamQR} variant="outline" className="flex-1 rounded-xl border-off-blue/40 bg-transparent text-xs font-semibold text-white"><Download className="mr-1.5 h-4 w-4" /> Baixar</Button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="off-card p-4" data-testid="waiters-pending">
          <p className="flex items-center gap-1.5 text-sm font-bold text-off-orange"><Clock className="h-4 w-4" /> Pendentes de aprovação ({pending.length})</p>
          <div className="mt-2 space-y-2">
            {pending.map((w) => (
              <div key={w.id} className="flex items-center gap-2 rounded-lg border border-off-orange/30 bg-off-orange/5 p-2" data-testid={`waiter-pending-${w.id}`}>
                {w.photo_url ? <img alt="" src={fileUrl(w.photo_url)} className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-off-bg text-off-orange"><Users className="h-4 w-4" /></span>}
                <div className="flex-1"><p className="text-sm font-semibold text-white">{safeText(w.name)}</p><p className="text-[11px] text-gray-400">login: {safeText(w.login)}</p></div>
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
            <div className="flex-1"><p className="text-sm font-semibold text-white">{safeText(w.name)}</p><p className="text-[11px] text-gray-400">login: {safeText(w.login)}</p></div>
            <button onClick={() => toggle(w)} className="rounded-lg border border-off-blue/40 px-2 py-1 text-[10px] text-gray-300">{w.status === "active" ? "Ativo" : "Inativo"}</button>
            <button data-testid={`waiter-del-${w.id}`} onClick={() => del(w.id)} className="rounded-lg border border-off-error/50 px-2 py-1 text-off-error"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {(waiters || []).length === 0 && <p className="text-sm text-gray-400">Nenhum garçom ainda. Compartilhe o link acima para sua equipe se cadastrar.</p>}
      </div>

      {qrFull && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-white p-6" data-testid="team-qr-fullscreen-overlay" onClick={() => setQrFull(false)}>
          <p className="text-center text-xl font-bold text-black">{est?.fantasy_name || "OFF360"} — Acesso da Equipe</p>
          <div className="mt-4 rounded-xl bg-white p-4 shadow"><QRCodeCanvas value={loginUrl} size={320} /></div>
          <p className="mt-3 text-sm text-gray-700">Escaneie para acessar o painel do garçom</p>
          <p className="text-xs text-gray-500">off360.com.br/garcom/login</p>
          <button data-testid="team-qr-fullscreen-close" onClick={() => setQrFull(false)} className="mt-6 rounded-xl bg-off-blue px-6 py-2 text-sm font-semibold text-white">Fechar</button>
        </div>
      )}
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
  const kitchenUrl = `https://off360.com.br/cozinha?loja=${eid}`;
  const [kqrFull, setKqrFull] = useState(false);
  const copyKitchen = () => { navigator.clipboard.writeText(kitchenUrl); toast.success("Link da Cozinha copiado! Abra no tablet/monitor da cozinha."); };
  const downloadKitchenQR = () => { const c = document.getElementById("kitchen-qr-canvas"); if (!c) return; const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = "qr-cozinha.png"; a.click(); toast.success("QR Code baixado"); };
  const printKitchenQR = () => { const c = document.getElementById("kitchen-qr-canvas"); if (!c) return; const d = c.toDataURL("image/png"); const w = window.open("", "_blank"); if (!w) { toast.error("Permita pop-ups para imprimir"); return; } w.document.write(`<html><head><title>QR Cozinha</title><style>*{font-family:Arial,Helvetica,sans-serif}body{margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}.wrap{text-align:center;padding:40px}h1{font-size:26px;margin:0 0 6px}h2{font-size:16px;color:#444;margin:0 0 24px;font-weight:normal}img{width:340px;height:340px}p{font-size:15px;color:#333;margin-top:20px}</style></head><body><div class="wrap"><h1>Cozinha (KDS)</h1><h2>Painel de Pedidos</h2><img src="${d}"/><p>Escaneie no tablet/monitor da cozinha</p></div><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`); w.document.close(); };
  const cols = [["new", "Novos", "preparing", "Preparar"], ["preparing", "Em preparo", "ready", "Pronto"], ["ready", "Prontos", "delivered", "Entregue"]];
  const boardUi = (
    <div className="grid gap-3 md:grid-cols-3" data-testid="presencial-kitchen">
      {cols.map(([key, title, next, nextLabel]) => (
        <div key={key} className="off-card p-3">
          <p className={`mb-2 font-display font-bold text-off-orange ${tv ? "text-lg" : "text-sm"}`}>{title} ({(board[key] || []).length})</p>
          <div className="space-y-2">
            {(board[key] || []).map((it, i) => (
              <div key={i} className="rounded-lg border border-off-blue/30 bg-off-bg/50 p-2" data-testid={`kds-${key}-${i}`}>
                <p className={`font-semibold text-white ${tv ? "text-lg" : "text-sm"}`}>{safeNum(it.qty, 1)}× {safeText(it.name)}</p>
                <p className={`text-gray-400 ${tv ? "text-sm" : "text-[11px]"}`}>{safeText(it.table_name)}</p>
                {it.observations ? <p data-testid={`kds-obs-${key}-${i}`} className={`mt-1 rounded bg-off-error/25 px-2 py-1 font-bold uppercase text-off-error ${tv ? "text-sm" : "text-[11px]"}`}>⚠ {safeText(it.observations)}</p> : null}
                {(it.addons || []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(it.addons || []).filter((a) => a?.name).map((a, ai) => (a?.price
                      ? <span key={ai} className="rounded bg-off-blue/15 px-1.5 py-0.5 text-[10px] text-gray-300">+ {safeText(a.name)}</span>
                      : <span key={ai} data-testid={`kds-remove-${key}-${i}-${ai}`} className="rounded bg-off-error/25 px-1.5 py-0.5 text-[10px] font-bold uppercase text-off-error">{safeText(a.name)}</span>))}
                  </div>
                )}
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
    <div className="space-y-3">
      <div className="off-card p-4" data-testid="kitchen-access">
        <p className="text-sm font-semibold text-white">Acesso da Cozinha (tablet/monitor)</p>
        <p className="mt-1 text-[11px] text-gray-400">Abra este link no aparelho da cozinha — mostra só o painel de pedidos (Novos, Em preparo, Prontos), sem áreas administrativas, e atualiza em tempo real, sem F5.</p>
        <div className="mt-3 flex flex-col items-center">
          <div className="rounded-lg bg-white p-2"><QRCodeCanvas id="kitchen-qr-canvas" value={kitchenUrl} size={140} /></div>
          <p className="mt-1 text-[10px] text-gray-500">off360.com.br/cozinha</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button data-testid="copy-kitchen-link" onClick={copyKitchen} className="flex-1 rounded-xl bg-off-blue text-xs font-semibold text-white"><Copy className="mr-1.5 h-4 w-4" /> Copiar Link da Cozinha</Button>
          <Button data-testid="kitchen-qr-fullscreen" onClick={() => setKqrFull(true)} className="flex-1 rounded-xl off-gradient text-xs font-semibold text-white"><Maximize className="mr-1.5 h-4 w-4" /> Tela Cheia</Button>
          <Button data-testid="kitchen-qr-print" onClick={printKitchenQR} variant="outline" className="flex-1 rounded-xl border-off-blue/40 bg-transparent text-xs font-semibold text-white"><Printer className="mr-1.5 h-4 w-4" /> Imprimir</Button>
          <Button data-testid="kitchen-qr-download" onClick={downloadKitchenQR} variant="outline" className="flex-1 rounded-xl border-off-blue/40 bg-transparent text-xs font-semibold text-white"><Download className="mr-1.5 h-4 w-4" /> Baixar</Button>
        </div>
      </div>
      <div className="flex justify-end"><Button data-testid="kds-tv-open" size="sm" onClick={() => { merchantAlert.unlock(); setTv(true); }} className="rounded-lg bg-off-blue text-xs text-white"><Maximize className="mr-1 h-4 w-4" />Modo TV</Button></div>
      {boardUi}
      {kqrFull && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-white p-6" data-testid="kitchen-qr-fullscreen-overlay" onClick={() => setKqrFull(false)}>
          <p className="text-center text-xl font-bold text-black">Cozinha (KDS) — Acesso</p>
          <div className="mt-4 rounded-xl bg-white p-4 shadow"><QRCodeCanvas value={kitchenUrl} size={320} /></div>
          <p className="mt-3 text-sm text-gray-700">Escaneie no tablet/monitor da cozinha</p>
          <p className="text-xs text-gray-500">off360.com.br/cozinha</p>
          <button data-testid="kitchen-qr-fullscreen-close" onClick={() => setKqrFull(false)} className="mt-6 rounded-xl bg-off-blue px-6 py-2 text-sm font-semibold text-white">Fechar</button>
        </div>
      )}
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
              <span className="text-gray-200">{i + 1}. {safeText(w.name)}</span><span className="text-off-orange">{safeNum(w.avg)} <span className="text-[10px] text-gray-500">({safeNum(w.count)})</span></span>
            </div>
          ))}
        </div>
      </div>
      <div className="off-card p-4">
        <p className="mb-2 text-sm font-bold text-white">Avaliações recentes</p>
        {data.recent.length === 0 ? <p className="text-xs text-gray-500">Nenhuma avaliação ainda.</p> : data.recent.map((r, i) => (
          <div key={i} className="border-b border-off-blue/10 py-2 text-sm" data-testid={`rating-recent-${i}`}>
            <div className="flex justify-between"><span className="text-off-orange">{stars(r.stars)}</span><span className="text-[11px] text-gray-500">{safeText(r.table_name)}</span></div>
            {r.waiter_stars ? <p className="text-[11px] text-gray-400">Garçom: {stars(r.waiter_stars)}</p> : null}
            {r.comment ? <p className="text-[12px] text-gray-300">"{safeText(r.comment)}"</p> : null}
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
          <div className="flex items-center justify-between"><p className="font-display font-bold text-white">{safeText(c.table_name)}</p>{c.status === "bill_requested" && <span className="rounded-full bg-off-orange/20 px-2 py-0.5 text-[10px] font-bold text-off-orange">Conta solicitada</span>}</div>
          <div className="mt-2 space-y-1">
            {(c.items || []).map((i, idx) => (<div key={idx} className="flex justify-between text-sm text-gray-200"><span>{safeNum(i.qty, 1)}× {safeText(i.name)} <span className="text-[10px] text-gray-500">({safeText(i.status)})</span></span><span>{money(safeNum(i.unit_price) * safeNum(i.qty, 1))}</span></div>))}
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

function HistoryTab({ eid }) {
  const [date, setDate] = useState("");
  const [waiter, setWaiter] = useState("");
  const { data } = useQuery({ queryKey: ["phistory", eid, date], queryFn: async () => (await api.get("/merchant/presencial/history", { params: { establishment_id: eid, ...(date ? { date } : {}) } })).data, refetchInterval: 15000 });
  const fmt = (iso) => { if (!iso) return "—"; try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return "—"; } };
  const all = data?.comandas || [];
  const waiterOptions = Array.from(new Set(all.map((c) => c.waiter_name).filter(Boolean))).sort();
  const filtered = waiter ? all.filter((c) => (c.waiter_name || "") === waiter) : all;
  const fCount = filtered.length;
  const fTotal = filtered.reduce((s, c) => s + safeNum(c.total), 0);
  const exportCSV = () => {
    if (!filtered.length) { toast.error("Nada para exportar nesta data/filtro"); return; }
    const head = ["Mesa", "Abertura", "Fechamento", "Garçom", "Itens", "Subtotal", "Taxa", "Total"];
    const rows = [head, ...filtered.map((c) => [safeText(c.table_name), fmt(c.opened_at), fmt(c.closed_at), safeText(c.waiter_name, "-"),
      (c.items || []).map((i) => `${safeNum(i.qty, 1)}x ${safeText(i.name)}`).join("; "),
      safeNum(c.subtotal).toFixed(2), safeNum(c.service_fee).toFixed(2), safeNum(c.total).toFixed(2)])];
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `historico-comandas-${data?.date || "dia"}${waiter ? "-" + waiter.replace(/\s+/g, "-") : ""}.csv`; a.click();
    toast.success("Planilha (CSV) baixada");
  };
  const printPDF = () => {
    if (!filtered.length) { toast.error("Nada para imprimir nesta data/filtro"); return; }
    const w = window.open("", "_blank"); if (!w) { toast.error("Permita pop-ups para gerar o PDF"); return; }
    const rows = filtered.map((c) => `<tr><td>${safeText(c.table_name)}</td><td>${fmt(c.opened_at)}</td><td>${fmt(c.closed_at)}</td><td>${safeText(c.waiter_name, "-")}</td><td>${(c.items || []).map((i) => `${safeNum(i.qty, 1)}× ${safeText(i.name)}`).join("<br/>")}</td><td style="text-align:right;white-space:nowrap">${money(c.total)}</td></tr>`).join("");
    w.document.write(`<html><head><title>Histórico de Comandas</title><style>*{font-family:Arial,Helvetica,sans-serif}body{padding:24px;color:#0f172a}h1{font-size:20px;margin:0 0 2px}p.sub{color:#64748b;font-size:12px;margin:0 0 16px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f8fafc;color:#334155}tfoot td{font-weight:bold;border-top:2px solid #0f172a}</style></head><body><h1>Histórico de Comandas — Fechamento de Caixa</h1><p class="sub">Data: ${data?.date || "-"}${waiter ? " · Garçom: " + waiter : ""} · ${fCount} comanda(s)</p><table><thead><tr><th>Mesa</th><th>Abertura</th><th>Fechamento</th><th>Garçom</th><th>Itens</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5">Faturamento total (com taxa)</td><td style="text-align:right">${money(fTotal)}</td></tr></tfoot></table><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
    w.document.close();
  };
  return (
    <div className="space-y-3" data-testid="presencial-history">
      <div className="off-card flex flex-wrap items-center justify-between gap-2 p-4">
        <div><p className="text-sm font-bold text-white">Histórico de Comandas · Giro de Mesas</p><p className="text-[11px] text-gray-400">Comandas encerradas no dia — conferência de faturamento.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <select data-testid="history-waiter-filter" value={waiter} onChange={(e) => setWaiter(e.target.value)} className="off-input h-10 w-auto text-sm">
            <option value="">Todos os garçons</option>
            {waiterOptions.map((wn) => (<option key={wn} value={wn}>{wn}</option>))}
          </select>
          <input type="date" data-testid="history-date" value={date} onChange={(e) => setDate(e.target.value)} className="off-input h-10 w-auto" />
        </div>
      </div>
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="off-card p-4 text-center"><p className="text-xs text-gray-400">Comandas encerradas{waiter ? ` · ${waiter}` : ""}</p><p className="mt-1 font-display text-3xl font-bold text-white" data-testid="history-count">{fCount}</p></div>
            <div className="off-card p-4 text-center"><p className="text-xs text-gray-400">Faturamento (com taxa)</p><p className="mt-1 font-display text-3xl font-bold text-off-orange" data-testid="history-total">{money(fTotal)}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="history-export-csv" onClick={exportCSV} className="rounded-xl bg-off-blue text-xs font-semibold text-white"><Download className="mr-1.5 h-4 w-4" /> Baixar planilha (CSV)</Button>
            <Button data-testid="history-export-pdf" onClick={printPDF} className="rounded-xl off-gradient text-xs font-semibold text-white"><Printer className="mr-1.5 h-4 w-4" /> Imprimir / PDF</Button>
          </div>
        </>
      )}
      {filtered.map((c) => (
        <div key={c.id} className="off-card p-4" data-testid={`history-comanda-${c.id}`}>
          <div className="flex items-center justify-between">
            <p className="font-display font-bold text-white">{safeText(c.table_name)}</p>
            <span className="font-bold text-off-orange">{money(c.total)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-400">
            <span>Abertura: <b className="text-gray-200">{fmt(c.opened_at)}</b></span>
            <span>Fechamento: <b className="text-gray-200">{fmt(c.closed_at)}</b></span>
            {c.waiter_name && <span>Garçom: <b className="text-gray-200">{safeText(c.waiter_name)}</b></span>}
          </div>
          <div className="mt-2 space-y-0.5">
            {(c.items || []).map((i, idx) => (<div key={idx} className="flex justify-between text-sm text-gray-200"><span>{safeNum(i.qty, 1)}× {safeText(i.name)}</span><span>{money(safeNum(i.unit_price) * safeNum(i.qty, 1))}</span></div>))}
          </div>
          <div className="mt-2 border-t border-off-blue/20 pt-1 text-[11px] text-gray-400">
            <div className="flex justify-between"><span>Subtotal</span><span>{money(c.subtotal)}</span></div>
            <div className="flex justify-between"><span>Taxa ({safeNum(c.service_fee_percent)}%)</span><span>{money(c.service_fee)}</span></div>
          </div>
        </div>
      ))}
      {data && filtered.length === 0 && <p className="text-sm text-gray-400">Nenhuma comanda encerrada nesta data{waiter ? " para este garçom" : ""}.</p>}
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
          <div className="flex-1"><p className="text-sm font-semibold text-white">{safeText(c.table_name)}</p>{c.note && <p className="text-[11px] text-gray-400">{safeText(c.note)}</p>}</div>
          <Button data-testid={`call-attend-${c.id}`} size="sm" onClick={() => attend(c.id)} className="rounded-lg off-gradient text-xs text-white">Atender</Button>
        </div>
      ))}
      {(data || []).length === 0 && <p className="text-sm text-gray-400">Nenhuma chamada no momento.</p>}
    </div>
  );
}
