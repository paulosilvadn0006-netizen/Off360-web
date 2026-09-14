import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Bot, Car, User, CheckCircle2, Circle, MessageSquare } from "lucide-react";

const CATS = { sugestao: { t: "Sugestão", c: "bg-off-success/15 text-off-success" }, problema: { t: "Problema", c: "bg-off-error/15 text-off-error" }, outro: { t: "Outro", c: "bg-off-blue/20 text-gray-300" } };
const fmt = (iso) => { if (!iso) return "—"; try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (e) { return "—"; } };

export default function CopilotFeedbacks() {
  const qc = useQueryClient();
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [reviewed, setReviewed] = useState("");
  const params = { ...(source ? { source } : {}), ...(category ? { category } : {}), ...(reviewed !== "" ? { reviewed } : {}) };
  const { data } = useQuery({ queryKey: ["copilot-feedbacks", params], queryFn: async () => (await api.get("/admin/copilot/feedbacks", { params })).data, refetchInterval: 20000 });
  const items = data?.items || [];
  const counts = data?.counts || { total: 0, driver: 0, passenger: 0, pending: 0 };

  const patch = async (it, upd) => {
    try { await api.patch(`/admin/copilot/feedbacks/${it.source}/${it.id}`, upd); qc.invalidateQueries({ queryKey: ["copilot-feedbacks"] }); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div data-testid="admin-copilot-feedbacks">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl off-gradient"><Bot className="h-5 w-5 text-white" /></span>
        <div><h1 className="font-display text-2xl font-bold text-white">Feedbacks do Copiloto 360</h1><p className="text-sm text-gray-400">Sugestões e relatos coletados pelos copilotos de motorista e passageiro.</p></div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Total", counts.total, MessageSquare], ["Motorista", counts.driver, Car], ["Passageiro", counts.passenger, User], ["Pendentes", counts.pending, Circle]].map(([l, v, Ic]) => (
          <div key={l} className="off-card p-4"><div className="flex items-center gap-2 text-xs text-gray-400"><Ic className="h-4 w-4" /> {l}</div><p className="mt-1 font-display text-2xl font-bold text-white">{v}</p></div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <select data-testid="fb-filter-source" value={source} onChange={(e) => setSource(e.target.value)} className="off-input h-10 w-auto text-sm"><option value="">Todas as origens</option><option value="driver">Motorista</option><option value="passenger">Passageiro</option></select>
        <select data-testid="fb-filter-category" value={category} onChange={(e) => setCategory(e.target.value)} className="off-input h-10 w-auto text-sm"><option value="">Todas as categorias</option><option value="sugestao">Sugestão</option><option value="problema">Problema</option><option value="outro">Outro</option></select>
        <select data-testid="fb-filter-reviewed" value={reviewed} onChange={(e) => setReviewed(e.target.value)} className="off-input h-10 w-auto text-sm"><option value="">Todos</option><option value="false">Pendentes</option><option value="true">Revisados</option></select>
      </div>

      <div className="mt-4 space-y-3">
        {items.map((it) => {
          const cat = CATS[it.category] || CATS.outro;
          return (
            <div key={`${it.source}-${it.id}`} className={`off-card p-4 ${it.reviewed ? "opacity-70" : ""}`} data-testid={`fb-item-${it.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 rounded-full bg-off-blue/20 px-2 py-0.5 text-[11px] font-bold text-gray-200">{it.source === "driver" ? <Car className="h-3 w-3" /> : <User className="h-3 w-3" />} {it.source === "driver" ? "Motorista" : "Passageiro"}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cat.c}`}>{cat.t}</span>
                <span className="text-xs text-gray-400">{it.user_name}</span>
                <span className="ml-auto text-[11px] text-gray-500">{fmt(it.created_at)}</span>
              </div>
              <p className="mt-2 text-sm text-white">{it.message}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select data-testid={`fb-cat-${it.id}`} value={it.category} onChange={(e) => patch(it, { category: e.target.value })} className="off-input h-9 w-auto text-xs"><option value="sugestao">Sugestão</option><option value="problema">Problema</option><option value="outro">Outro</option></select>
                <Button size="sm" data-testid={`fb-review-${it.id}`} onClick={() => patch(it, { reviewed: !it.reviewed })} className={`h-9 rounded-lg text-xs ${it.reviewed ? "border border-off-blue/40 bg-transparent text-gray-300" : "off-gradient text-white"}`}>
                  {it.reviewed ? <><Circle className="mr-1 h-3.5 w-3.5" /> Reabrir</> : <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Marcar revisado</>}
                </Button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && <p className="text-sm text-gray-400" data-testid="fb-empty">Nenhum feedback encontrado com estes filtros.</p>}
      </div>
    </div>
  );
}
