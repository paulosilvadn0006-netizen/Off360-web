import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, uploadImageValidated, fileUrl } from "@/lib/api";
import { Loading, money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Image as ImageIcon, Save, Percent, AlertTriangle, Loader2 } from "lucide-react";
import ActionButtonsEditor from "@/components/merchant/ActionButtonsEditor";

export default function Establishment() {
  const { selectedId, setSelectedId, establishments } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null);
  const { data, isLoading, refetch } = useQuery({ enabled: !!eid, queryKey: ["m-est", eid], queryFn: async () => (await api.get("/merchant/establishment", { params: { establishment_id: eid } })).data });
  const { data: cats } = useQuery({ queryKey: ["cats"], queryFn: async () => (await api.get("/categories")).data });

  useEffect(() => {
    if (data) {
      setForm(data);
      // keep the selector in sync with the establishment actually loaded (prevents stale-id 404 on save)
      if (data.id && data.id !== selectedId) setSelectedId(data.id);
    }
  }, [data]); // eslint-disable-line
  if (!eid) return <p className="text-gray-400">Nenhum estabelecimento. Use "Cadastrar 1º" no topo.</p>;
  if (isLoading || !form) return <Loading />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const upImg = (key, opts) => async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(key);
    try { const up = await uploadImageValidated(f, opts); setForm({ ...form, [key]: up.url }); toast.success("Imagem enviada"); }
    catch (err) { toast.error(err.message || "Falha no upload"); }
    finally { setUploading(null); }
  };
  const pct = parseFloat(form.discount_percent);
  const minp = parseFloat(form.discount_min_purchase) || 0;
  const cap = parseFloat(form.discount_max_cap) || 0;
  const base = Math.max(100, minp);
  let prevDisc = base * (pct || 0) / 100;
  if (cap > 0 && prevDisc > cap) prevDisc = cap;

  const save = async () => {
    const realId = form?.id || eid;
    if (!realId) { toast.error("Estabelecimento não encontrado. Recarregue a página e tente novamente."); return; }
    setSaving(true);
    try {
      const num = (v) => (v === "" || v == null ? null : parseFloat(String(v).replace(",", ".")));
      const streetVal = form.street ?? (form.address || "");
      const payload = {
        fantasy_name: form.fantasy_name, description: form.description, category_id: form.category_id,
        street: streetVal, number: form.number || "", complement: form.complement || "",
        address: (form.number ? `${streetVal}, ${form.number}` : streetVal),
        neighborhood: form.neighborhood, city: form.city, hours: form.hours,
        whatsapp: form.whatsapp, instagram: form.instagram, discount_rules: form.discount_rules,
        logo_url: form.logo_url, cover_url: form.cover_url,
        discount_min_purchase: num(form.discount_min_purchase), discount_max_cap: num(form.discount_max_cap),
        discount_participating: form.discount_participating || "", discount_excluded: form.discount_excluded || "",
        discount_valid_days: form.discount_valid_days || "", discount_valid_hours: form.discount_valid_hours || "",
        discount_start_date: form.discount_start_date || null, discount_end_date: form.discount_end_date || null,
        discount_cumulative: !!form.discount_cumulative, discount_observations: form.discount_observations || "",
        validation_mode: form.validation_mode || "controlled",
        action_buttons: form.action_buttons || [],
        offers_delivery: !!form.offers_delivery, offers_pickup: !!form.offers_pickup,
        delivery_areas: form.delivery_areas || "", delivery_fee_text: form.delivery_fee_text || "",
        delivery_eta: form.delivery_eta || "",
        delivery_fee: num(form.delivery_fee), avg_prep_minutes: (form.avg_prep_minutes === "" || form.avg_prep_minutes == null ? null : parseInt(form.avg_prep_minutes, 10)),
        first_purchase_enabled: !!form.first_purchase_enabled, first_purchase_percent: num(form.first_purchase_percent),
        pay_pix: !!form.pay_pix, pay_card: !!form.pay_card, pay_cash: !!form.pay_cash,
      };
      if (form.discount_percent !== "" && form.discount_percent != null) payload.discount_percent = parseFloat(form.discount_percent);
      await api.put(`/merchant/establishment/${realId}`, payload);
      toast.success("Condições do desconto salvas com sucesso");
      refetch();
    } catch (err) {
      toast.error(formatApiError(err) || "Não foi possível salvar. Seus dados foram mantidos. Tente novamente.");
    } finally { setSaving(false); }
  };

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Gerenciar estabelecimento</h1>
      <p className="text-sm text-gray-400">{form.fantasy_name}</p>
      <div className="mt-5 space-y-4 off-card p-5">
        <div className="grid grid-cols-2 gap-4">
          <ImgField label="Logotipo — imagem quadrada (1:1)" hint="Recomendado 1080×1080 px · mín 500×500 · até 5 MB. Usado como foto circular dos Stories." circle url={form.logo_url} loading={uploading === "logo_url"} onChange={upImg("logo_url", { maxMB: 5, minW: 500, minH: 500 })} />
          <ImgField label="Foto da fachada — horizontal (16:9)" hint="Recomendado 1920×1080 px · mín 1200×675 · até 8 MB." url={form.cover_url} loading={uploading === "cover_url"} onChange={upImg("cover_url", { maxMB: 8, minW: 1200, minH: 675 })} />
        </div>
        <F label="Nome fantasia"><Input data-testid="est-name" value={form.fantasy_name || ""} onChange={set("fantasy_name")} className="off-input" /></F>
        <F label="Categoria">
          <Select value={form.category_id || ""} onValueChange={(v) => setForm({ ...form, category_id: v })}>
            <SelectTrigger className="off-input"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent className="border-off-blue/40 bg-off-surface text-white">{(cats || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        <F label="Descrição"><Textarea value={form.description || ""} onChange={set("description")} className="border-off-blue/40 bg-off-bg text-white" /></F>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <F label="Rua / Logradouro"><Input data-testid="est-street" value={form.street ?? (form.address || "")} onChange={set("street")} className="off-input" placeholder="Ex: Rua das Flores" /></F>
          <F label="Nº"><Input data-testid="est-number" value={form.number || ""} onChange={set("number")} className="off-input" placeholder="123" /></F>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <F label="Bairro"><Input data-testid="est-neighborhood" value={form.neighborhood || ""} onChange={set("neighborhood")} className="off-input" /></F>
          <F label="Cidade"><Input data-testid="est-city" value={form.city || ""} onChange={set("city")} className="off-input" /></F>
        </div>
        <F label="Complemento (opcional)"><Input data-testid="est-complement" value={form.complement || ""} onChange={set("complement")} className="off-input" placeholder="Apto, bloco, casa, fundos, sala, ponto de referência..." /></F>
        <F label="Horário"><Input value={form.hours || ""} onChange={set("hours")} className="off-input" placeholder="Seg-Sáb 09:00-19:00" /></F>
        <div className="grid grid-cols-2 gap-3">
          <F label="WhatsApp"><Input value={form.whatsapp || ""} onChange={set("whatsapp")} className="off-input" /></F>
          <F label="Instagram"><Input value={form.instagram || ""} onChange={set("instagram")} className="off-input" /></F>
        </div>

        <div className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-4" data-testid="validation-mode-card">
          <p className="font-display text-sm font-bold tracking-wide text-off-orange">TIPO DE VALIDAÇÃO DAS VENDAS</p>
          <p className="mt-1 text-[11px] text-gray-500">Escolha como a venda é validada neste estabelecimento.</p>
          <div className="mt-3 max-w-xl">
            <Select value={form.validation_mode || "controlled"} onValueChange={(v) => setForm({ ...form, validation_mode: v })}>
              <SelectTrigger data-testid="est-validation-mode" className="off-input h-auto py-2 text-left"><SelectValue /></SelectTrigger>
              <SelectContent className="border-off-blue/40 bg-off-surface text-white">
                <SelectItem value="fast">Modo rápido — o cliente informa o valor e mostra o cálculo ao caixa</SelectItem>
                <SelectItem value="controlled">Modo controlado — o estabelecimento informa o valor e confirma a venda</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Percentual — campo próprio */}
        <div className={`rounded-xl border p-4 ${form.discount_configured ? "border-off-success/30 bg-off-success/5" : "border-off-warning/40 bg-off-warning/5"}`}>
          <div className="flex items-center gap-2"><Percent className="h-5 w-5 text-off-orange" /><span className="font-display font-semibold text-white">Percentual de desconto</span></div>
          {!form.discount_configured && <p className="mt-1 flex items-center gap-1 text-xs text-off-warning"><AlertTriangle className="h-3 w-3" /> Não configurado — o QR Code só libera transações após definir o percentual.</p>}
          <div className="relative mt-3 max-w-[200px]">
            <Input data-testid="est-discount" type="number" inputMode="numeric" min={1} max={100} value={form.discount_percent ?? ""} onChange={set("discount_percent")} className="off-input pr-9 text-lg font-bold" placeholder="Ex: 10" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-lg font-bold text-off-orange">%</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">Digite somente números. Exemplo: digite 10 para oferecer 10% de desconto.</p>
        </div>

        {/* Condições — seção separada */}
        <div className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-4">
          <p className="font-display text-sm font-bold tracking-wide text-off-orange">CONDIÇÕES PARA UTILIZAR O DESCONTO</p>
          <div className="mt-3">
            <F label="Condição para receber o desconto">
              <Input data-testid="est-condition" value={form.discount_rules || ""} onChange={set("discount_rules")} className="off-input" placeholder="Ex.: A partir de R$ 50,00" />
            </F>
            <p className="mt-1 text-[11px] text-gray-500">Informe de forma objetiva quando o desconto será válido.</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <F label="Valor mínimo da compra (R$)"><Input data-testid="est-min" type="number" min={0} value={form.discount_min_purchase ?? ""} onChange={set("discount_min_purchase")} className="off-input" placeholder="Opcional" /></F>
            <F label="Limite máximo do desconto (R$)"><Input data-testid="est-cap" type="number" min={0} value={form.discount_max_cap ?? ""} onChange={set("discount_max_cap")} className="off-input" placeholder="Opcional" /></F>
            <F label="Dias válidos"><Input value={form.discount_valid_days || ""} onChange={set("discount_valid_days")} className="off-input" placeholder="Ex: Seg a Sex" /></F>
            <F label="Horários válidos"><Input value={form.discount_valid_hours || ""} onChange={set("discount_valid_hours")} className="off-input" placeholder="Ex: 09:00-18:00" /></F>
            <F label="Data inicial (opcional)"><Input type="date" value={form.discount_start_date || ""} onChange={set("discount_start_date")} className="off-input" /></F>
            <F label="Data final (opcional)"><Input type="date" value={form.discount_end_date || ""} onChange={set("discount_end_date")} className="off-input" /></F>
          </div>
          <div className="mt-3"><F label="Produtos/serviços participantes"><Textarea value={form.discount_participating || ""} onChange={set("discount_participating")} className="border-off-blue/40 bg-off-bg text-white" /></F></div>
          <div className="mt-3"><F label="Produtos/serviços excluídos"><Textarea value={form.discount_excluded || ""} onChange={set("discount_excluded")} className="border-off-blue/40 bg-off-bg text-white" /></F></div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-off-bg/60 px-3 py-2">
            <span className="text-sm text-gray-300">Acumula com outras promoções</span>
            <Switch data-testid="est-cumulative" checked={!!form.discount_cumulative} onCheckedChange={(v) => setForm({ ...form, discount_cumulative: v })} />
          </div>
          <div className="mt-3"><F label="Observações"><Textarea value={form.discount_observations || ""} onChange={set("discount_observations")} className="border-off-blue/40 bg-off-bg text-white" /></F></div>

          {pct >= 1 && pct <= 100 && (
            <div className="mt-3 rounded-lg bg-off-bg/60 p-3 text-xs text-gray-300" data-testid="discount-preview">
              <b className="text-white">Prévia:</b> em uma compra de {money(base)}, o cliente economiza <b className="text-off-orange">{money(prevDisc)}</b> e paga <b className="text-white">{money(base - prevDisc)}</b>{cap > 0 ? " (desconto limitado ao máximo)" : ""}.
            </div>
          )}
        </div>

        <ActionButtonsEditor buttons={form.action_buttons || []} whatsapp={form.whatsapp} onChange={(b) => setForm({ ...form, action_buttons: b })} />

        <div className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-4" data-testid="delivery-config-card">
          <p className="font-display text-sm font-bold tracking-wide text-off-orange">COMO SEUS CLIENTES PODEM RECEBER/COMPRAR?</p>
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" data-testid="offers-pickup" checked={!!form.offers_pickup} onChange={(e) => setForm({ ...form, offers_pickup: e.target.checked })} /> Retirada no local
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" data-testid="offers-delivery" checked={!!form.offers_delivery} onChange={(e) => setForm({ ...form, offers_delivery: e.target.checked })} /> Entrega
          </label>
          {form.offers_delivery && (
            <div className="mt-3 space-y-2 border-l-2 border-off-orange/40 pl-3">
              <F label="Região / bairros atendidos"><Input data-testid="delivery-areas" value={form.delivery_areas || ""} onChange={set("delivery_areas")} className="off-input" placeholder="Ex: Centro, Jardins" /></F>
              <div className="grid grid-cols-2 gap-3">
                <F label="Taxa de entrega"><Input data-testid="delivery-fee-text" value={form.delivery_fee_text || ""} onChange={set("delivery_fee_text")} className="off-input" placeholder="Ex: R$ 5 ou 'consultar'" /></F>
                <F label="Tempo médio estimado"><Input data-testid="delivery-eta" value={form.delivery_eta || ""} onChange={set("delivery_eta")} className="off-input" placeholder="Ex: 30-45 min" /></F>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <F label="Taxa de entrega (R$) — somada ao pedido"><Input data-testid="est-delivery-fee" type="number" min={0} value={form.delivery_fee ?? ""} onChange={set("delivery_fee")} className="off-input" placeholder="Ex: 7" /></F>
                <F label="Tempo médio de preparo (min)"><Input data-testid="est-prep-min" type="number" min={0} value={form.avg_prep_minutes ?? ""} onChange={set("avg_prep_minutes")} className="off-input" placeholder="Ex: 40" /></F>
              </div>
            </div>
          )}
          <div className="mt-3 rounded-lg border border-off-orange/30 bg-off-orange/5 p-3" data-testid="first-purchase-card">
            <label className="flex items-center justify-between text-sm text-gray-200">
              <span>Desconto de primeira compra OFF360</span>
              <Switch data-testid="est-first-purchase-enabled" checked={!!form.first_purchase_enabled} onCheckedChange={(v) => setForm({ ...form, first_purchase_enabled: v })} />
            </label>
            {form.first_purchase_enabled && (
              <div className="mt-2 max-w-[200px]">
                <F label="Percentual da 1ª compra (%)"><Input data-testid="est-first-purchase-percent" type="number" min={1} max={100} value={form.first_purchase_percent ?? ""} onChange={set("first_purchase_percent")} className="off-input" placeholder="Ex: 30" /></F>
                <p className="mt-1 text-[11px] text-gray-500">Válido 1x por cliente. Aplica o MAIOR entre este e o desconto do produto (nunca soma).</p>
              </div>
            )}
          </div>
          {(form.offers_delivery || form.offers_pickup) && (
            <div className="mt-3">
              <p className="text-xs text-gray-400">Formas aceitas de pagamento na entrega/retirada:</p>
              <div className="mt-1 flex flex-wrap gap-3 text-sm text-gray-200">
                <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="pay-pix" checked={!!form.pay_pix} onChange={(e) => setForm({ ...form, pay_pix: e.target.checked })} /> PIX</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="pay-card" checked={!!form.pay_card} onChange={(e) => setForm({ ...form, pay_card: e.target.checked })} /> Cartão</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="pay-cash" checked={!!form.pay_cash} onChange={(e) => setForm({ ...form, pay_cash: e.target.checked })} /> Dinheiro</label>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">O pagamento é feito diretamente ao estabelecimento na entrega/retirada. Se aceitar dinheiro, o consumidor poderá informar se precisa de troco. Em breve, também pelo OFF360.</p>
            </div>
          )}
        </div>

        <CatalogManager eid={form.id || eid} />

        <Button data-testid="est-save" onClick={save} disabled={saving} className="h-12 w-full rounded-xl off-gradient font-semibold text-white"><Save className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "SALVAR ESTABELECIMENTO"}</Button>
      </div>
    </div>
  );
}

function F({ label, children }) { return (<div><Label className="text-gray-300">{label}</Label><div className="mt-1.5">{children}</div></div>); }

function CatalogManager({ eid }) {
  const empty = { name: "", description: "", price: "", discount_percent: "", photo_url: null, active: true };
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { try { const { data } = await api.get("/merchant/catalog", { params: { establishment_id: eid } }); setItems(data); } catch { /* noop */ } };
  useEffect(() => { if (eid) load(); }, [eid]); // eslint-disable-line
  const upPhoto = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const up = await uploadImageValidated(f, { maxMB: 5, minW: 300, minH: 300 }); setForm((s) => ({ ...s, photo_url: up.url })); toast.success("Foto enviada"); }
    catch (err) { toast.error(err.message || "Falha no upload"); }
  };
  const submit = async () => {
    const price = parseFloat(String(form.price).replace(",", "."));
    if (!form.name.trim() || !(price > 0)) { toast.error("Informe nome e preço"); return; }
    setBusy(true);
    const body = { establishment_id: eid, name: form.name.trim(), description: form.description || "", price, discount_percent: parseFloat(String(form.discount_percent).replace(",", ".")) || 0, photo_url: form.photo_url, active: !!form.active };
    try {
      if (editId) await api.put(`/merchant/catalog/${editId}`, body); else await api.post("/merchant/catalog", body);
      toast.success("Item salvo"); setForm(empty); setEditId(null); load();
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };
  const edit = (it) => { setEditId(it.id); setForm({ name: it.name, description: it.description || "", price: it.price, discount_percent: it.discount_percent || "", photo_url: it.photo_url, active: it.active }); };
  const del = async (id) => { try { await api.delete(`/merchant/catalog/${id}`); toast("Item removido"); load(); } catch (err) { toast.error(formatApiError(err)); } };
  const toggle = async (it) => { try { await api.put(`/merchant/catalog/${it.id}`, { establishment_id: eid, name: it.name, description: it.description || "", price: it.price, discount_percent: it.discount_percent || 0, photo_url: it.photo_url, active: !it.active }); load(); } catch (err) { toast.error(formatApiError(err)); } };
  return (
    <div className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-4" data-testid="catalog-manager">
      <p className="font-display text-sm font-bold tracking-wide text-off-orange">CATÁLOGO (VITRINE) — ATÉ 20 ITENS</p>
      <p className="mt-1 text-[11px] text-gray-500">Produtos ou serviços de qualquer ramo. O consumidor vê preço, desconto e preço final.</p>
      <div className="mt-3 space-y-2">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 rounded-lg bg-off-bg/60 p-2" data-testid={`catalog-item-${it.id}`}>
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-off-surface">{it.photo_url ? <img alt="" src={fileUrl(it.photo_url)} className="h-full w-full object-cover" /> : <ImageIcon className="m-3 h-6 w-6 text-gray-600" />}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{it.name} {!it.active && <span className="text-[10px] text-gray-500">(inativo)</span>}</p>
              <p className="text-[11px] text-gray-400">{money(it.price)}{it.discount_percent ? ` · ${it.discount_percent}% OFF` : ""}</p>
            </div>
            <button data-testid={`catalog-toggle-${it.id}`} onClick={() => toggle(it)} className="rounded-lg border border-off-blue/40 px-2 py-1 text-[10px] text-gray-300">{it.active ? "Desativar" : "Ativar"}</button>
            <button data-testid={`catalog-edit-${it.id}`} onClick={() => edit(it)} className="rounded-lg border border-off-blue/40 px-2 py-1 text-[10px] text-gray-300">Editar</button>
            <button data-testid={`catalog-del-${it.id}`} onClick={() => del(it.id)} className="rounded-lg border border-off-error/50 px-2 py-1 text-[10px] text-off-error">Remover</button>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2 border-t border-off-blue/20 pt-3">
        <p className="text-xs font-semibold text-gray-300">{editId ? "Editar item" : "Adicionar item"}</p>
        <div className="flex items-center gap-2">
          <label className="flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-off-blue/50 bg-off-bg">
            {form.photo_url ? <img alt="" src={fileUrl(form.photo_url)} className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-gray-500" />}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="catalog-photo" onChange={upPhoto} />
          </label>
          <Input data-testid="catalog-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome" className="off-input flex-1" />
        </div>
        <Input data-testid="catalog-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descrição curta" className="off-input" />
        <div className="grid grid-cols-2 gap-2">
          <Input data-testid="catalog-price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="Preço (R$)" className="off-input" />
          <Input data-testid="catalog-discount" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} inputMode="numeric" placeholder="Desconto %" className="off-input" />
        </div>
        <div className="flex gap-2">
          <Button data-testid="catalog-save" onClick={submit} disabled={busy} className="rounded-xl off-gradient font-semibold text-white">{editId ? "Salvar item" : "Adicionar"}</Button>
          {editId && <Button variant="outline" onClick={() => { setEditId(null); setForm(empty); }} className="rounded-xl border-off-blue/40 text-gray-300">Cancelar</Button>}
        </div>
      </div>
    </div>
  );
}

function ImgField({ label, hint, url, onChange, circle, loading }) {
  return (
    <div><Label className="text-gray-300 text-xs">{label}</Label>
      <label className={`mt-1.5 flex cursor-pointer items-center justify-center overflow-hidden border border-dashed border-off-blue/50 bg-off-bg ${circle ? "mx-auto h-28 w-28 rounded-full" : "h-28 w-full rounded-xl"}`}>
        {loading ? <Loader2 className="h-6 w-6 animate-spin text-off-orange" /> : url ? <img alt="" src={fileUrl(url)} className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6 text-gray-500" />}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onChange} />
      </label>
      <p className="mt-1 text-[10px] text-gray-500">{hint}</p>
    </div>
  );
}
