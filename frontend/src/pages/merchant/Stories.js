import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, uploadFile, fileUrl } from "@/lib/api";
import { Loading, fmtDate, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Eye, Clock, Image as ImageIcon } from "lucide-react";
import Media916Editor from "@/components/Media916Editor";

const CATS = [["offer", "Oferta"], ["job", "Vaga"], ["event", "Evento"], ["service", "Serviço"], ["notice", "Aviso"]];

export default function Stories() {
  const { selectedId, establishments } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "offer", title: "", text: "", whatsapp_link: "", media_url: null });
  const [saving, setSaving] = useState(false);
  const [editFile, setEditFile] = useState(null);
  const { data, isLoading } = useQuery({ enabled: !!eid, queryKey: ["m-stories", eid], queryFn: async () => (await api.get("/merchant/stories", { params: { establishment_id: eid } })).data });

  const pickMedia = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image")) { toast.error("Stories aceitam apenas imagens."); return; }
    setEditFile(f);
  };
  const onCropped = async (processed) => {
    setEditFile(null);
    try { const up = await uploadFile(processed); setForm((s) => ({ ...s, media_url: up.url })); toast.success("Imagem enviada"); }
    catch { toast.error("Falha no upload"); }
  };
  const publish = async () => {
    if (!form.title) { toast.error("Informe um título"); return; }
    setSaving(true);
    try {
      await api.post("/merchant/stories", { ...form, establishment_id: eid });
      toast.success("Story publicado! Disponível por 24 horas.");
      setOpen(false); setForm({ category: "offer", title: "", text: "", whatsapp_link: "", media_url: null });
      qc.invalidateQueries({ queryKey: ["m-stories"] });
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };
  const remove = async (id) => { await api.delete(`/merchant/stories/${id}`); qc.invalidateQueries({ queryKey: ["m-stories"] }); toast.success("Story removido"); };
  if (!eid) return <p className="text-gray-400">Selecione um estabelecimento.</p>;

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between">
        <div><h1 className="font-display text-2xl font-bold text-white">Stories</h1><p className="text-sm text-gray-400">Publicações ficam disponíveis por 24 horas.</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="story-new-btn" className="rounded-xl off-gradient font-semibold text-white"><Plus className="mr-1 h-4 w-4" /> Novo</Button></DialogTrigger>
          <DialogContent className="max-w-md border-off-blue/40 bg-off-surface text-white">
            <DialogHeader><DialogTitle>Novo Story</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-gray-300">Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger data-testid="story-category" className="off-input"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-off-blue/40 bg-off-surface text-white">{CATS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-gray-300">Título</Label><Input data-testid="story-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="off-input" placeholder="Ex: Oferta do dia!" /></div>
              <div><Label className="text-gray-300">Texto</Label><Textarea data-testid="story-text" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} className="border-off-blue/40 bg-off-bg text-white" /></div>
              <div><Label className="text-gray-300">Link do WhatsApp (opcional)</Label><Input value={form.whatsapp_link} onChange={(e) => setForm({ ...form, whatsapp_link: e.target.value })} className="off-input" placeholder="https://wa.me/55..." /></div>
              <div><Label className="text-gray-300">Imagem (opcional)</Label>
                <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-off-blue/50 bg-off-bg px-4 py-3 text-sm text-gray-400"><ImageIcon className="h-4 w-4" /> {form.media_url ? "Imagem adicionada ✓ — trocar" : "Escolher imagem"}<input type="file" accept="image/*" className="hidden" onChange={pickMedia} data-testid="story-media" /></label>
                <p className="mt-1 text-[11px] text-gray-500">Somente imagens · formato vertical 9:16 (1080×1920, estilo Reels).</p>
                {form.media_url && <img alt="" src={fileUrl(form.media_url)} className="mt-2 h-40 w-[90px] rounded-lg object-cover" data-testid="story-media-preview" />}
              </div>
              <Button data-testid="story-publish" onClick={publish} disabled={saving} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">{saving ? "Publicando..." : "Publicar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <Loading /> : (data?.length ? (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="m-stories-list">
          {data.map((s) => {
            const active = s.status === "active" && new Date(s.expires_at) > new Date();
            return (
              <div key={s.id} className="off-card overflow-hidden">
                <div className="h-28 off-gradient">{s.media_url && <img alt="" src={fileUrl(s.media_url)} className="h-full w-full object-cover" />}</div>
                <div className="p-4">
                  <div className="flex items-center justify-between"><span className="rounded-full bg-off-orange/20 px-2 py-0.5 text-[10px] font-bold text-off-orange">{CATS.find(([v]) => v === s.category)?.[1]}</span><span className={`text-[10px] font-semibold ${active ? "text-off-success" : "text-gray-500"}`}>{active ? "Ativo" : "Expirado"}</span></div>
                  <p className="mt-2 font-semibold text-white">{s.title}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-500"><span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {s.views}</span><span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDate(s.created_at, false)}</span><button onClick={() => remove(s.id)} className="text-off-error"><Trash2 className="h-4 w-4" /></button></div>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="mt-6"><EmptyState icon={ImageIcon} title="Nenhum story" subtitle="Crie seu primeiro story." /></div>)}
      <Media916Editor open={!!editFile} file={editFile} allowVideo={false} onCancel={() => setEditFile(null)} onConfirm={onCropped} />
    </div>
  );
}
