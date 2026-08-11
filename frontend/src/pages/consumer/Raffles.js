import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, fmtDate, EmptyState } from "@/components/shared";
import { Gift, Ticket, Calendar, Trophy } from "lucide-react";

export default function Raffles() {
  const { data: current, isLoading } = useQuery({ queryKey: ["raffle-current"], queryFn: async () => (await api.get("/raffles/current")).data });
  const { data: tickets } = useQuery({ queryKey: ["my-tickets"], queryFn: async () => (await api.get("/consumer/tickets")).data });
  const { data: previous } = useQuery({ queryKey: ["raffle-prev"], queryFn: async () => (await api.get("/raffles/previous")).data });

  if (isLoading) return <div className="px-4 pt-8"><Loading /></div>;

  return (
    <div className="px-4 pt-6 animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Sorteios</h1>

      {current ? (
        <div className="mt-4 overflow-hidden rounded-3xl border border-off-orange/30 bg-off-surface">
          <div className="off-gradient p-5 text-white">
            <div className="flex items-center gap-2"><Gift className="h-6 w-6" /><span className="font-display text-lg font-bold">{current.name}</span></div>
            <p className="mt-2 font-display text-3xl font-extrabold">{current.prize}</p>
            <p className="mt-1 flex items-center gap-1 text-sm opacity-90"><Calendar className="h-4 w-4" /> Sorteio em {fmtDate(current.draw_date, false)}</p>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between rounded-2xl bg-off-orange/10 p-4">
              <span className="text-sm text-gray-300">Seus bilhetes</span>
              <span className="flex items-center gap-1 font-display text-2xl font-bold text-off-orange"><Ticket className="h-5 w-5" /> {tickets?.length || 0}</span>
            </div>
            {current.rules && <p className="mt-4 text-xs text-gray-400"><b className="text-gray-300">Regulamento:</b> {current.rules}</p>}
          </div>
        </div>
      ) : <EmptyState icon={Gift} title="Nenhum sorteio ativo" subtitle="Fique de olho, novos sorteios em breve!" />}

      {tickets?.length > 0 && (
        <>
          <h2 className="mb-3 mt-6 font-display text-lg font-bold text-white">Meus bilhetes</h2>
          <div className="flex flex-wrap gap-2" data-testid="my-tickets">
            {tickets.map((t) => (
              <span key={t.id} className="rounded-xl border border-off-orange/40 bg-off-surface px-3 py-2 font-mono text-sm text-off-orange">#{t.number}</span>
            ))}
          </div>
        </>
      )}

      {previous?.length > 0 && (
        <>
          <h2 className="mb-3 mt-6 font-display text-lg font-bold text-white">Resultados anteriores</h2>
          <div className="space-y-2">
            {previous.map((r) => (
              <div key={r.id} className="flex items-center gap-3 off-card p-4">
                <Trophy className="h-5 w-5 text-off-warning" />
                <div><p className="font-semibold text-white">{r.name}</p><p className="text-xs text-gray-400">{r.prize} · {r.winner || "Concluído"}</p></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
