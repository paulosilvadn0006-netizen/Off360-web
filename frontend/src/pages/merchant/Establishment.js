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

  const save = async () => {
    setSaving(true);
    try {
      const payload = { fantasy_name: form.fantasy_name, description: form.description, category_id: form.category_id,
        address: form.address, neighborhood: form.neighborhood, city: form.city, hours: form.hours,
        whatsapp: form.whatsapp, instagram: form.instagram, discount_rules: form.discount_rules,
        logo_url: form.logo_url, cover_url: form.cover_url };
      if (form.discount_percent !== "" && form.discount_percent != null) payload.discount_percent = parseFloat(form.discount_percent);
      const { data: res } = await api.put(`/merchant/establishment/${eid}`, payload);
      toast.success(res.message || "Estabelecimento atualizado");
      refetch();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Meu estabelecimento</h1>
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
          <div className="flex items-center gap-2"><Percent className="h-5 w-5 text-off-orange" /><span className="font-display font-semibold text-white">Percentual de desconto aos assinantes</span></div>
          <p className="mt-1 text-sm text-gray-300">Qual percentual de desconto este estabelecimento oferecerá aos assinantes da OFF 360?</p>
          <Input data-testid="est-discount" type="number" min={1} max={100} value={form.discount_percent ?? ""} onChange={set("discount_percent")} className="off-input mt-2" placeholder="Informe entre 1% e 100%" />
          {!form.discount_configured && <p className="mt-1 flex items-center gap-1 text-xs text-off-warning"><AlertTriangle className="h-3 w-3" /> Não configurado — o QR Code só libera transações após definir o percentual.</p>}
          {pct >= 1 && pct <= 100 && (
            <div className="mt-2 rounded-lg bg-off-bg/60 p-2 text-xs text-gray-300">Prévia: em R$ 100,00 o cliente paga <b className="text-white">{money(100 - pct)}</b> (economia de {money(pct)}).</div>
          )}
        </div>
        <F label="Condições do desconto (produtos, dias, valor mínimo, exceções...)"><Textarea value={form.discount_rules || ""} onChange={set("discount_rules")} className="border-off-blue/40 bg-off-bg text-white" /></F>

        <Button data-testid="est-save" onClick={save} disabled={saving} className="h-12 w-full rounded-xl off-gradient font-semibold text-white"><Save className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "Salvar alterações"}</Button>
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
