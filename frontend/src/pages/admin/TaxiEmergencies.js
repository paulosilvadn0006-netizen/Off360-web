import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ShieldAlert, MapPin } from "lucide-react";

const STATUS = { accepted: "A caminho", arrived: "No ponto", in_progress: "Em andamento", completed: "Concluída", interrupted: "Interrompida", cancelled: "Cancelada", searching: "Procurando" };

export default function TaxiEmergencies() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-taxi-emergencies"],
    queryFn: async () => (await api.get("/taxi/admin/emergencies")).data,
    refetchInterval: 8000,
  });
  const rows = data || [];

  return (
    <div data-testid="admin-taxi-emergencies">
      <div className="mb-6 flex items-center gap-2">
        <ShieldAlert className="h-6 w-6 text-off-error" />
        <h1 className="font-display text-2xl font-bold text-white">Emergências 360Taxi</h1>
      </div>
      {isLoading ? (
        <p className="text-gray-400">Carregando...</p>
      ) : rows.length === 0 ? (
        <div className="off-card p-10 text-center text-gray-400" data-testid="emergencies-empty">Nenhuma emergência acionada.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl border border-off-error/40 bg-off-error/5 p-4" data-testid={`emergency-${r.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display font-bold text-off-error">🆘 Emergência</span>
                <span className="text-xs text-gray-400">{r.emergency_at ? new Date(r.emergency_at).toLocaleString("pt-BR") : "-"}</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                <p className="text-gray-200"><span className="text-gray-400">Passageiro:</span> {r.consumer_name || "-"}</p>
                <p className="text-gray-200"><span className="text-gray-400">Motorista:</span> {r.driver_name || "-"}</p>
                <p className="text-gray-200"><span className="text-gray-400">Status:</span> {STATUS[r.status] || r.status}</p>
                <p className="text-gray-200"><span className="text-gray-400">Corrida:</span> {r.id.slice(0, 8)}</p>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-300">
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-off-orange" /> Origem: {r.origin?.address || "-"}</span>
                <span className="flex items-center gap-1">🏁 Destino: {r.destination?.address || "-"}</span>
                {r.driver_location && <span>📍 Motorista: {r.driver_location.lat?.toFixed(4)}, {r.driver_location.lng?.toFixed(4)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
