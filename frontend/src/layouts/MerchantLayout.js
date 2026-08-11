import React, { useState, useMemo } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LayoutDashboard, CheckCircle2, Receipt, QrCode, Image, Store, CreditCard, LogOut, Plus, Building2 } from "lucide-react";

const items = [
  { to: "/merchant", icon: LayoutDashboard, label: "Visão geral", end: true, testid: "m-nav-dashboard" },
  { to: "/merchant/validate", icon: CheckCircle2, label: "Validar vendas", testid: "m-nav-validate" },
  { to: "/merchant/transactions", icon: Receipt, label: "Transações", testid: "m-nav-transactions" },
  { to: "/merchant/qr", icon: QrCode, label: "Meu QR Code", testid: "m-nav-qr" },
  { to: "/merchant/stories", icon: Image, label: "Stories", testid: "m-nav-stories" },
  { to: "/merchant/establishment", icon: Store, label: "Estabelecimento", testid: "m-nav-establishment" },
  { to: "/merchant/subscription", icon: CreditCard, label: "Assinatura", testid: "m-nav-subscription" },
];

export default function MerchantLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ fantasy_name: "", neighborhood: "", category_id: "" });

  const { data } = useQuery({ queryKey: ["m-establishments"], queryFn: async () => (await api.get("/merchant/establishments")).data });
  const { data: cats } = useQuery({ queryKey: ["cats"], queryFn: async () => (await api.get("/categories")).data });
  const ests = data?.establishments || [];
  const onLogout = async () => { await logout(); navigate("/"); };

  const addEstablishment = async () => {
    if (!form.fantasy_name) { toast.error("Informe o nome fantasia"); return; }
    try {
      const { data: created } = await api.post("/merchant/establishments", form);
      toast.success("Estabelecimento adicionado. Aguarde a ativação pela administração.");
      setAddOpen(false); setForm({ fantasy_name: "", neighborhood: "", category_id: "" });
      qc.invalidateQueries({ queryKey: ["m-establishments"] });
      setSelectedId(created.id);
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const ctx = { selectedId, setSelectedId, establishments: ests, count: data?.count || 0, limit: data?.limit || 10, price: data?.merchant_plan_price };

  const SelectorBar = (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-off-blue/40 bg-off-surface p-3">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-400"><Building2 className="h-4 w-4 text-off-orange" /> Estabelecimento:</span>
      <Select value={selectedId} onValueChange={setSelectedId}>
        <SelectTrigger data-testid="est-selector" className="h-10 w-56 rounded-xl border-off-blue/40 bg-off-bg text-white"><SelectValue /></SelectTrigger>
        <SelectContent className="border-off-blue/40 bg-off-surface text-white">
          <SelectItem value="all">Todos os estabelecimentos</SelectItem>
          {ests.map((e) => <SelectItem key={e.id} value={e.id}>{e.fantasy_name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button data-testid="add-est-btn" onClick={() => setAddOpen(true)} disabled={(data?.count || 0) >= (data?.limit || 10)}
        className="ml-auto h-10 rounded-xl off-gradient text-sm font-semibold text-white"><Plus className="mr-1 h-4 w-4" /> Adicionar</Button>
      <span data-testid="add-est-count" className="w-full text-[11px] text-gray-500 sm:w-auto">{data?.count || 0}/{data?.limit || 10} unidades</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-off-bg lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-off-blue/30 bg-off-surface/60 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 px-6 py-5"><Logo size={40} showText={false} /><span className="font-display text-lg font-bold text-white">OFF 360</span></div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} data-testid={it.testid}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "off-gradient text-white" : "text-gray-300 hover:bg-off-blue/20"}`}>
              <it.icon className="h-4 w-4" /> {it.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={onLogout} data-testid="m-logout" className="m-3 flex items-center gap-2 rounded-xl px-3 py-3 text-sm text-gray-400 hover:bg-off-error/10 hover:text-off-error"><LogOut className="h-4 w-4" /> Sair</button>
      </aside>

      <div className="flex-1">
        <header className="off-glass sticky top-0 z-30 flex items-center justify-between border-b border-off-blue/30 px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2"><Logo size={34} showText={false} /><span className="font-display font-bold text-white">Empresário</span></div>
          <button onClick={onLogout} className="text-gray-400"><LogOut className="h-5 w-5" /></button>
        </header>
        <main className="px-4 py-5 pb-28 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl">
            {SelectorBar}
            <Outlet context={ctx} />
          </div>
        </main>
      </div>

      <nav className="off-glass fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-off-blue/40 px-1 py-2 safe-bottom lg:hidden">
        {items.slice(0, 5).map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} data-testid={it.testid + "-m"}
            className={({ isActive }) => `flex min-w-[62px] flex-col items-center gap-1 py-1 text-[10px] font-medium ${isActive ? "text-off-orange" : "text-gray-400"}`}>
            <it.icon className="h-5 w-5" />{it.label}
          </NavLink>
        ))}
      </nav>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle>Adicionar novo estabelecimento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-off-bg/60 p-3 text-sm text-gray-300">
              <p>Unidades atuais: <b className="text-white">{data?.count || 0}</b> de {data?.limit || 10}</p>
              <p className="mt-1 text-xs text-off-warning">Cada estabelecimento possui mensalidade própria. Valor adicional: {data?.merchant_plan_price != null ? `R$ ${data.merchant_plan_price}/mês` : "a definir pela administração"}.</p>
            </div>
            <div><Label className="text-gray-300">Nome fantasia</Label><Input data-testid="new-est-name" value={form.fantasy_name} onChange={(e) => setForm({ ...form, fantasy_name: e.target.value })} className="off-input" placeholder="Ex: Padaria Centro" /></div>
            <div><Label className="text-gray-300">Categoria</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger className="off-input"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent className="border-off-blue/40 bg-off-surface text-white">{(cats || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-gray-300">Bairro</Label><Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} className="off-input" /></div>
            <Button data-testid="confirm-add-est" onClick={addEstablishment} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">Confirmar e adicionar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
