import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError, uploadImageValidated, fileUrl } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LayoutDashboard, CheckCircle2, Receipt, QrCode, Image as ImageIcon, Store, CreditCard, LogOut, Plus, Building2, Loader2, Inbox, Sparkles } from "lucide-react";

const items = [
  { to: "/merchant", icon: LayoutDashboard, label: "Visão geral", end: true, testid: "m-nav-dashboard" },
  { to: "/merchant/validate", icon: CheckCircle2, label: "Validar vendas", testid: "m-nav-validate" },
  { to: "/merchant/requests", icon: Inbox, label: "Solicitações", testid: "m-nav-requests" },
  { to: "/merchant/transactions", icon: Receipt, label: "Transações", testid: "m-nav-transactions" },
  { to: "/merchant/qr", icon: QrCode, label: "Meu QR Code", testid: "m-nav-qr" },
  { to: "/merchant/stories", icon: ImageIcon, label: "Stories", testid: "m-nav-stories" },
  { to: "/merchant/boosts", icon: Sparkles, label: "Destaque OFF 360", testid: "m-nav-boosts" },
  { to: "/merchant/establishment", icon: Store, label: "Estabelecimentos", testid: "m-nav-establishment" },
  { to: "/merchant/subscription", icon: CreditCard, label: "Assinaturas", testid: "m-nav-subscription" },
];

const EMPTY = { fantasy_name: "", category_id: "", description: "", address: "", neighborhood: "", city: "", whatsapp: "", instagram: "", hours: "", discount_percent: "", discount_rules: "", logo_url: null, cover_url: null };

export default function MerchantLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedIdState] = useState(() => sessionStorage.getItem("off_selected_est") || "all");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null);

  const setSelectedId = (id) => { setSelectedIdState(id); sessionStorage.setItem("off_selected_est", id); };
  const openAddDialog = () => { setForm(EMPTY); setAddOpen(true); };

  const { data } = useQuery({ queryKey: ["m-establishments"], queryFn: async () => (await api.get("/merchant/establishments")).data });
  const { data: cats } = useQuery({ queryKey: ["cats"], queryFn: async () => (await api.get("/categories")).data });
  const ests = data?.establishments || [];
  // Reconcile a stale selection (e.g., establishment deleted) to avoid orphaned loading states.
  useEffect(() => {
    if (data && selectedId !== "all" && !ests.some((e) => e.id === selectedId)) setSelectedId("all");
  }, [data]); // eslint-disable-line
  const onLogout = async () => { await logout(); navigate("/"); };

  const upImg = (key, opts) => async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(key);
    try { const up = await uploadImageValidated(f, opts); setForm((s) => ({ ...s, [key]: up.url })); toast.success("Imagem enviada"); }
    catch (err) { toast.error(err.message || "Falha no upload"); }
    finally { setUploading(null); }
  };

  const addEstablishment = async () => {
    if (!form.fantasy_name) { toast.error("Informe o nome fantasia"); return; }
    if (!form.category_id) { toast.error("Selecione a categoria do estabelecimento"); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.discount_percent === "" || payload.discount_percent == null) delete payload.discount_percent;
      else payload.discount_percent = parseFloat(payload.discount_percent);
      const { data: created } = await api.post("/merchant/establishments", payload);
      toast.success("Estabelecimento cadastrado. Aguarde a ativação pela administração.");
      setAddOpen(false); setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ["m-establishments"] });
      qc.invalidateQueries({ queryKey: ["m-dashboard"] });
      setSelectedId(created.id);
      navigate("/merchant/establishment");
    } catch (err) {
      toast.error("Não foi possível cadastrar o estabelecimento. Seus dados foram mantidos. Tente novamente.");
      console.error(formatApiError(err));
    } finally { setSaving(false); }
  };

  const count = data?.count || 0;
  const limit = data?.limit || 10;
  const atLimit = count >= limit;
  const ctx = { selectedId, setSelectedId, establishments: ests, count, limit, price: data?.merchant_plan_price, openAddDialog };

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
      <Button data-testid="add-est-btn" onClick={openAddDialog} disabled={atLimit}
        className="ml-auto h-10 rounded-xl off-gradient text-sm font-semibold text-white disabled:opacity-50"><Plus className="mr-1 h-4 w-4" /> {count === 0 ? "Cadastrar 1º" : "Adicionar"} <span data-testid="add-est-count" className="ml-1 font-normal opacity-90">({count}/{limit})</span></Button>
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
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle>{count === 0 ? "Complete o cadastro do primeiro estabelecimento" : "Adicionar novo estabelecimento"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-off-bg/60 p-3 text-sm text-gray-300">
              <p>Unidades atuais: <b className="text-white">{count}</b> de {limit}</p>
              <p className="mt-1 text-xs text-off-warning">Cada estabelecimento possui assinatura própria. Valor mensal: {data?.merchant_plan_price != null ? `R$ ${data.merchant_plan_price}/mês` : "valor ainda não definido pela administração"}.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ImgUp label="Logotipo (1:1, quadrado)" hint="Recomendado 1080×1080 px · PNG/JPG/WebP · até 5 MB" circle url={form.logo_url} loading={uploading === "logo_url"} onChange={upImg("logo_url", { maxMB: 5, minW: 500, minH: 500 })} />
              <ImgUp label="Fachada (16:9, horizontal)" hint="Recomendado 1920×1080 px · até 8 MB" url={form.cover_url} loading={uploading === "cover_url"} onChange={upImg("cover_url", { maxMB: 8, minW: 1200, minH: 675 })} />
            </div>
            <Fld label="Nome fantasia *"><Input data-testid="new-est-name" value={form.fantasy_name} onChange={(e) => setForm({ ...form, fantasy_name: e.target.value })} className="off-input" placeholder="Ex: Padaria Centro" /></Fld>
            <Fld label="Categoria *">
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger data-testid="new-est-category" className="off-input"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent className="border-off-blue/40 bg-off-surface text-white">{(cats || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </Fld>
            <Fld label="Descrição"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="border-off-blue/40 bg-off-bg text-white" /></Fld>
            <Fld label="Endereço"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="off-input" /></Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Bairro"><Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} className="off-input" /></Fld>
              <Fld label="Cidade"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="off-input" /></Fld>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="WhatsApp"><Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} className="off-input" /></Fld>
              <Fld label="Instagram (opcional)"><Input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} className="off-input" /></Fld>
            </div>
            <Fld label="Horário de funcionamento"><Input value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} className="off-input" placeholder="Seg-Sáb 09:00-19:00" /></Fld>

            <div className="rounded-xl border border-off-blue/40 bg-off-bg/50 p-3">
              <Label className="text-gray-300">Percentual de desconto</Label>
              <div className="relative mt-1.5">
                <Input data-testid="new-est-discount" type="number" inputMode="numeric" min={1} max={100} value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} className="off-input pr-9" placeholder="Ex: 10" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-off-orange">%</span>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">Digite somente números. Exemplo: digite 10 para oferecer 10% de desconto. Você poderá detalhar as condições depois de salvar.</p>
            </div>
            <Fld label="Condições (resumo)"><Input value={form.discount_rules} onChange={(e) => setForm({ ...form, discount_rules: e.target.value })} className="off-input" placeholder="Ex: válido à vista" /></Fld>

            <Button data-testid="confirm-add-est" onClick={addEstablishment} disabled={saving} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">{saving ? "Salvando..." : "Confirmar e adicionar"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Fld({ label, children }) { return (<div><Label className="text-gray-300">{label}</Label><div className="mt-1.5">{children}</div></div>); }
function ImgUp({ label, hint, url, onChange, circle, loading }) {
  return (
    <div><Label className="text-gray-300 text-xs">{label}</Label>
      <label className={`mt-1.5 flex h-24 cursor-pointer items-center justify-center overflow-hidden border border-dashed border-off-blue/50 bg-off-bg ${circle ? "aspect-square w-24 rounded-full mx-auto" : "rounded-xl"}`}>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-off-orange" /> : url ? <img alt="" src={fileUrl(url)} className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-gray-500" />}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onChange} />
      </label>
      <p className="mt-1 text-[10px] text-gray-500">{hint}</p>
    </div>
  );
}
