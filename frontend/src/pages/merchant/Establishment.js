import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, uploadImageValidated, fileUrl } from "@/lib/api";
import { Loading, money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Image as ImageIcon, Save, Percent, AlertTriangle, Loader2, Globe, Utensils, Layers, Plus, X } from "lucide-react";
import ActionButtonsEditor from "@/components/merchant/ActionButtonsEditor";
import { ActivationWall } from "@/components/merchant/ActivationWall";

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
  if (form.payment_required) return <ActivationWall est={form} />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const upImg = (key, opts) => async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = ""; // permite reenviar o mesmo arquivo
    setUploading(key);
    try {
      const up = await uploadImageValidated(f, opts);
      const realId = form?.id || eid;
      // Persiste imediatamente no backend para a imagem NÃO sumir ao recarregar a página.
      if (realId) await api.put(`/merchant/establishment/${realId}`, { [key]: up.url });
      setForm((s) => ({ ...s, [key]: up.url }));
      toast.success("Imagem salva");
    }
    catch (err) { toast.error(err?.isAxiosError ? formatApiError(err, "Não foi possível enviar a imagem. Tente novamente.") : (err.message || "Falha no upload")); }
    finally { setUploading(null); }
  };
  const pct = parseFloat(form.discount_percent);
  const minp = parseFloat(form.discount_min_purchase) || 0;
  const cap = parseFloat(form.discount_max_cap) || 0;
  const base = Math.max(100, minp);
  let prevDisc = base * (pct || 0) / 100;
  if (cap > 0 && prevDisc > cap) prevDisc = cap;

  const FOOD_NAMES = ["alimentação", "alimentacao", "alimentação/restaurante", "restaurante", "bares e baladas", "bar", "lanchonete", "cafeteria"];
  const selCat = (cats || []).find((c) => c.id === form.category_id);
  const selCatName = (selCat?.name || "").toLowerCase();
  const isOutros = selCatName === "outros" || selCatName === "outro";
  const foodEligible = FOOD_NAMES.includes(selCatName);

  const save = async () => {
    const realId = form?.id || eid;
    if (!realId) { toast.error("Estabelecimento não encontrado. Recarregue a página e tente novamente."); return; }
    setSaving(true);
    try {
      const num = (v) => (v === "" || v == null ? null : parseFloat(String(v).replace(",", ".")));
      const streetVal = form.street ?? (form.address || "");
      const payload = {
        fantasy_name: form.fantasy_name, description: form.description, category_id: form.category_id,
        segment: form.segment || "",
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
      <ModuleSelector eid={form.id || eid} value={form.modules} foodEligible={foodEligible} onChange={(m) => setForm((s) => ({ ...s, modules: m }))} />
      <div className="mt-5 space-y-4 off-card p-5">
        <div className="grid grid-cols-2 gap-4">
          <ImgField label="Logotipo — imagem quadrada (1:1)" hint="Recomendado 1080×1080 px · mín 500×500 · até 5 MB. Usado como foto circular dos Stories." circle url={form.logo_url} loading={uploading === "logo_url"} onChange={upImg("logo_url", { maxMB: 5, minW: 500, minH: 500 })} />
          <ImgField label="Foto da fachada — horizontal (16:9)" hint="Aceita 16:9 (ex.: 1920×1080, 1280×720). Mín. 640×360 · até 8 MB." url={form.cover_url} loading={uploading === "cover_url"} onChange={upImg("cover_url", { maxMB: 8, minW: 640, minH: 360 })} />
        </div>
        <F label="Nome fantasia"><Input data-testid="est-name" value={form.fantasy_name || ""} onChange={set("fantasy_name")} className="off-input" /></F>
        <F label="Categoria">
          <Select value={form.category_id || ""} onValueChange={(v) => setForm({ ...form, category_id: v })}>
            <SelectTrigger className="off-input"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent className="border-off-blue/40 bg-off-surface text-white">{(cats || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        {isOutros && (
          <F label="Qual é o segmento do seu negócio? *">
            <Input data-testid="est-segment" value={form.segment || ""} onChange={set("segment")} className="off-input" placeholder="Ex: Pet shop, Gráfica, Estúdio de tatuagem…" />
          </F>
        )}
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

        <div className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-4" data-testid="whatsapp-help-card">
          <p className="font-display text-sm font-bold tracking-wide text-off-orange">MENSAGEM AUTOMÁTICA DO WHATSAPP</p>
          <p className="mt-1 text-[11px] text-gray-500">Ao tocar no botão de WhatsApp, o consumidor já abre a conversa com a mensagem pré-preenchida <span className="font-semibold text-gray-300">"Olá! Venho pelo OFF360,"</span>. Você só precisa completar o restante da frase conforme o destaque ou pedido, nos botões de ação abaixo.</p>
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

function ModuleSelector({ eid, value, onChange, foodEligible }) {
  const mods = value || { online: true, presencial: false };
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  // Operação Presencial (cozinha/mesas/comanda) só para categorias de alimentação —
  // mantém visível se já estiver ativa (preserva estabelecimentos existentes).
  const showPresencial = foodEligible || mods.presencial;
  const allOpts = [
    { k: "online", online: true, presencial: false, icon: Globe, title: "Presença Online", desc: "Divulgar e ser encontrado: página, catálogo, promoções, WhatsApp." },
    { k: "presencial", online: false, presencial: true, icon: Utensils, title: "Operação Presencial", desc: "Cardápio digital, mesas, garçons, pedidos, cozinha e comanda." },
    { k: "both", online: true, presencial: true, icon: Layers, title: "Online + Operação", desc: "Tudo integrado num só catálogo." },
  ];
  const opts = showPresencial ? allOpts : allOpts.filter((o) => o.k === "online");
  const active = (o) => mods.online === o.online && mods.presencial === o.presencial;
  const pick = async (o) => {
    if (!eid) return;
    const m = { online: o.online, presencial: o.presencial };
    onChange(m); setSaving(true);
    try { await api.put(`/merchant/establishment/${eid}`, { modules: m }); toast.success(m.online && m.presencial ? "Online + Operação Presencial ativados ✅" : m.presencial ? "Operação Presencial ativada ✅" : "Presença Online ativada ✅"); }
    catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };
  return (
    <div className="mt-4 off-card p-5" data-testid="module-selector">
      <p className="font-display text-sm font-bold tracking-wide text-off-orange">COMO VOCÊ DESEJA UTILIZAR O OFF360?</p>
      <p className="mt-1 text-[11px] text-gray-500">Ative apenas o que precisar. Você pode mudar quando quiser.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {opts.map((o) => (
          <button key={o.k} data-testid={`module-opt-${o.k}`} disabled={saving} onClick={() => pick(o)}
            className={`rounded-xl border p-3 text-left transition ${active(o) ? "border-off-orange bg-off-orange/10" : "border-off-blue/40 hover:border-off-blue/70"}`}>
            <o.icon className={`h-6 w-6 ${active(o) ? "text-off-orange" : "text-gray-400"}`} />
            <p className="mt-2 text-sm font-bold text-white">{o.title}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">{o.desc}</p>
            {active(o) && <span className="mt-2 inline-block rounded-full bg-off-orange/20 px-2 py-0.5 text-[10px] font-bold text-off-orange">Ativo</span>}
          </button>
        ))}
      </div>
      {(mods.presencial || mods.online) && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="module-shortcuts">
          {mods.presencial && <button data-testid="module-shortcut-presencial" onClick={() => navigate("/merchant/presencial")} className="rounded-xl bg-off-blue px-3 py-2 text-xs font-semibold text-white">Abrir Operação Presencial →</button>}
          {mods.online && <button data-testid="module-shortcut-online" onClick={() => navigate("/merchant/ai360")} className="rounded-xl border border-off-orange/50 px-3 py-2 text-xs font-semibold text-off-orange">Montar catálogo com IA 360 →</button>}
        </div>
      )}
    </div>
  );
}

function AddonsEditor({ addons, onChange }) {
  const list = addons || [];
  const add = () => onChange([...list, { name: "", price: "" }]);
  const upd = (i, k, v) => onChange(list.map((a, idx) => (idx === i ? { ...a, [k]: v } : a)));
  const rem = (i) => onChange(list.filter((_, idx) => idx !== i));
  return (
    <div className="rounded-lg border border-off-blue/20 bg-off-bg/40 p-2" data-testid="catalog-addons">
      <div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-gray-300">Adicionais (opcional)</span>
        <button type="button" data-testid="addon-add" onClick={add} className="flex items-center gap-1 rounded-lg border border-off-blue/40 px-2 py-1 text-[10px] text-gray-300"><Plus className="h-3 w-3" /> Adicionar</button>
      </div>
      {list.map((a, i) => (
        <div key={i} className="mt-2 flex items-center gap-2">
          <Input data-testid={`addon-name-${i}`} value={a.name} onChange={(e) => upd(i, "name", e.target.value)} placeholder="Ex: Bacon extra" className="off-input h-9 flex-1 text-sm" />
          <Input data-testid={`addon-price-${i}`} value={a.price} onChange={(e) => upd(i, "price", e.target.value)} inputMode="decimal" placeholder="R$" className="off-input h-9 w-20 text-sm" />
          <button type="button" data-testid={`addon-rem-${i}`} onClick={() => rem(i)} className="rounded-lg border border-off-error/50 p-1.5 text-off-error"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

function CatalogManager({ eid }) {
  const empty = { name: "", description: "", price: "", discount_percent: "", promo_price: "", category: "", addons: [], observations_enabled: true, available: true, featured: false, best_seller: false, photo_url: null, active: true };
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { try { const { data } = await api.get("/merchant/catalog", { params: { establishment_id: eid } }); setItems(data); } catch { /* noop */ } };
  useEffect(() => { if (eid) load(); }, [eid]); // eslint-disable-line
  const upPhoto = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const up = await uploadImageValidated(f, { maxMB: 5, minW: 300, minH: 300 }); setForm((s) => ({ ...s, photo_url: up.url })); toast.success("Foto enviada"); }
    catch (err) { toast.error(err?.isAxiosError ? formatApiError(err, "Não foi possível enviar a foto. Tente novamente.") : (err.message || "Falha no upload")); }
  };
  const submit = async () => {
    const price = parseFloat(String(form.price).replace(",", "."));
    if (!form.name.trim() || !(price > 0)) { toast.error("Informe nome e preço"); return; }
    setBusy(true);
    const body = { establishment_id: eid, name: form.name.trim(), description: form.description || "", price, discount_percent: parseFloat(String(form.discount_percent).replace(",", ".")) || 0, promo_price: form.promo_price !== "" && form.promo_price != null ? parseFloat(String(form.promo_price).replace(",", ".")) : null, category: form.category || "", addons: (form.addons || []).filter((a) => a.name).map((a) => ({ name: a.name, price: parseFloat(String(a.price).replace(",", ".")) || 0 })), observations_enabled: !!form.observations_enabled, available: !!form.available, featured: !!form.featured, best_seller: !!form.best_seller, photo_url: form.photo_url, active: !!form.active };
    try {
      if (editId) await api.put(`/merchant/catalog/${editId}`, body); else await api.post("/merchant/catalog", body);
      toast.success("Item salvo"); setForm(empty); setEditId(null); load();
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };
  const edit = (it) => { setEditId(it.id); setForm({ name: it.name, description: it.description || "", price: it.price, discount_percent: it.discount_percent || "", promo_price: it.promo_price ?? "", category: it.category || "", addons: it.addons || [], observations_enabled: it.observations_enabled !== false, available: it.available !== false, featured: !!it.featured, best_seller: !!it.best_seller, photo_url: it.photo_url, active: it.active }); };
  const del = async (id) => { try { await api.delete(`/merchant/catalog/${id}`); toast("Item removido"); load(); } catch (err) { toast.error(formatApiError(err)); } };
  const toggle = async (it) => { try { await api.put(`/merchant/catalog/${it.id}`, { ...it, establishment_id: eid, active: !it.active }); load(); } catch (err) { toast.error(formatApiError(err)); } };
  return (
    <div className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-4" data-testid="catalog-manager">
      <p className="font-display text-sm font-bold tracking-wide text-off-orange">CATÁLOGO ÚNICO — ATÉ 200 ITENS</p>
      <p className="mt-1 text-[11px] text-gray-500">Um só catálogo usado na página online, no cardápio digital e nos pedidos. Alterou o preço aqui, muda em todos os lugares.</p>
      <div className="mt-3 space-y-2">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 rounded-lg bg-off-bg/60 p-2" data-testid={`catalog-item-${it.id}`}>
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-off-surface">{it.photo_url ? <img alt="" src={fileUrl(it.photo_url)} className="h-full w-full object-cover" /> : <ImageIcon className="m-3 h-6 w-6 text-gray-600" />}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{it.name} {it.best_seller && <span className="text-[10px] text-off-orange">🔥</span>}{it.featured && <span className="text-[10px] text-off-blue">⭐</span>} {!it.active && <span className="text-[10px] text-gray-500">(inativo)</span>}{it.available === false && <span className="text-[10px] text-off-warning">(indisponível)</span>}</p>
              <p className="text-[11px] text-gray-400">{it.category ? `${it.category} · ` : ""}{money(it.price)}{it.promo_price ? ` → ${money(it.promo_price)}` : it.discount_percent ? ` · ${it.discount_percent}% OFF` : ""}</p>
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
        <Input data-testid="catalog-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Categoria (ex: Lanches, Bebidas)" className="off-input" />
        <div className="grid grid-cols-2 gap-2">
          <Input data-testid="catalog-price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="Preço (R$)" className="off-input" />
          <Input data-testid="catalog-discount" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} inputMode="numeric" placeholder="Desconto %" className="off-input" />
        </div>
        <Input data-testid="catalog-promo" value={form.promo_price} onChange={(e) => setForm({ ...form, promo_price: e.target.value })} inputMode="decimal" placeholder="Preço promocional (opcional)" className="off-input" />
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-200">
          <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="catalog-available" checked={!!form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} /> Disponível</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="catalog-featured" checked={!!form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> ⭐ Destaque</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="catalog-bestseller" checked={!!form.best_seller} onChange={(e) => setForm({ ...form, best_seller: e.target.checked })} /> 🔥 Mais vendido</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="catalog-obs" checked={!!form.observations_enabled} onChange={(e) => setForm({ ...form, observations_enabled: e.target.checked })} /> Permitir observações</label>
        </div>
        <AddonsEditor addons={form.addons} onChange={(a) => setForm({ ...form, addons: a })} />
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
