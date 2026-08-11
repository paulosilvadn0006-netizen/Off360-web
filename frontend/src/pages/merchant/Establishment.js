import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, uploadFile, fileUrl } from "@/lib/api";
import { Loading, money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Image as ImageIcon, Save, Percent, AlertTriangle } from "lucide-react";

export default function Establishment() {
  const { selectedId, establishments } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const { data, isLoading, refetch } = useQuery({ enabled: !!eid, queryKey: ["m-est", eid], queryFn: async () => (await api.get("/merchant/establishment", { params: { establishment_id: eid } })).data });
  const { data: cats } = useQuery({ queryKey: ["cats"], queryFn: async () => (await api.get("/categories")).data });

  useEffect(() => { if (data) setForm(data); }, [data]);
  if (!eid) return <p className="text-gray-400">Nenhum estabelecimento. Use "Adicionar" no topo.</p>;
  if (isLoading || !form) return <Loading />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const upImg = (key) => async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const up = await uploadFile(f); setForm({ ...form, [key]: up.url }); toast.success("Imagem enviada"); } catch { toast.error("Falha no upload"); } };
  const pct = parseFloat(form.discount_percent);
  const minp = parseFloat(form.discount_min_purchase) || 0;
  const cap = parseFloat(form.discount_max_cap) || 0;

  // preview on a R$100 example (or min purchase if higher)
  const base = Math.max(100, minp);
  let prevDisc = base * (pct || 0) / 100;
  if (cap > 0 && prevDisc > cap) prevDisc = cap;

  const save = async () => {
    setSaving(true);
    try {
      const num = (v) => (v === "" || v == null ? null : parseFloat(String(v).replace(",", ".")));
      const payload = {
        fantasy_name: form.fantasy_name, description: form.description, category_id: form.category_id,
        address: form.address, neighborhood: form.neighborhood, city: form.city, hours: form.hours,
        whatsapp: form.whatsapp, instagram: form.instagram, discount_rules: form.discount_rules,
        logo_url: form.logo_url, cover_url: form.cover_url,
        discount_min_purchase: num(form.discount_min_purchase),
        discount_max_cap: num(form.discount_max_cap),
        discount_participating: form.discount_participating || "",
        discount_excluded: form.discount_excluded || "",
        discount_valid_days: form.discount_valid_days || "",
        discount_valid_hours: form.discount_valid_hours || "",
        discount_start_date: form.discount_start_date || null,
        discount_end_date: form.discount_end_date || null,
        discount_cumulative: !!form.discount_cumulative,
        discount_observations: form.discount_observations || "",
      };
      if (form.discount_percent !== "" && form.discount_percent != null) payload.discount_percent = parseFloat(form.discount_percent);
      const { data: res } = await api.put(`/merchant/establishment/${eid}`, payload);
      toast.success(res.message || "Estabelecimento atualizado");
      refetch();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Gerenciar estabelecimento</h1>
      <p className="text-sm text-gray-400">{form.fantasy_name}</p>
      <div className="mt-5 space-y-4 off-card p-5">
        <div className="grid grid-cols-2 gap-3">
          <ImgField label="Logotipo" url={form.logo_url} onChange={upImg("logo_url")} />
          <ImgField label="Foto da fachada" url={form.cover_url} onChange={upImg("cover_url")} />
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

        <div className={`rounded-xl border p-4 ${form.discount_configured ? "border-off-success/30 bg-off-success/5" : "border-off-warning/40 bg-off-warning/5"}`}>
          <div className="flex items-center gap-2"><Percent className="h-5 w-5 text-off-orange" /><span className="font-display font-semibold text-white">Condições do desconto aos assinantes</span></div>
          {!form.discount_configured && <p className="mt-1 flex items-center gap-1 text-xs text-off-warning"><AlertTriangle className="h-3 w-3" /> Não configurado — o QR Code só libera transações após definir o percentual.</p>}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <F label="Percentual (%) *"><Input data-testid="est-discount" type="number" min={1} max={100} value={form.discount_percent ?? ""} onChange={set("discount_percent")} className="off-input" placeholder="1 a 100" /></F>
            <F label="Compra mínima (R$)"><Input data-testid="est-min" type="number" min={0} value={form.discount_min_purchase ?? ""} onChange={set("discount_min_purchase")} className="off-input" placeholder="Opcional" /></F>
            <F label="Desconto máximo (R$)"><Input data-testid="est-cap" type="number" min={0} value={form.discount_max_cap ?? ""} onChange={set("discount_max_cap")} className="off-input" placeholder="Opcional" /></F>
            <F label="Dias válidos"><Input value={form.discount_valid_days || ""} onChange={set("discount_valid_days")} className="off-input" placeholder="Ex: Seg a Sex" /></F>
            <F label="Horários válidos"><Input value={form.discount_valid_hours || ""} onChange={set("discount_valid_hours")} className="off-input" placeholder="Ex: 09:00-18:00" /></F>
            <F label="Válido a partir de"><Input type="date" value={form.discount_start_date || ""} onChange={set("discount_start_date")} className="off-input" /></F>
            <F label="Válido até"><Input type="date" value={form.discount_end_date || ""} onChange={set("discount_end_date")} className="off-input" /></F>
          </div>
          <F label="Produtos/serviços participantes"><Textarea value={form.discount_participating || ""} onChange={set("discount_participating")} className="border-off-blue/40 bg-off-bg text-white" /></F>
          <F label="Produtos/serviços excluídos"><Textarea value={form.discount_excluded || ""} onChange={set("discount_excluded")} className="border-off-blue/40 bg-off-bg text-white" /></F>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-off-bg/60 px-3 py-2">
            <span className="text-sm text-gray-300">Acumula com outras promoções</span>
            <Switch data-testid="est-cumulative" checked={!!form.discount_cumulative} onCheckedChange={(v) => setForm({ ...form, discount_cumulative: v })} />
          </div>
          <F label="Observações"><Textarea value={form.discount_observations || ""} onChange={set("discount_observations")} className="border-off-blue/40 bg-off-bg text-white" /></F>

          {pct >= 1 && pct <= 100 && (
            <div className="mt-2 rounded-lg bg-off-bg/60 p-3 text-xs text-gray-300" data-testid="discount-preview">
              <b className="text-white">Prévia:</b> em uma compra de {money(base)}, o cliente economiza <b className="text-off-orange">{money(prevDisc)}</b> e paga <b className="text-white">{money(base - prevDisc)}</b>{cap > 0 ? " (desconto limitado ao máximo)" : ""}.
            </div>
          )}
        </div>

        <Button data-testid="est-save" onClick={save} disabled={saving} className="h-12 w-full rounded-xl off-gradient font-semibold text-white"><Save className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "EDITAR ESTABELECIMENTO"}</Button>
      </div>
    </div>
  );
}

function F({ label, children }) { return (<div><Label className="text-gray-300">{label}</Label><div className="mt-1.5">{children}</div></div>); }
function ImgField({ label, url, onChange }) {
  return (
    <div><Label className="text-gray-300">{label}</Label>
      <label className="mt-1.5 flex h-24 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-off-blue/50 bg-off-bg">
        {url ? <img alt="" src={fileUrl(url)} className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6 text-gray-500" />}
        <input type="file" accept="image/*" className="hidden" onChange={onChange} />
      </label>
    </div>
  );
}
