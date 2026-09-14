import React, { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import * as merchantAlert from "@/lib/merchantAlert";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Bell, Receipt, LogOut, ChefHat, Plus, Utensils } from "lucide-react";

const TK = "off_waiter_token";
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem(TK)}` } });

export default function Waiter() {
  const [token, setToken] = useState(localStorage.getItem(TK));
  const [ov, setOv] = useState(null);
  const [sel, setSel] = useState(null); // table_id selected for adding
  const prevReady = useRef(0);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/presencial/waiter/overview", auth());
      const readyCount = (data.board?.ready || []).length;
      if (readyCount > prevReady.current && prevReady.current !== 0) { merchantAlert.playChime(); toast.success("Pedido pronto na cozinha! 🔔"); }
      prevReady.current = readyCount;
      setOv(data);
    }
    catch (e) { if (e?.response?.status === 401) { localStorage.removeItem(TK); setToken(null); } }
  }, []);
  useEffect(() => { if (!token) return; load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [token, load]);

  if (!token) return <Login onOk={(t) => { localStorage.setItem(TK, t); setToken(t); }} />;
  if (!ov) return <div className="flex min-h-screen items-center justify-center bg-off-bg"><Loader2 className="h-6 w-6 animate-spin text-off-orange" /></div>;

  const logout = () => { localStorage.removeItem(TK); setToken(null); };
  const comandaByTable = (tid) => ov.comandas.find((c) => c.table_id === tid);

  return (
    <div className="min-h-screen bg-off-bg p-4 pb-24" data-testid="waiter-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><ChefHat className="h-6 w-6 text-off-orange" /><div><h1 className="font-display text-lg font-bold text-white">Olá, {ov.waiter?.name}</h1><p className="text-xs text-gray-400">Painel do Garçom</p></div></div>
        <button onClick={logout} data-testid="waiter-logout" className="text-gray-400"><LogOut className="h-5 w-5" /></button>
      </div>

      {ov.calls.length > 0 && (
        <div className="mt-4 rounded-2xl border border-off-orange/40 bg-off-orange/10 p-3" data-testid="waiter-calls">
          <p className="text-sm font-bold text-off-orange">Chamadas</p>
          {ov.calls.map((c) => (
            <div key={c.id} className="mt-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm text-white"><Bell className="h-4 w-4 text-off-orange" /> {c.table_name}</span>
              <Button size="sm" data-testid={`waiter-attend-${c.id}`} onClick={async () => { await api.post(`/presencial/waiter/call/${c.id}/attend`, {}, auth()); load(); }} className="rounded-lg off-gradient text-xs text-white">Atender</Button>
            </div>
          ))}
        </div>
      )}

      {ov.board.ready.length > 0 && (
        <div className="mt-4 rounded-2xl border border-off-success/40 bg-off-success/10 p-3" data-testid="waiter-ready">
          <p className="text-sm font-bold text-off-success">Prontos para entregar</p>
          {ov.board.ready.map((it, i) => (
            <div key={i} className="mt-2 flex items-center justify-between text-sm text-white">
              <span>{it.qty}× {it.name} · {it.table_name}</span>
              <Button size="sm" onClick={async () => { await api.post("/presencial/waiter/item/status", { comanda_id: it.comanda_id, idx: it.idx, status: "delivered" }, auth()); load(); }} className="rounded-lg bg-off-success text-xs text-white">Entregue</Button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-5 mb-2 font-display text-sm font-bold text-white">Mesas</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {ov.tables.map((t) => {
          const c = comandaByTable(t.id);
          const pending = c ? c.items.filter((i) => i.status === "pending").length : 0;
          return (
            <div key={t.id} className="off-card p-3" data-testid={`waiter-table-${t.id}`}>
              <div className="flex items-center justify-between"><p className="font-display font-bold text-white">{t.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.status === "occupied" ? "bg-off-orange/20 text-off-orange" : "bg-off-success/15 text-off-success"}`}>{t.status === "occupied" ? "Ocupada" : "Livre"}</span></div>
              {c && (
                <div className="mt-2 space-y-1">
                  {c.items.map((i, idx) => (<div key={idx} className="flex justify-between text-xs text-gray-300"><span>{i.qty}× {i.name} <span className="text-[9px] text-gray-500">({i.status})</span></span><span>{money(i.unit_price * i.qty)}</span></div>))}
                  <div className="flex justify-between border-t border-off-blue/20 pt-1 text-xs font-bold text-white"><span>Total</span><span className="text-off-orange">{money(c.total)}</span></div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" data-testid={`waiter-add-${t.id}`} onClick={() => setSel(t.id)} className="rounded-lg off-gradient text-xs text-white"><Plus className="mr-1 h-3.5 w-3.5" /> Add itens</Button>
                {pending > 0 && <Button size="sm" data-testid={`waiter-send-${t.id}`} onClick={async () => { await api.post("/presencial/waiter/comanda/send-kitchen", { comanda_id: c.id }, auth()); load(); toast.success("Enviado à cozinha"); }} className="rounded-lg bg-off-blue text-xs text-white">Enviar cozinha ({pending})</Button>}
                {c && <Button size="sm" onClick={async () => { await api.post("/presencial/waiter/comanda/request-bill", { comanda_id: c.id }, auth()); load(); }} className="rounded-lg border border-off-blue/40 bg-transparent text-xs text-gray-200"><Receipt className="mr-1 h-3.5 w-3.5" /> Conta</Button>}
              </div>
            </div>
          );
        })}
        {ov.tables.length === 0 && <p className="text-sm text-gray-400">Nenhuma mesa cadastrada pelo estabelecimento.</p>}
      </div>

      {sel && <AddDialog tableId={sel} catalog={ov.catalog} onClose={() => setSel(null)} onDone={() => { setSel(null); load(); }} />}
    </div>
  );
}

function AddDialog({ tableId, catalog, onClose, onDone }) {
  const [cart, setCart] = useState({});
  const [busy, setBusy] = useState(false);
  const setQty = (id, d) => setCart((c) => { const q = Math.max(0, (c[id] || 0) + d); const n = { ...c }; if (q) n[id] = q; else delete n[id]; return n; });
  const items = catalog.filter((i) => cart[i.id]);
  const submit = async () => {
    if (!items.length) return; setBusy(true);
    try { await api.post("/presencial/waiter/comanda/add", { table_id: tableId, items: items.map((i) => ({ item_id: i.id, qty: cart[i.id] })) }, auth()); toast.success("Itens adicionados e enviados à cozinha"); onDone(); }
    catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-off-surface p-4" onClick={(e) => e.stopPropagation()} data-testid="waiter-add-dialog">
        <p className="font-display font-bold text-white">Adicionar itens</p>
        <div className="mt-3 space-y-2">
          {catalog.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded-lg border border-off-blue/30 bg-off-bg/50 p-2">
              <span className="text-sm text-white">{i.name} <span className="text-[11px] text-off-orange">{money(i.eff_price)}</span></span>
              <div className="flex items-center gap-2">
                <button onClick={() => setQty(i.id, -1)} className="h-7 w-7 rounded-lg border border-off-blue/40 text-white">−</button>
                <span className="w-5 text-center text-sm font-bold text-white">{cart[i.id] || 0}</span>
                <button data-testid={`wadd-plus-${i.id}`} onClick={() => setQty(i.id, 1)} className="h-7 w-7 rounded-lg off-gradient text-white">+</button>
              </div>
            </div>
          ))}
        </div>
        <Button data-testid="waiter-add-submit" onClick={submit} disabled={busy} className="mt-4 h-12 w-full rounded-xl off-gradient font-bold text-white">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Adicionar e enviar"}</Button>
      </div>
    </div>
  );
}

function Login({ onOk }) {
  const [f, setF] = useState({ login: "", password: "" });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { const { data } = await api.post("/presencial/waiter/login", { login: f.login.trim(), password: f.password }); await merchantAlert.unlock(); onOk(data.token); toast.success(`Bem-vindo, ${data.waiter?.name}`); }
    catch (e) { toast.error(formatApiError(e, "Login ou senha incorretos")); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-off-bg p-6" data-testid="waiter-login">
      <div className="w-full max-w-sm off-card p-6">
        <div className="flex items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl off-gradient"><Utensils className="h-5 w-5 text-white" /></span><h1 className="font-display text-xl font-bold text-white">Painel do Garçom</h1></div>
        <div className="mt-5 space-y-3">
          <Input data-testid="waiter-login-user" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} placeholder="Login" className="off-input" />
          <Input data-testid="waiter-login-pass" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Senha" className="off-input" />
          <Button data-testid="waiter-login-submit" onClick={submit} disabled={busy} className="h-12 w-full rounded-xl off-gradient font-bold text-white">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Entrar"}</Button>
        </div>
      </div>
    </div>
  );
}
