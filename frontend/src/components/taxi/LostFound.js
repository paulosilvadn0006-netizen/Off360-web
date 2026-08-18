import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const fmt = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
};

// Painel separado de contato para objetos perdidos (motorista <-> passageiro via WhatsApp).
export default function LostFound({ endpoint, label }) {
  const { data } = useQuery({ queryKey: ["taxi-lf", endpoint], queryFn: async () => (await api.get(endpoint)).data });
  const items = data || [];
  return (
    <div className="mt-4 off-card p-4" data-testid="taxi-lost-found">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">🎒 Objetos perdidos</p>
      <p className="mb-3 text-[11px] text-gray-500">Perdeu ou achou algo? Fale com {label} da corrida pelo WhatsApp.</p>
      {items.length === 0 && <p className="text-[11px] text-gray-500">Nenhuma corrida recente.</p>}
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.ride_id} className="flex items-center justify-between rounded-xl border border-off-blue/30 bg-off-bg/40 p-3" data-testid={`taxi-lf-${it.ride_id}`}>
            <div className="min-w-0">
              <p className="truncate text-sm text-white">{it.name}</p>
              <p className="text-[11px] text-gray-400">Corrida: {fmt(it.at)}</p>
            </div>
            {it.whatsapp ? (
              <a data-testid={`taxi-lf-wa-${it.ride_id}`} href={`https://wa.me/55${it.whatsapp}`} target="_blank" rel="noreferrer"
                className="shrink-0 rounded-full bg-off-success px-3 py-1.5 text-xs font-semibold text-white">WhatsApp</a>
            ) : <span className="text-[11px] text-gray-500">Sem contato</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
