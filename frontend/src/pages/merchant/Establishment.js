import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError, uploadFile, fileUrl } from "@/lib/api";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image as ImageIcon, Save } from "lucide-react";

export default function Establishment() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["m-est"], queryFn: async () => (await api.get("/merchant/establishment")).data });
  const { data: cats } = useQuery({ queryKey: ["cats"], queryFn: async () => (await api.get("/categories")).data });

  useEffect(() => { if (data && !form) setForm(data); }, [data]); // eslint-disable-line
  if (isLoading || !form) return <Loading />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const upImg = (key) => async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const up = await uploadFile(f); setForm({ ...form, [key]: up.url }); toast.success("Imagem enviada"); }
    catch { toast.error("Falha no upload"); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        fantasy_name: form.fantasy_name, description: form.description, category_id: form.category_id,
        address: form.address, neighborhood: form.neighborhood, city: form.city, hours: form.hours,
        whatsapp: form.whatsapp, instagram: form.instagram, discount_rules: form.discount_rules,
        logo_url: form.logo_url, cover_url: form.cover_url, discount_percent: parseFloat(form.discount_percent),
      };
      const { data: res } = await api.put("/merchant/establishment", payload);
      toast.success(res.message || "Estabelecimento atualizado");
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
            <SelectContent className="bg-off-surface text-white border-off-blue/40">{(cats || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        <F label="Descrição"><Textarea value={form.description || ""} onChange={set("description")} className="border-off-blue/40 bg-off-bg text-white" /></F>
        <F label="Endereço"><Input value={form.address || ""} onChange={set("address")} className="off-input" /></F>
        <div className="grid grid-cols-2 gap-3">
          <F label="Bairro"><Input value={form.neighborhood || ""} onChange={set("neighborhood")} className="off-input" /></F>
          <F label="Cidade"><Input value={form.city || ""} onChange={set("city")} className="off-input" /></F>
        </div>
        <F label="Horário de funcionamento"><Input value={form.hours || ""} onChange={set("hours")} className="off-input" placeholder="Seg-Sáb 09:00-19:00" /></F>
        <div className="grid grid-cols-2 gap-3">
          <F label="WhatsApp"><Input value={form.whatsapp || ""} onChange={set("whatsapp")} className="off-input" /></F>
          <F label="Instagram"><Input value={form.instagram || ""} onChange={set("instagram")} className="off-input" /></F>
        </div>
        <div className="rounded-xl border border-off-warning/30 bg-off-warning/5 p-3">
          <F label="Porcentagem de desconto (%)"><Input data-testid="est-discount" type="number" value={form.discount_percent ?? ""} onChange={set("discount_percent")} className="off-input" /></F>
          <p className="mt-1 text-xs text-off-warning">Alterações no desconto passam por aprovação do administrador.</p>
        </div>
        <F label="Condições/regras do desconto"><Textarea value={form.discount_rules || ""} onChange={set("discount_rules")} className="border-off-blue/40 bg-off-bg text-white" /></F>

        <Button data-testid="est-save" onClick={save} disabled={saving} className="h-12 w-full rounded-xl off-gradient font-semibold text-white"><Save className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "Salvar alterações"}</Button>
      </div>
    </div>
  );
}

function F({ label, children }) { return (<div><Label className="text-gray-300">{label}</Label><div className="mt-1.5">{children}</div></div>); }

function ImgField({ label, url, onChange }) {
  return (
    <div>
      <Label className="text-gray-300">{label}</Label>
      <label className="mt-1.5 flex h-24 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-off-blue/50 bg-off-bg">
        {url ? <img alt="" src={fileUrl(url)} className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6 text-gray-500" />}
        <input type="file" accept="image/*" className="hidden" onChange={onChange} />
      </label>
    </div>
  );
}
