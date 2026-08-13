import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { Loading, fmtDate } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, Search, Star } from "lucide-react";
import { BOOST_STATUS } from "@/lib/requests";

function Pill({ status }) {
  const m = BOOST_STATUS[status] || { label: status, cls: "text-gray-300 bg-white/10" };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

// Estado ao vivo do acontecimento (America/Sao_Paulo) — para o card do admin refletir o status real.
function hapNowAdmin(b) {
  if (!b?.happening_date || !b?.happening_start) return false;
  const now = new Date();
  const start = new Date(`${b.happening_date}T${b.happening_start}:00-03:00`);
  let end = b.happening_end ? new Date(`${b.happening_date}T${b.happening_end}:00-03:00`) : null;
  if (end && end <= start) end = new Date(end.getTime() + 86400000);
  return now >= start && (!end || now <= end);
}

export default function AdminBoosts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState(null);      // story preview
  const [activateB, setActivateB] = useState(null);
  const [act, setAct] = useState({ priority: 1, period_start: "", period_end: "" });
  const [busy, setBusy] = useState(false);

  const params = {};
  if (status !== "all") params.status = status;
  if (q) params.q = q;
  const { data, isLoading } = useQuery({ queryKey: ["a-boosts", params], queryFn: async () => (await api.get("/admin/boosts", { params })).data });

  const refresh = () => qc.invalidateQueries({ queryKey: ["a-boosts"] });
  const run = async (id, action) => {
    setBusy(true);
    try { await api.post(`/admin/boosts/${id}/${action}`); toast.success("Ação registrada"); refresh(); }
    catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };
  const openActivate = (b) => { setActivateB(b); setAct({ priority: b.priority || 1, period_start: (b.period_start || "").slice(0, 10), period_end: (b.period_end || "").slice(0, 10) }); };
  const doActivate = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/boosts/${activateB.id}/activate`, { priority: parseInt(act.priority) || 1, period_start: act.period_start || null, period_end: act.period_end || null });
      toast.success("Destaque ativado (período gratuito)"); setActivateB(null); refresh();
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Destaques OFF 360" subtitle="Stories patrocinados — período gratuito, sem cobrança." />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" /><Input data-testid="a-boost-search" value={q} onChange={(e) => setQ(e.target.value)} className="off-input pl-9" placeholder="Buscar por estabelecimento ou Story" /></div>
        <Select value={status} onValueChange={setStatus}><SelectTrigger data-testid="a-boost-filter" className="off-input"><SelectValue /></SelectTrigger>
          <SelectContent className="border-off-blue/40 bg-off-surface text-white"><SelectItem value="all">Todos os status</SelectItem>{Object.entries(BOOST_STATUS).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}</SelectContent></Select>
      </div>

      {isLoading ? <Loading /> : (
        <div className="space-y-3" data-testid="a-boosts-list">
          {(data || []).map((b) => (
            <div key={b.id} className="off-card p-4" data-testid={`a-boost-${b.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-white">{b.story_title} <span className="ml-1 text-xs font-normal text-gray-400">· {b.establishment_name}</span></p>
                  <p className="text-xs text-gray-300">Prioridade {b.priority} · {b.region || "sem região"} · {b.category || "geral"}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-off-success">PERÍODO GRATUITO — SEM COBRANÇA · {b.price_label}</p>
                  {b.block_rule && (
                    <p data-testid={`a-boost-block-${b.id}`} className="mt-0.5 text-[11px] font-semibold text-off-orange">📦 {b.block_count} bloco(s) de 24h · {fmtDate(b.period_start)} → {fmtDate(b.period_end)}</p>
                  )}
                  {(b.happening_title || b.happening_date) && (() => {
                    const on = hapNowAdmin(b) && b.status === "active";
                    const dm = b.happening_date ? b.happening_date.split("-").slice(1).reverse().join("/") : "";
                    const times = b.happening_start ? `${b.happening_start}${b.happening_end ? `–${b.happening_end}` : ""}` : "";
                    return on
                      ? <p data-testid={`a-boost-hap-${b.id}`} className="animate-story-pulse mt-1 inline-flex items-center gap-1 rounded-full bg-off-orange px-2 py-0.5 text-[11px] font-bold text-white">⚡ ACONTECENDO AGORA</p>
                      : <p data-testid={`a-boost-hap-${b.id}`} className="mt-0.5 text-[11px] text-gray-400">🕒 Acontecimento: {b.happening_title || "—"}{dm ? ` · ${dm}` : ""}{times ? ` · ${times}` : ""}</p>;
                  })()}
                </div>
                <Pill status={b.status} />
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
                {[["Views", b.metrics?.views], ["Únicos", b.metrics?.unique_viewers], ["Story", b.metrics?.story_clicks], ["WhatsApp", b.metrics?.whatsapp_clicks], ["Botões", b.metrics?.button_clicks], ["Solic.", b.metrics?.requests_from_story]].map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-off-bg/60 p-2"><p className="font-bold text-white">{v || 0}</p><p className="text-gray-400">{l}</p></div>
                ))}
              </div>

              {b.moderation?.decision === "review" && b.status !== "rejected" && (
                <p data-testid={`a-boost-review-${b.id}`} className="mt-2 rounded-lg border border-off-warning/40 bg-off-warning/10 p-2 text-[11px] text-off-warning">
                  ⚠ Pré-moderação: requer análise — {b.moderation?.reason}
                </p>
              )}
              {b.status === "rejected" && (b.reject_reason || b.moderation?.reason) && (
                <p className="mt-2 rounded-lg border border-off-error/40 bg-off-error/10 p-2 text-[11px] text-off-error">
                  Motivo da reprovação: {b.reject_reason || b.moderation?.reason}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {b.story_media_url && <Button size="sm" variant="outline" onClick={() => setView(b)} className="rounded-lg border-off-blue/40 text-white">Ver Story</Button>}
                {b.status === "awaiting" && <>
                  <Button data-testid={`a-boost-approve-${b.id}`} size="sm" disabled={busy} onClick={() => run(b.id, "approve")} className="rounded-lg bg-off-success text-white">APROVAR</Button>
                  <Button data-testid={`a-boost-reject-${b.id}`} size="sm" disabled={busy} onClick={() => run(b.id, "reject")} variant="outline" className="rounded-lg border-off-error/50 text-off-error">RECUSAR</Button>
                </>}
                {["approved", "paused"].includes(b.status) && <Button data-testid={`a-boost-activate-${b.id}`} size="sm" disabled={busy} onClick={() => (b.status === "paused" ? run(b.id, "resume") : openActivate(b))} className="rounded-lg off-gradient text-white">ATIVAR</Button>}
                {b.status === "active" && <Button data-testid={`a-boost-pause-${b.id}`} size="sm" disabled={busy} onClick={() => run(b.id, "pause")} variant="outline" className="rounded-lg border-off-warning/50 text-off-warning">PAUSAR</Button>}
                {["active", "paused", "approved"].includes(b.status) && <Button data-testid={`a-boost-end-${b.id}`} size="sm" disabled={busy} onClick={() => run(b.id, "end")} variant="outline" className="rounded-lg border-off-blue/40 text-white">ENCERRAR</Button>}
              </div>
            </div>
          ))}
          {!data?.length && <p className="px-4 py-8 text-center text-sm text-gray-500">Nenhum destaque.</p>}
        </div>
      )}

      {/* Prévia do Story */}
      <Dialog open={!!view} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="max-w-sm border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle className="flex items-center gap-1"><Star className="h-4 w-4 fill-off-orange text-off-orange" /> {view?.story_title}</DialogTitle></DialogHeader>
          {view?.story_media_url && <img alt="" src={fileUrl(view.story_media_url)} className="max-h-[60vh] w-full rounded-xl object-cover" />}
          <p className="text-xs text-gray-300">{view?.establishment_name}</p>
        </DialogContent>
      </Dialog>

      {/* Ativar (definir prioridade + período) */}
      <Dialog open={!!activateB} onOpenChange={(v) => !v && setActivateB(null)}>
        <DialogContent className="max-w-sm border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle>Ativar destaque</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-gray-200">Nível de prioridade</Label><Input data-testid="a-boost-priority" type="number" min={1} value={act.priority} onChange={(e) => setAct({ ...act, priority: e.target.value })} className="off-input mt-1" /></div>
            {activateB?.block_rule ? (
              <div className="rounded-lg border border-off-orange/30 bg-off-orange/5 p-3 text-[11px] text-gray-200" data-testid="a-boost-block-fixed">
                <p className="font-semibold text-off-orange">📦 {activateB.block_count} bloco(s) de 24h — período fixo</p>
                <p className="mt-1">{fmtDate(activateB.period_start)} → {fmtDate(activateB.period_end)}</p>
                <p className="mt-1 text-gray-400">O período é definido pelo empresário e não pode ser alterado.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-gray-200">Início</Label><Input type="date" value={act.period_start} onChange={(e) => setAct({ ...act, period_start: e.target.value })} className="off-input mt-1" /></div>
                <div><Label className="text-gray-200">Término</Label><Input type="date" value={act.period_end} onChange={(e) => setAct({ ...act, period_end: e.target.value })} className="off-input mt-1" /></div>
              </div>
            )}
            <p className="rounded-lg bg-off-bg/60 p-2 text-[11px] text-off-success">Período gratuito — sem cobrança.</p>
            <Button data-testid="a-boost-activate-submit" onClick={doActivate} disabled={busy} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">{busy ? "Ativando..." : "Ativar destaque"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
