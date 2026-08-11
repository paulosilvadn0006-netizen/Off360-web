import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { Loading, EmptyState, fmtDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sparkles, Plus, X, Star } from "lucide-react";
import { BOOST_STATUS } from "@/lib/requests";

function Pill({ status }) {
  const m = BOOST_STATUS[status] || { label: status, cls: "text-gray-300 bg-white/10" };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

export default function Boosts() {
  const { selectedId, establishments } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ story_id: "", period_start: "", period_end: "", region: "", category: "", notes: "" });
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["m-boosts"], queryFn: async () => (await api.get("/merchant/boosts")).data });
  const { data: stories } = useQuery({ enabled: !!eid, queryKey: ["m-stories-active", eid], queryFn: async () => (await api.get("/merchant/stories", { params: { establishment_id: eid } })).data });
  const activeStories = (stories || []).filter((s) => s.status === "active" && new Date(s.expires_at) > new Date());
  const selectedStory = activeStories.find((s) => s.id === form.story_id);

  const submit = async () => {
    if (!eid) { toast.error("Selecione um estabelecimento no topo."); return; }
    if (!form.story_id) { toast.error("Selecione um Story ativo."); return; }
    setBusy(true);
    try {
      await api.post("/merchant/boosts", { establishment_id: eid, ...form });
      toast.success("Solicitação de destaque enviada! Aguarde a análise da administração.");
      setOpen(false); setForm({ story_id: "", period_start: "", period_end: "", region: "", category: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["m-boosts"] });
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };
  const cancel = async (b) => {
    try { await api.post(`/merchant/boosts/${b.id}/cancel`); toast.success("Solicitação cancelada"); qc.invalidateQueries({ queryKey: ["m-boosts"] }); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white"><Sparkles className="h-6 w-6 text-off-orange" /> Destaque OFF 360</h1>
          <p className="text-sm text-gray-300">Coloque um Story em posição de destaque na plataforma.</p>
          <p className="mt-1 text-xs text-off-success">Período gratuito — sem cobrança. Valor a definir pela administração.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="boost-new-btn" className="rounded-xl off-gradient font-semibold text-white"><Plus className="mr-1 h-4 w-4" /> Solicitar</Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto border-off-blue/40 bg-off-surface text-white">
            <DialogHeader><DialogTitle>Solicitar Destaque OFF 360</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-gray-200">Story ativo</Label>
                <Select value={form.story_id} onValueChange={(v) => setForm({ ...form, story_id: v })}>
                  <SelectTrigger data-testid="boost-story" className="off-input mt-1"><SelectValue placeholder={activeStories.length ? "Selecione" : "Nenhum Story ativo"} /></SelectTrigger>
                  <SelectContent className="border-off-blue/40 bg-off-surface text-white">{activeStories.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
                </Select>
                {!activeStories.length && <p className="mt-1 text-[11px] text-off-warning">Crie um Story ativo primeiro na aba Stories.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-gray-200">Início desejado</Label><Input data-testid="boost-start" type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} className="off-input mt-1" /></div>
                <div><Label className="text-gray-200">Término desejado</Label><Input data-testid="boost-end" type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} className="off-input mt-1" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-gray-200">Bairro/região</Label><Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="off-input mt-1" placeholder="Opcional" /></div>
                <div><Label className="text-gray-200">Categoria do público</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="off-input mt-1" placeholder="Opcional" /></div>
              </div>
              <div><Label className="text-gray-200">Observações</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 border-off-blue/40 bg-off-bg text-white" /></div>

              {selectedStory && (
                <div className="rounded-xl border border-off-orange/30 bg-off-orange/5 p-3" data-testid="boost-preview">
                  <p className="text-[11px] font-semibold text-off-orange">PRÉVIA</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="rounded-full p-[2px] off-gradient ring-2 ring-off-orange/60">
                      <div className="h-12 w-12 overflow-hidden rounded-full border-2 border-off-bg bg-off-surface">{selectedStory.media_url && <img alt="" src={fileUrl(selectedStory.media_url)} className="h-full w-full object-cover" />}</div>
                    </div>
                    <div><p className="flex items-center gap-1 text-[10px] font-bold text-off-orange"><Star className="h-2.5 w-2.5 fill-off-orange" /> PATROCINADO</p><p className="text-sm font-semibold text-white">{selectedStory.title}</p></div>
                  </div>
                </div>
              )}
              <p className="rounded-lg bg-off-bg/60 p-2 text-[11px] text-gray-300">Período gratuito — sem cobrança. Sujeito a aprovação da administração.</p>
              <Button data-testid="boost-submit" onClick={submit} disabled={busy} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">{busy ? "Enviando..." : "Enviar solicitação"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <Loading /> : (data?.length ? (
        <div className="mt-5 space-y-3" data-testid="m-boosts-list">
          {data.map((b) => (
            <div key={b.id} className="off-card p-4" data-testid={`boost-card-${b.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold text-white">{b.story_title}</p><p className="text-xs text-gray-300">{b.establishment_name} · {fmtDate(b.created_at)}</p></div>
                <Pill status={b.status} />
              </div>
              {(b.period_start || b.period_end) && <p className="mt-1 text-xs text-gray-300">Período: {b.period_start ? fmtDate(b.period_start, false) : "?"} → {b.period_end ? fmtDate(b.period_end, false) : "?"}</p>}
              {b.status === "active" && <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-off-bg/60 p-2"><p className="font-bold text-white">{b.metrics?.views || 0}</p><p className="text-gray-400">Views</p></div>
                <div className="rounded-lg bg-off-bg/60 p-2"><p className="font-bold text-white">{b.metrics?.whatsapp_clicks || 0}</p><p className="text-gray-400">WhatsApp</p></div>
                <div className="rounded-lg bg-off-bg/60 p-2"><p className="font-bold text-white">{b.metrics?.requests_from_story || 0}</p><p className="text-gray-400">Solicitações</p></div>
              </div>}
              {["awaiting", "approved"].includes(b.status) && <Button data-testid={`boost-cancel-${b.id}`} size="sm" variant="outline" onClick={() => cancel(b)} className="mt-3 rounded-lg border-off-error/50 text-off-error"><X className="mr-1 h-4 w-4" /> Cancelar</Button>}
            </div>
          ))}
        </div>
      ) : <div className="mt-6"><EmptyState icon={Sparkles} title="Nenhum destaque" subtitle="Solicite o destaque de um Story ativo." /></div>)}
    </div>
  );
}
