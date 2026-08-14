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
      const payload = {
        fantasy_name: form.fantasy_name, description: form.description, category_id: form.category_id,
        address: form.address, neighborhood: form.neighborhood, city: form.city, hours: form.hours,
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
        <F label="Endereço"><Input value={form.address || ""} onChange={set("address")} className="off-input" /></F>
        <div className="grid grid-cols-2 gap-3">
          <F label="Bairro"><Input value={form.neighborhood || ""} onChange={set("neighborhood")} className="off-input" /></F>
          <F label="Cidade"><Input value={form.city || ""} onChange={set("city")} className="off-input" /></F>
        </div>
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
          <p className="text-sm font-bold text-white">Entrega / Retirada OFF360</p>
          <label className="mt-2 flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" data-testid="offers-delivery" checked={!!form.offers_delivery} onChange={(e) => setForm({ ...form, offers_delivery: e.target.checked })} /> Oferece entrega?
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" data-testid="offers-pickup" checked={!!form.offers_pickup} onChange={(e) => setForm({ ...form, offers_pickup: e.target.checked })} /> Oferece retirada no local?
          </label>
          {(form.offers_delivery || form.offers_pickup) && (
            <div className="mt-3 space-y-2">
              <F label="Bairros/região atendida"><Input data-testid="delivery-areas" value={form.delivery_areas || ""} onChange={set("delivery_areas")} className="off-input" placeholder="Ex: Centro, Jardins" /></F>
              <div className="grid grid-cols-2 gap-3">
                <F label="Taxa de entrega"><Input data-testid="delivery-fee-text" value={form.delivery_fee_text || ""} onChange={set("delivery_fee_text")} className="off-input" placeholder="Ex: R$ 5 ou 'consulte'" /></F>
                <F label="Tempo médio"><Input data-testid="delivery-eta" value={form.delivery_eta || ""} onChange={set("delivery_eta")} className="off-input" placeholder="Ex: 30-45 min" /></F>
              </div>
              <p className="text-xs text-gray-400">Formas aceitas na entrega/retirada:</p>
              <div className="flex flex-wrap gap-3 text-sm text-gray-200">
                <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="pay-pix" checked={!!form.pay_pix} onChange={(e) => setForm({ ...form, pay_pix: e.target.checked })} /> PIX</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="pay-card" checked={!!form.pay_card} onChange={(e) => setForm({ ...form, pay_card: e.target.checked })} /> Cartão</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" data-testid="pay-cash" checked={!!form.pay_cash} onChange={(e) => setForm({ ...form, pay_cash: e.target.checked })} /> Dinheiro</label>
              </div>
              <p className="text-[11px] text-gray-500">O pagamento é feito diretamente ao estabelecimento na entrega/retirada. Em breve, também pelo OFF360.</p>
            </div>
          )}
        </div>

        <Button data-testid="est-save" onClick={save} disabled={saving} className="h-12 w-full rounded-xl off-gradient font-semibold text-white"><Save className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "SALVAR ESTABELECIMENTO"}</Button>
      </div>
    </div>
  );
}

function F({ label, children }) { return (<div><Label className="text-gray-300">{label}</Label><div className="mt-1.5">{children}</div></div>); }
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
