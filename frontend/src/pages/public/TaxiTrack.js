import React from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import RouteMap from "@/components/taxi/RouteMap";
import { Car } from "lucide-react";

const BASE = process.env.REACT_APP_BACKEND_URL;
const STATUS = {
  searching: "Procurando motorista",
  negotiating: "Negociando valor",
  accepted: "Motorista a caminho",
  arrived: "Motorista no ponto de embarque",
  in_progress: "Corrida em andamento",
  completed: "Corrida finalizada",
  cancelled: "Corrida cancelada",
  interrupted: "Corrida interrompida",
};
const eta = (v) => (v == null ? "-" : `${Math.max(1, Math.round(v))} min`);

export default function TaxiTrack() {
  const { token } = useParams();
  const { data, isError } = useQuery({
    queryKey: ["taxi-track", token],
    queryFn: async () => (await axios.get(`${BASE}/api/taxi/track/${token}`)).data,
    refetchInterval: 3000,
    retry: false,
  });

  if (isError) return <Center>Trajeto não encontrado ou expirado.</Center>;
  if (!data) return <Center>Carregando trajeto...</Center>;

  const live = ["accepted", "arrived", "in_progress"].includes(data.status);
  return (
    <div className="min-h-screen bg-off-bg px-4 pb-10 pt-6" data-testid="taxi-track-page">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🚗</span>
          <div>
            <h1 className="font-display text-xl font-bold text-white">Acompanhar 360Taxi</h1>
            <p className="text-xs text-gray-400">Você está acompanhando esta corrida.</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-off-orange/40 bg-off-orange/5 p-4 text-center">
          <p data-testid="track-status" className="font-display text-lg font-bold text-off-orange">{STATUS[data.status] || data.status}</p>
          {live && <p className="mt-1 text-sm text-gray-300">Chegada estimada: <span className="font-semibold text-white">{eta(data.eta_min)}</span></p>}
          {data.driver_name && <p className="mt-1 flex items-center justify-center gap-1 text-xs text-gray-400"><Car className="h-3 w-3" /> {data.driver_name}</p>}
        </div>

        <div className="mt-4">
          <RouteMap geometry={data.trip_geometry} origin={data.origin} destination={data.destination} carPos={data.driver_location} height={360} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl border border-off-blue/30 bg-off-surface p-3"><p className="text-[11px] text-gray-400">Origem</p><p className="text-white">📍 {data.origin?.address || "Origem"}</p></div>
          <div className="rounded-xl border border-off-blue/30 bg-off-surface p-3"><p className="text-[11px] text-gray-400">Destino</p><p className="text-white">🏁 {data.destination?.address || "Destino"}</p></div>
        </div>
      </div>
    </div>
  );
}

function Center({ children }) {
  return <div className="flex min-h-screen items-center justify-center bg-off-bg px-6 text-center text-sm text-gray-300" data-testid="taxi-track-page">{children}</div>;
}
