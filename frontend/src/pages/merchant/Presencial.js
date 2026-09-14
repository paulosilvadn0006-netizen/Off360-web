import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Utensils, QrCode, Users, ChefHat, Receipt, Bell, Settings as Cog, Trash2, Plus, Printer } from "lucide-react";

const TABS = [
  { k: "config", label: "Config", icon: Cog },
  { k: "tables", label: "Mesas", icon: QrCode },
  { k: "waiters", label: "Garçons", icon: Users },
  { k: "kitchen", label: "Cozinha", icon: ChefHat },
  { k: "comandas", label: "Comandas", icon: Receipt },
  { k: "calls", label: "Chamadas", icon: Bell },
];

export default function Presencial() {
  const { selectedId, establishments } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
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
        {tab === "config" && <ConfigTab eid={eid} />}
        {tab === "tables" && <TablesTab eid={eid} />}
        {tab === "waiters" && <WaitersTab eid={eid} />}
        {tab === "kitchen" && <KitchenTab eid={eid} />}
        {tab === "comandas" && <ComandasTab eid={eid} />}
        {tab === "calls" && <CallsTab eid={eid} />}
      </div>
    </div>
  );
}

function ConfigTab({ eid }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pconfig", eid], queryFn: async () => (await api.get("/merchant/presencial/config", { params: { establishment_id: eid } })).data });
  const [f, setF] = useState(null);
  React.useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return null;
  const save = async () => {
    try { await api.put("/merchant/presencial/config", { establishment_id: eid, service_fee_percent: parseFloat(String(f.service_fee_percent).replace(",", ".")) || 0, presencial_flow: f.presencial_flow, print_enabled: !!f.print_enabled, nfc_enabled: !!f.nfc_enabled }); toast.success("Configuração salva"); qc.invalidateQueries({ queryKey: ["pconfig", eid] }); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  return (
    <div className="off-card space-y-4 p-5" data-testid="presencial-config">
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
      <div className="max-w-xs">
        <p className="text-sm font-semibold text-white">Taxa de serviço (%)</p>
        <Input data-testid="service-fee" value={f.service_fee_percent} onChange={(e) => setF({ ...f, service_fee_percent: e.target.value })} inputMode="decimal" placeholder="Ex: 10" className="off-input mt-1.5" />
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-gray-200">
        <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="print-enabled" checked={!!f.print_enabled} onChange={(e) => setF({ ...f, print_enabled: e.target.checked })} /> <Printer className="h-4 w-4" /> Impressão térmica</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="nfc-enabled" checked={!!f.nfc_enabled} onChange={(e) => setF({ ...f, nfc_enabled: e.target.checked })} /> NFC nas mesas</label>
      </div>
      <Button data-testid="config-save" onClick={save} className="h-11 rounded-xl off-gradient font-semibold text-white">Salvar configuração</Button>
    </div>
  );
}

function TablesTab({ eid }) {
  const qc = useQueryClient();
  const { data: tables } = useQuery({ queryKey: ["ptables", eid], queryFn: async () => (await api.get("/merchant/presencial/tables", { params: { establishment_id: eid } })).data });
  const [name, setName] = useState("");
  const add = async () => { if (!name.trim()) return; try { await api.post("/merchant/presencial/tables", { establishment_id: eid, name: name.trim() }); setName(""); qc.invalidateQueries({ queryKey: ["ptables", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const del = async (id) => { try { await api.delete(`/merchant/presencial/tables/${id}`); qc.invalidateQueries({ queryKey: ["ptables", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const origin = window.location.origin;
  return (
    <div className="space-y-4" data-testid="presencial-tables">
      <div className="off-card flex items-end gap-2 p-4">
        <div className="flex-1"><p className="text-xs text-gray-400">Nome/Número da mesa</p><Input data-testid="table-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Mesa 1" className="off-input mt-1" /></div>
        <Button data-testid="table-add" onClick={add} className="h-11 rounded-xl off-gradient font-semibold text-white"><Plus className="mr-1 h-4 w-4" /> Adicionar</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(tables || []).map((t) => {
          const link = `${origin}/mesa/${t.qr_token}`;
          return (
            <div key={t.id} className="off-card p-4 text-center" data-testid={`table-card-${t.id}`}>
              <div className="flex items-center justify-between"><p className="font-display font-bold text-white">{t.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.status === "occupied" ? "bg-off-orange/20 text-off-orange" : "bg-off-success/15 text-off-success"}`}>{t.status === "occupied" ? "Ocupada" : "Livre"}</span></div>
              <div className="mx-auto mt-3 w-fit rounded-lg bg-white p-2"><QRCodeCanvas value={link} size={128} /></div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copiado"); }} className="flex-1 rounded-lg bg-off-blue text-xs text-white">Copiar link</Button>
                <button data-testid={`table-del-${t.id}`} onClick={() => del(t.id)} className="rounded-lg border border-off-error/50 px-2 text-off-error"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          );
        })}
        {(tables || []).length === 0 && <p className="text-sm text-gray-400">Nenhuma mesa cadastrada.</p>}
      </div>
    </div>
  );
}

function WaitersTab({ eid }) {
  const qc = useQueryClient();
  const { data: waiters } = useQuery({ queryKey: ["pwaiters", eid], queryFn: async () => (await api.get("/merchant/presencial/waiters", { params: { establishment_id: eid } })).data });
  const [f, setF] = useState({ name: "", login: "", password: "" });
  const add = async () => { if (!f.name || !f.login || !f.password) { toast.error("Preencha nome, login e senha"); return; } try { await api.post("/merchant/presencial/waiters", { establishment_id: eid, ...f }); setF({ name: "", login: "", password: "" }); qc.invalidateQueries({ queryKey: ["pwaiters", eid] }); toast.success("Garçom cadastrado"); } catch (e) { toast.error(formatApiError(e)); } };
  const del = async (id) => { try { await api.delete(`/merchant/presencial/waiters/${id}`); qc.invalidateQueries({ queryKey: ["pwaiters", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const toggle = async (w) => { try { await api.put(`/merchant/presencial/waiters/${w.id}`, { status: w.status === "active" ? "inactive" : "active" }); qc.invalidateQueries({ queryKey: ["pwaiters", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  return (
    <div className="space-y-4" data-testid="presencial-waiters">
      <div className="off-card grid gap-2 p-4 sm:grid-cols-4">
        <Input data-testid="waiter-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nome" className="off-input" />
        <Input data-testid="waiter-login" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} placeholder="Login" className="off-input" />
        <Input data-testid="waiter-password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Senha" className="off-input" />
        <Button data-testid="waiter-add" onClick={add} className="h-11 rounded-xl off-gradient font-semibold text-white">Cadastrar</Button>
      </div>
      <p className="text-[11px] text-gray-500">Os garçons entram em <b className="text-gray-300">{window.location.origin}/garcom</b> com login e senha.</p>
      <div className="space-y-2">
        {(waiters || []).map((w) => (
          <div key={w.id} className="off-card flex items-center gap-2 p-3" data-testid={`waiter-${w.id}`}>
            <div className="flex-1"><p className="text-sm font-semibold text-white">{w.name}</p><p className="text-[11px] text-gray-400">login: {w.login}</p></div>
            <button onClick={() => toggle(w)} className="rounded-lg border border-off-blue/40 px-2 py-1 text-[10px] text-gray-300">{w.status === "active" ? "Ativo" : "Inativo"}</button>
            <button data-testid={`waiter-del-${w.id}`} onClick={() => del(w.id)} className="rounded-lg border border-off-error/50 px-2 py-1 text-off-error"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {(waiters || []).length === 0 && <p className="text-sm text-gray-400">Nenhum garçom cadastrado.</p>}
      </div>
    </div>
  );
}

function KitchenTab({ eid }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pkitchen", eid], queryFn: async () => (await api.get("/merchant/presencial/kitchen", { params: { establishment_id: eid } })).data, refetchInterval: 5000 });
  const setStatus = async (it, status) => { try { await api.post("/merchant/presencial/kitchen/status", { comanda_id: it.comanda_id, idx: it.idx, status }); qc.invalidateQueries({ queryKey: ["pkitchen", eid] }); } catch (e) { toast.error(formatApiError(e)); } };
  const cols = [["new", "Novos", "preparing", "Preparar"], ["preparing", "Em preparo", "ready", "Pronto"], ["ready", "Prontos", "delivered", "Entregue"]];
  const board = data || { new: [], preparing: [], ready: [] };
  return (
    <div className="grid gap-3 md:grid-cols-3" data-testid="presencial-kitchen">
      {cols.map(([key, title, next, nextLabel]) => (
        <div key={key} className="off-card p-3">
          <p className="mb-2 font-display text-sm font-bold text-off-orange">{title} ({(board[key] || []).length})</p>
          <div className="space-y-2">
            {(board[key] || []).map((it, i) => (
              <div key={i} className="rounded-lg border border-off-blue/30 bg-off-bg/50 p-2" data-testid={`kds-${key}-${i}`}>
                <p className="text-sm font-semibold text-white">{it.qty}× {it.name}</p>
                <p className="text-[11px] text-gray-400">{it.table_name}{it.observations ? ` · ${it.observations}` : ""}</p>
                {(it.addons || []).length > 0 && <p className="text-[10px] text-gray-500">+ {it.addons.map((a) => a.name).join(", ")}</p>}
                <Button size="sm" onClick={() => setStatus(it, next)} className="mt-2 h-8 w-full rounded-lg off-gradient text-[11px] text-white">{nextLabel}</Button>
              </div>
            ))}
            {(board[key] || []).length === 0 && <p className="text-xs text-gray-500">—</p>}
          </div>
        </div>
      ))}
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
