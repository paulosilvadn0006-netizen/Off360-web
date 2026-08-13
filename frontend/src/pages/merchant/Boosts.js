import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError, fileUrl, uploadFile } from "@/lib/api";
import { Loading, EmptyState, fmtDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sparkles, Plus, X, Star, Image as ImageIcon, Clock, CalendarPlus, ChevronRight, ChevronLeft, Trash2, Package } from "lucide-react";
import { BOOST_STATUS } from "@/lib/requests";
import Media916Editor from "@/components/Media916Editor";

function Pill({ status }) {
  const m = BOOST_STATUS[status] || { label: status, cls: "text-gray-300 bg-white/10" };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

const BLOCK_H = 24;

function fmtLocal(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function slotEnd(start, blocks) {
  if (!start) return "";
  const d = new Date(start);
  if (isNaN(d.getTime())) return "";
  d.setHours(d.getHours() + BLOCK_H * (blocks || 1));
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const combineStart = (s) => (s.date && s.time ? `${s.date}T${s.time}` : "");

const STEPS = ["Conteúdo", "Períodos (24h)", "Detalhes", "Revisão"];

export default function Boosts() {
  const { selectedId, establishments } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const EMPTY_FORM = { story_source: "active", story_id: "", media_url: "", media_type: "image", title: "", text: "", story_category: "offer", region: "", category: "", notes: "", happening_title: "", happening_start: "", happening_end: "" };
  const [form, setForm] = useState(EMPTY_FORM);
  const [slots, setSlots] = useState([{ date: "", time: "", blocks: 1 }]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editFile, setEditFile] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ["m-boosts"], queryFn: async () => (await api.get("/merchant/boosts")).data });
  const { data: stories } = useQuery({ enabled: !!eid, queryKey: ["m-stories-active", eid], queryFn: async () => (await api.get("/merchant/stories", { params: { establishment_id: eid } })).data });
  const activeStories = (stories || []).filter((s) => s.status === "active" && new Date(s.expires_at) > new Date());
  const selectedStory = activeStories.find((s) => s.id === form.story_id);

  const reset = () => { setForm(EMPTY_FORM); setSlots([{ date: "", time: "", blocks: 1 }]); setStep(0); };
  const totalBlocks = slots.reduce((a, s) => a + (parseInt(s.blocks) || 0), 0);

  const setSlot = (i, patch) => setSlots(slots.map((s, x) => (x === i ? { ...s, ...patch } : s)));
  const addSlot = () => setSlots([...slots, { date: "", time: "", blocks: 1 }]);
  const removeSlot = (i) => setSlots(slots.length > 1 ? slots.filter((_, x) => x !== i) : slots);

  const onMedia = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const isImg = f.type.startsWith("image"), isVid = f.type.startsWith("video");
    if (!isImg && !isVid) { toast.error("Envie uma imagem ou vídeo."); return; }
    setEditFile(f);
  };
  const onCropped = async (processed, mediaType) => {
    setEditFile(null);
    setBusy(true);
    try { const up = await uploadFile(processed); setForm((s) => ({ ...s, media_url: up.url, media_type: mediaType })); toast.success("Mídia enviada"); }
    catch { toast.error("Falha no upload da mídia"); } finally { setBusy(false); }
  };

  const validateStep = () => {
    if (step === 0) {
      if (!eid) { toast.error("Selecione um estabelecimento no topo."); return false; }
      if (form.story_source === "active" && !form.story_id) { toast.error("Selecione um Story ativo."); return false; }
      if (form.story_source === "new" && (!form.media_url || !form.title)) { toast.error("Envie a mídia e informe o título da nova postagem."); return false; }
    }
    if (step === 1) {
      if (!slots.length) { toast.error("Adicione ao menos um período de 24h."); return false; }
      for (const s of slots) {
        if (!s.date || !s.time) { toast.error("Informe a data e a hora de início de cada período."); return false; }
        if ((parseInt(s.blocks) || 0) < 1) { toast.error("Cada período precisa de ao menos 1 bloco de 24h."); return false; }
      }
    }
    return true;
  };
  const next = () => { if (validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const submit = async () => {
    if (!validateStep()) return;
    setBusy(true);
    try {
      const payload = {
        establishment_id: eid,
        story_source: form.story_source, story_id: form.story_id,
        media_url: form.media_url, media_type: form.media_type, title: form.title, text: form.text, story_category: form.story_category,
        region: form.region, category: form.category, notes: form.notes,
        happening_title: form.happening_title, happening_start: form.happening_start, happening_end: form.happening_end,
        slots: slots.map((s) => ({ start: combineStart(s), blocks: parseInt(s.blocks) || 1 })),
      };
      const res = (await api.post("/merchant/boosts", payload)).data;
      toast.success(`${res.created || 1} período(s) enviados! Aguarde a análise da administração.`);
      setOpen(false); reset();
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
          <p className="font-display text-lg font-extrabold tracking-wide text-[#FFD700]">OFF360 PRO</p>
          <h1 className="font-display text-2xl font-bold text-white">Coloque seu negócio em destaque</h1>
          <p className="mt-1 text-sm text-gray-300">Destaque sua oferta por 24 horas e ganhe mais visibilidade dentro do OFF360.</p>
          <p className="mt-1 text-xs text-off-success">Período gratuito — sem cobrança nesta fase. Valor a definir pela administração.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogTrigger asChild><Button data-testid="boost-new-btn" className="rounded-xl off-gradient font-semibold text-white"><Plus className="mr-1 h-4 w-4" /> Solicitar</Button></DialogTrigger>
          <DialogContent
            className="max-h-[90vh] max-w-md overflow-y-auto border-off-blue/40 bg-off-surface text-white"
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <DialogHeader><DialogTitle>Novo Destaque — Passo {step + 1} de {STEPS.length}: {STEPS[step]}</DialogTitle></DialogHeader>

            {/* indicador de passos */}
            <div className="mb-1 flex gap-1.5" data-testid="boost-steps">
              {STEPS.map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "off-gradient" : "bg-off-blue/40"}`} />)}
            </div>

            {/* PASSO 1 — Conteúdo */}
            {step === 0 && (
              <div className="space-y-3">
                <div>
                  <Label className="text-gray-200">Como criar o Destaque</Label>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button type="button" data-testid="boost-source-active" onClick={() => setForm({ ...form, story_source: "active" })}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium ${form.story_source === "active" ? "border-off-orange bg-off-orange/10 text-white" : "border-off-blue/40 bg-off-bg/40 text-gray-300"}`}>Usar Story ativo</button>
                    <button type="button" data-testid="boost-source-new" onClick={() => setForm({ ...form, story_source: "new" })}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium ${form.story_source === "new" ? "border-off-orange bg-off-orange/10 text-white" : "border-off-blue/40 bg-off-bg/40 text-gray-300"}`}>Nova postagem</button>
                  </div>
                </div>
                {form.story_source === "active" ? (
                  <div><Label className="text-gray-200">Story ativo</Label>
                    <Select value={form.story_id} onValueChange={(v) => setForm({ ...form, story_id: v })}>
                      <SelectTrigger data-testid="boost-story" className="off-input mt-1"><SelectValue placeholder={activeStories.length ? "Selecione" : "Nenhum Story ativo"} /></SelectTrigger>
                      <SelectContent className="border-off-blue/40 bg-off-surface text-white">{activeStories.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
                    </Select>
                    {!activeStories.length && <p className="mt-1 text-[11px] text-off-warning">Crie um Story ativo primeiro na aba Stories, ou use "Nova postagem".</p>}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-xl border border-off-blue/40 bg-off-bg/40 p-3">
                    <p className="text-[11px] text-gray-400">Mídia exclusiva do Destaque. Imagem ou vídeo (até 60s), formato vertical 9:16 (1080×1920, estilo Reels). Não aparece como Story orgânico na Home.</p>
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-off-blue/50 bg-off-bg px-4 py-3 text-sm text-gray-300" data-testid="boost-new-media-label">
                      <ImageIcon className="h-4 w-4" /> {form.media_url ? "Mídia adicionada ✓ — trocar" : "Enviar imagem ou vídeo (até 60s)"}
                      <input type="file" accept="image/*,video/*" className="hidden" onChange={onMedia} data-testid="boost-new-media" />
                    </label>
                    {form.media_url && form.media_type === "image" && <img alt="" src={fileUrl(form.media_url)} className="h-40 w-[90px] rounded-lg object-cover" data-testid="boost-new-preview" />}
                    {form.media_url && form.media_type === "video" && <video src={fileUrl(form.media_url)} className="h-40 w-[90px] rounded-lg object-cover" controls data-testid="boost-new-preview" />}
                    <Input data-testid="boost-new-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="off-input" placeholder="Título da oferta/postagem *" />
                    <Textarea data-testid="boost-new-text" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} className="border-off-blue/40 bg-off-bg text-white" placeholder="Descrição / oferta" />
                    <Select value={form.story_category} onValueChange={(v) => setForm({ ...form, story_category: v })}>
                      <SelectTrigger data-testid="boost-new-category" className="off-input"><SelectValue placeholder="Tipo" /></SelectTrigger>
                      <SelectContent className="border-off-blue/40 bg-off-surface text-white">
                        <SelectItem value="offer">Oferta</SelectItem>
                        <SelectItem value="event">Evento</SelectItem>
                        <SelectItem value="service">Serviço</SelectItem>
                        <SelectItem value="notice">Aviso</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {/* PASSO 2 — Períodos de 24h */}
            {step === 1 && (
              <div className="space-y-3">
                <div className="rounded-xl border border-off-orange/30 bg-off-orange/5 p-3 text-[11px] text-gray-300">
                  <p className="flex items-center gap-1 font-semibold text-off-orange"><Package className="h-3.5 w-3.5" /> Cada bloco dura exatamente 24 horas.</p>
                  <p className="mt-1">Você escolhe apenas o <b>início</b>. Some blocos seguidos para vários dias corridos, ou adicione outro período para datas separadas.</p>
                </div>
                {slots.map((sl, i) => (
                  <div key={i} className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-3" data-testid={`boost-slot-${i}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-white">Período {i + 1}</p>
                      {slots.length > 1 && <button type="button" data-testid={`boost-slot-remove-${i}`} onClick={() => removeSlot(i)} className="text-off-error"><Trash2 className="h-4 w-4" /></button>}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[11px] text-gray-300">Data de início</Label>
                        <Input data-testid={`boost-slot-date-${i}`} type="date" value={sl.date} onChange={(e) => setSlot(i, { date: e.target.value })} className="off-input mt-1" />
                      </div>
                      <div>
                        <Label className="text-[11px] text-gray-300">Hora</Label>
                        <Input data-testid={`boost-slot-time-${i}`} type="time" value={sl.time} onChange={(e) => setSlot(i, { time: e.target.value })} className="off-input mt-1" />
                      </div>
                      <div>
                        <Label className="text-[11px] text-gray-300">Blocos 24h</Label>
                        <Input data-testid={`boost-slot-blocks-${i}`} type="number" min={1} max={14} value={sl.blocks} onChange={(e) => setSlot(i, { blocks: e.target.value })} className="off-input mt-1" />
                      </div>
                    </div>
                    {sl.date && sl.time && (
                      <p className="mt-2 flex items-center gap-1 text-[11px] text-off-success" data-testid={`boost-slot-range-${i}`}>
                        <Clock className="h-3 w-3" /> {fmtLocal(combineStart(sl))} → {slotEnd(combineStart(sl), parseInt(sl.blocks) || 1)} ({(parseInt(sl.blocks) || 1) * 24}h)
                      </p>
                    )}
                  </div>
                ))}
                <button type="button" data-testid="boost-add-slot" onClick={addSlot} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-off-orange/50 py-2.5 text-sm font-semibold text-off-orange">
                  <CalendarPlus className="h-4 w-4" /> Adicionar outro período (data separada)
                </button>
                <p className="text-center text-[11px] text-gray-400">Total: <b className="text-white">{totalBlocks}</b> bloco(s) de 24h em {slots.length} período(s).</p>
              </div>
            )}

            {/* PASSO 3 — Detalhes + Acontecendo Agora */}
            {step === 2 && (
              <div className="space-y-3">
                <div className="rounded-xl border border-off-orange/30 bg-off-orange/5 p-3">
                  <p className="text-[11px] font-semibold text-off-orange">⚡ ACONTECENDO AGORA (opcional)</p>
                  <p className="mb-2 text-[10px] text-gray-400">Defina a janela real da promoção dentro do bloco. O selo ⚡ entra e sai sozinho nesse horário — fora dele, o Destaque continua patrocinado, mas sem o selo.</p>
                  <Input data-testid="boost-hap-title" value={form.happening_title} onChange={(e) => setForm({ ...form, happening_title: e.target.value })} className="off-input" placeholder="Título (ex: Happy hour)" />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div><Label className="text-[11px] text-gray-300">Início da promoção</Label><Input data-testid="boost-hap-start" type="time" value={form.happening_start} onChange={(e) => setForm({ ...form, happening_start: e.target.value })} className="off-input mt-1" /></div>
                    <div><Label className="text-[11px] text-gray-300">Fim da promoção</Label><Input data-testid="boost-hap-end" type="time" value={form.happening_end} onChange={(e) => setForm({ ...form, happening_end: e.target.value })} className="off-input mt-1" /></div>
                  </div>
                  <p className="mt-1 text-[10px] text-gray-500">O dia é o de cada período escolhido no passo anterior.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-gray-200">Bairro/região</Label><Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="off-input mt-1" placeholder="Opcional" /></div>
                  <div><Label className="text-gray-200">Categoria do público</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="off-input mt-1" placeholder="Opcional" /></div>
                </div>
                <div><Label className="text-gray-200">Observações</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 border-off-blue/40 bg-off-bg text-white" /></div>
              </div>
            )}

            {/* PASSO 4 — Revisão */}
            {step === 3 && (
              <div className="space-y-3" data-testid="boost-review">
                {(selectedStory || (form.story_source === "new" && form.media_url)) && (
                  <div className="rounded-xl border border-off-orange/30 bg-off-orange/5 p-3">
                    <p className="text-[11px] font-semibold text-off-orange">PRÉVIA</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="rounded-full p-[2px] off-gradient ring-2 ring-off-orange/60">
                        <div className="h-12 w-12 overflow-hidden rounded-full border-2 border-off-bg bg-off-surface">{(selectedStory?.media_url || form.media_url) && <img alt="" src={fileUrl(selectedStory?.media_url || form.media_url)} className="h-full w-full object-cover" />}</div>
                      </div>
                      <div><p className="flex items-center gap-1 text-[10px] font-bold text-off-orange"><Star className="h-2.5 w-2.5 fill-off-orange" /> PATROCINADO</p><p className="text-sm font-semibold text-white">{selectedStory?.title || form.title}</p></div>
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-3">
                  <p className="flex items-center gap-1 text-xs font-semibold text-white"><Package className="h-3.5 w-3.5 text-off-orange" /> {totalBlocks} bloco(s) de 24h · {slots.length} período(s)</p>
                  <div className="mt-2 space-y-1">
                    {slots.map((sl, i) => combineStart(sl) && (
                      <p key={i} className="text-[11px] text-gray-300">• {fmtLocal(combineStart(sl))} → {slotEnd(combineStart(sl), parseInt(sl.blocks) || 1)}</p>
                    ))}
                  </div>
                  {form.happening_start && <p className="mt-2 text-[11px] text-off-orange">⚡ {form.happening_title || "Promoção"}: {form.happening_start}{form.happening_end ? `–${form.happening_end}` : ""}</p>}
                </div>
                <p className="rounded-lg bg-off-bg/60 p-2 text-[11px] text-gray-300">Período gratuito — sem cobrança nesta fase. Sujeito a aprovação da administração.</p>
              </div>
            )}

            {/* Navegação do wizard */}
            <div className="mt-2 flex gap-2">
              {step > 0 && <Button data-testid="boost-prev" variant="outline" onClick={prev} disabled={busy} className="flex-1 rounded-xl border-off-blue/40 text-white"><ChevronLeft className="mr-1 h-4 w-4" /> Voltar</Button>}
              {step < STEPS.length - 1
                ? <Button data-testid="boost-next" onClick={next} disabled={busy} className="flex-1 rounded-xl off-gradient font-semibold text-white">Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
                : <Button data-testid="boost-submit" onClick={submit} disabled={busy} className="flex-1 rounded-xl off-gradient font-semibold text-white">{busy ? "Enviando..." : "Enviar solicitação"}</Button>}
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
              {b.block_rule
                ? <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-off-orange" data-testid={`boost-block-${b.id}`}><Package className="h-3.5 w-3.5" /> {b.block_count} bloco(s) de 24h · {fmtDate(b.period_start)} → {fmtDate(b.period_end)}</p>
                : ((b.period_start || b.period_end) && <p className="mt-1 text-xs text-gray-300">Período: {b.period_start ? fmtDate(b.period_start, false) : "?"} → {b.period_end ? fmtDate(b.period_end, false) : "?"}</p>)}
              {b.status === "rejected" && (b.reject_reason || b.moderation?.reason) && (
                <p data-testid={`boost-reject-reason-${b.id}`} className="mt-2 rounded-lg border border-off-error/40 bg-off-error/10 p-2 text-xs text-off-error">
                  Motivo: {b.reject_reason || b.moderation?.reason}
                </p>
              )}
              {b.moderation?.decision === "review" && ["awaiting", "approved", "active"].includes(b.status) && (
                <p className="mt-2 rounded-lg border border-off-warning/40 bg-off-warning/10 p-2 text-[11px] text-off-warning">
                  Em análise administrativa: {b.moderation?.reason}
                </p>
              )}
              {b.status === "active" && <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-off-bg/60 p-2"><p className="font-bold text-white">{b.metrics?.views || 0}</p><p className="text-gray-400">Views</p></div>
                <div className="rounded-lg bg-off-bg/60 p-2"><p className="font-bold text-white">{b.metrics?.whatsapp_clicks || 0}</p><p className="text-gray-400">WhatsApp</p></div>
                <div className="rounded-lg bg-off-bg/60 p-2"><p className="font-bold text-white">{b.metrics?.requests_from_story || 0}</p><p className="text-gray-400">Solicitações</p></div>
              </div>}
              {["awaiting", "approved"].includes(b.status) && <Button data-testid={`boost-cancel-${b.id}`} size="sm" variant="outline" onClick={() => cancel(b)} className="mt-3 rounded-lg border-off-error/50 text-off-error"><X className="mr-1 h-4 w-4" /> Cancelar</Button>}
            </div>
          ))}
        </div>
      ) : <div className="mt-6"><EmptyState icon={Sparkles} title="Nenhum destaque" subtitle="Solicite o destaque de um Story ativo em blocos de 24h." /></div>)}
      <Media916Editor open={!!editFile} file={editFile} allowVideo={true} maxVideoSec={60} onCancel={() => setEditFile(null)} onConfirm={onCropped} />
    </div>
  );
}
