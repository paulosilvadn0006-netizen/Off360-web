import React, { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RouteMap from "@/components/taxi/RouteMap";
import CancelReasonDialog from "@/components/taxi/CancelReasonDialog";
import RideChat from "@/components/taxi/RideChat";
import TaxiRegister from "@/components/taxi/TaxiRegister";
import * as vibrate from "@/lib/taxiVibrate";
import { Car, MapPin, Navigation, CheckCircle2, Loader2, Flag, Clock } from "lucide-react";

const TEST_DRIVER_START = { lat: -22.7305, lng: -47.3285 };
const km = (v) => (v == null ? "-" : `${Number(v).toFixed(1).replace(".", ",")} km`);
const eta = (v) => (v == null ? "-" : `${Math.max(1, Math.round(v))} min`);

export default function TaxiDriver() {
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState({});
  const [code, setCode] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState("carro");
  const [cancelOpen, setCancelOpen] = useState(false);
  const driverPosRef = useRef(TEST_DRIVER_START);

  const statusQ = useQuery({ queryKey: ["taxi-d-status"], queryFn: async () => (await api.get("/taxi/driver/status")).data, refetchInterval: 8000 });
  const online = !!statusQ.data?.online;
  const offersQ = useQuery({ queryKey: ["taxi-d-offers"], queryFn: async () => (await api.get("/taxi/driver/offers")).data, refetchInterval: 5000, enabled: online });
  const activeQ = useQuery({ queryKey: ["taxi-d-active"], queryFn: async () => (await api.get("/taxi/driver/rides/active")).data, refetchInterval: 4000 });
  const ride = activeQ.data;
  const offers = offersQ.data || [];
  const reg = statusQ.data;

  // Vibração de nova solicitação: só quando NÃO está em corrida ativa; para ao aceitar/silenciar.
  const openCount = offers.length;
  const prevOpen = useRef(0);
  useEffect(() => {
    if (!ride && openCount > prevOpen.current) { vibrate.start(); vibrate.notify("🚗 Nova corrida 360Taxi", "Você tem uma nova solicitação."); }
    if (ride) vibrate.stop(); // durante corrida ativa não alerta
    prevOpen.current = openCount;
    return () => vibrate.stop();
  }, [openCount, !!ride]); // eslint-disable-line

  useEffect(() => {
    if (statusQ.data) { setVehicle(statusQ.data.vehicle || ""); setPlate(statusQ.data.plate || ""); setVehicleType(statusQ.data.vehicle_type || "carro"); }
  }, [statusQ.data?.vehicle, statusQ.data?.plate, statusQ.data?.vehicle_type]); // eslint-disable-line

  const refreshAll = () => { statusQ.refetch(); offersQ.refetch(); activeQ.refetch(); };

  const setOnline = async (val) => {
    setBusy(true);
    try {
      let loc = driverPosRef.current;
      if (val && navigator.geolocation) {
        await new Promise((res) => navigator.geolocation.getCurrentPosition(
          (p) => { loc = { lat: p.coords.latitude, lng: p.coords.longitude }; res(); }, () => res(), { timeout: 5000 }));
      }
      driverPosRef.current = loc;
      await api.post("/taxi/driver/online", { online: val, lat: loc.lat, lng: loc.lng });
      toast.success(val ? "Você está ONLINE no 360Taxi" : "Você saiu do 360Taxi");
      refreshAll();
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  const saveProfile = async () => {
    try { await api.post("/taxi/driver/profile", { vehicle, plate, vehicle_type: vehicleType }); toast.success("Perfil atualizado"); statusQ.refetch(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const offerAct = async (id, path, body, ok) => {
    vibrate.stop();
    setBusy(true);
    try { await api.post(`/taxi/rides/${id}/${path}`, body || {}); if (ok) toast.success(ok); refreshAll(); }
    catch (err) {
      if (err?.response?.status === 409) toast.error("Esta corrida não está mais disponível.");
      else toast.error(formatApiError(err));
      refreshAll();
    } finally { setBusy(false); }
  };

  // Simula o deslocamento do motorista (modo de teste): aproxima do alvo e envia localização.
  const simulate = async () => {
    if (!ride) return;
    const target = ride.status === "in_progress" ? ride.destination : ride.origin;
    const cur = driverPosRef.current;
    const next = { lat: cur.lat + (target.lat - cur.lat) * 0.5, lng: cur.lng + (target.lng - cur.lng) * 0.5 };
    driverPosRef.current = next;
    try { await api.post("/taxi/driver/location", { lat: next.lat, lng: next.lng }); toast("📍 Posição atualizada"); activeQ.refetch(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  if (reg && !reg.registered) {
    return (
      <div className="animate-fade-up" data-testid="taxi-driver-panel">
        <div className="mb-4 off-card p-5 text-center" data-testid="taxi-not-registered">
          <p className="font-display text-base font-bold text-white">Você ainda não possui cadastro no 360Taxi.</p>
          <p className="mt-1 text-sm text-gray-400">Deseja cadastrar agora?</p>
        </div>
        <TaxiRegister onDone={() => statusQ.refetch()} />
      </div>
    );
  }
  if (reg && reg.registered && reg.taxi_status !== "aprovado") {
    const pend = reg.taxi_status === "pendente";
    return (
      <div className="animate-fade-up" data-testid="taxi-driver-panel">
        <div className="mb-4 off-card p-6 text-center" data-testid="taxi-status-banner">
          <p className={`font-display text-lg font-bold ${pend ? "text-off-error" : "text-off-orange"}`}>{pend ? "❌ Cadastro pendente" : "⏳ Cadastro em análise"}</p>
          <p className="mt-1 text-sm text-gray-400">{pend ? "Revise seus dados e reenvie." : "Você poderá ficar online assim que for aprovado pela administração."}</p>
        </div>
        {pend && <TaxiRegister onDone={() => statusQ.refetch()} />}
      </div>
    );
  }

  return (
    <div className="animate-fade-up" data-testid="taxi-driver-panel">
      {/* Status online */}
      <div className="mb-4 flex items-center justify-between rounded-2xl border border-off-blue/40 bg-off-surface p-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🚗</span>
          <div>
            <p className="flex items-center gap-1 font-display text-sm font-bold text-white">360Taxi {reg?.profile?.verified && <span title="Verificado">✅</span>} {reg?.profile?.is_gold && <span title="Selo Ouro (1.000+ corridas)">🏆</span>}</p>
            <p className="text-[11px] text-gray-400">{online ? "Recebendo corridas próximas" : "Fique online para receber corridas"}{reg?.profile?.rating != null ? ` · ⭐ ${reg.profile.rating}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MuteVib />
          <Switch data-testid="taxi-driver-online" checked={online} disabled={busy} onCheckedChange={setOnline} />
        </div>
      </div>

      {/* Perfil do veículo */}
      <div className="mb-4 rounded-2xl border border-off-blue/30 bg-off-bg/40 p-4">
        <p className="mb-2 text-xs font-semibold text-gray-300">Seu veículo</p>
        <div className="mb-2">
          <Select value={vehicleType} onValueChange={setVehicleType}>
            <SelectTrigger data-testid="taxi-driver-vehicle-type" className="off-input"><SelectValue /></SelectTrigger>
            <SelectContent className="border-off-blue/40 bg-off-surface text-white">
              <SelectItem value="carro">🚗 Carro</SelectItem>
              <SelectItem value="moto">🏍️ Moto</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Input data-testid="taxi-driver-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Ex: Onix prata" className="off-input flex-1" />
          <Input data-testid="taxi-driver-plate" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Placa" className="off-input w-28" />
          <Button data-testid="taxi-driver-save-profile" onClick={saveProfile} variant="outline" className="rounded-xl border-off-blue/40 text-gray-200">Salvar</Button>
        </div>
      </div>

      {/* Corrida ativa */}
      {ride && (
        <div className="mb-4 off-card p-5" data-testid="taxi-driver-active">
          <p className="font-display text-sm font-bold text-off-orange">🚗 CORRIDA ATUAL</p>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center gap-1 text-gray-300"><MapPin className="h-3.5 w-3.5 text-off-orange" /> {ride.origin?.address || "Origem"}</div>
            <div className="flex items-center gap-1 text-gray-300"><Flag className="h-3.5 w-3.5" /> {ride.destination?.address || "Destino"}</div>
            <div className="flex justify-between pt-1"><span className="text-gray-400">Até o passageiro</span><span className="text-white">{km(ride.pickup_distance_km)} · {eta(ride.pickup_eta_min)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Corrida</span><span className="text-white">{km(ride.trip_distance_km)} · {eta(ride.trip_duration_min)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Você recebe</span><span className="font-display text-lg font-bold text-off-orange">{money(ride.agreed_price || ride.current_price)}</span></div>
          </div>

          {ride.status === "negotiating" && (
            <div className="mt-3 space-y-2 rounded-xl border border-off-blue/40 bg-off-bg/50 p-3">
              <p className="text-xs text-gray-300">Passageiro propôs <span className="font-semibold text-off-orange">{money(ride.current_price)}</span></p>
              <Button data-testid="taxi-driver-accept-counter" onClick={() => offerAct(ride.id, "driver-accept", {}, "Corrida confirmada!")} disabled={busy} className="h-10 w-full rounded-xl off-gradient font-bold text-white">Aceitar {money(ride.current_price)}</Button>
            </div>
          )}
          {ride.status === "accepted" && (
            <div className="mt-3 space-y-2">
              <RouteMap geometry={[ [driverPosRef.current.lat, driverPosRef.current.lng], [ride.origin.lat, ride.origin.lng] ]} origin={driverPosRef.current} destination={ride.origin} carPos={ride.driver_location || driverPosRef.current} carVehicleType={vehicleType} height={160} />
              <Button data-testid="taxi-driver-simulate" onClick={simulate} variant="outline" className="w-full rounded-xl border-off-orange/40 text-off-orange">🧪 Simular deslocamento</Button>
              <Button data-testid="taxi-driver-arrived" onClick={() => offerAct(ride.id, "arrived", {}, "Passageiro avisado")} disabled={busy} className="h-12 w-full rounded-xl bg-off-error font-bold text-white">CHEGUEI NO PONTO</Button>
            </div>
          )}
          {ride.status === "arrived" && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-gray-300">Peça o código de embarque (4 dígitos) ao passageiro:</p>
              <div className="flex gap-2">
                <Input data-testid="taxi-driver-board-input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={4} placeholder="0000" className="off-input" />
                <Button data-testid="taxi-driver-board" onClick={() => offerAct(ride.id, "board", { code }, "Embarque confirmado!")} disabled={busy} className="rounded-xl off-gradient font-semibold text-white"><CheckCircle2 className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
          {ride.status === "in_progress" && (
            <div className="mt-3 space-y-2">
              <RouteMap geometry={ride.trip_geometry} origin={ride.origin} destination={ride.destination} carPos={ride.driver_location || driverPosRef.current} carVehicleType={vehicleType} height={160} />
              <Button data-testid="taxi-driver-simulate" onClick={simulate} variant="outline" className="w-full rounded-xl border-off-orange/40 text-off-orange">🧪 Simular deslocamento</Button>
              <Button data-testid="taxi-driver-complete" onClick={() => offerAct(ride.id, "complete", {}, "Corrida finalizada!")} disabled={busy} className="h-12 w-full rounded-xl off-gradient font-bold text-white">FINALIZAR CORRIDA</Button>
            </div>
          )}
          {["negotiating", "accepted", "arrived", "in_progress"].includes(ride.status) && <div className="mt-3"><RideChat rideId={ride.id} myRole="deliverer" /></div>}
          <Button data-testid="taxi-driver-cancel" onClick={() => setCancelOpen(true)} variant="ghost" className="mt-2 w-full text-xs text-off-error">Cancelar / Interromper corrida</Button>
          <CancelReasonDialog open={cancelOpen} onOpenChange={setCancelOpen}
            title={ride.status === "in_progress" ? "Interromper corrida" : "Cancelar corrida"}
            confirmLabel={ride.status === "in_progress" ? "Interromper" : "Cancelar"}
            onConfirm={(reason) => { setCancelOpen(false); offerAct(ride.id, "driver-cancel", { reason }, ride.status === "in_progress" ? "Corrida interrompida" : "Corrida cancelada"); }} />
        </div>
      )}

      {/* Ofertas próximas */}
      {online && !ride && (
        <div className="space-y-3" data-testid="taxi-driver-offers">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Corridas disponíveis</p>
          {offers.length === 0 && <p className="rounded-2xl border border-off-blue/30 bg-off-surface/60 py-10 text-center text-sm text-gray-400">Nenhuma corrida próxima no momento.</p>}
          {offers.map((o) => (
            <div key={o.id} className="off-card p-4" data-testid={`taxi-offer-${o.id}`}>
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-bold text-off-orange">🚗 NOVA CORRIDA</span>
                <span className="font-display text-lg font-bold text-off-orange">{money(o.driver_earning)}</span>
              </div>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex items-center gap-1 text-gray-300"><MapPin className="h-3.5 w-3.5 text-off-orange" /> {o.origin?.address || "Origem"}</div>
                <div className="flex items-center gap-1 text-gray-300"><Flag className="h-3.5 w-3.5" /> {o.destination?.address || "Destino"}</div>
                <div className="flex justify-between pt-1"><span className="text-gray-400">Até o passageiro</span><span className="text-white">{km(o.pickup_distance_km)} · {eta(o.pickup_eta_min)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Corrida</span><span className="text-white">{km(o.trip_distance_km)} · {eta(o.trip_duration_min)}</span></div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button data-testid={`taxi-offer-accept-${o.id}`} onClick={() => offerAct(o.id, "driver-accept", {}, o.already_offered ? "Oferta atualizada" : "Oferta enviada!")} disabled={busy} className="h-11 flex-1 rounded-xl off-gradient font-bold text-white">{o.already_offered ? "OFERTA ENVIADA" : "ENVIAR OFERTA"}</Button>
              </div>
              <div className="mt-2 flex gap-2">
                <Input data-testid={`taxi-offer-counter-input-${o.id}`} value={counter[o.id] || ""} onChange={(e) => setCounter((s) => ({ ...s, [o.id]: e.target.value }))} inputMode="decimal" placeholder="Contraproposta (R$)" className="off-input" />
                <Button data-testid={`taxi-offer-counter-${o.id}`} onClick={() => offerAct(o.id, "driver-offer", { amount: parseFloat(String(counter[o.id]).replace(",", ".")) }, "Proposta enviada")} disabled={busy} variant="outline" className="rounded-xl border-off-blue/40 text-gray-200">Ofertar</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <DriverHistory />
    </div>
  );
}

function MuteVib() {
  const [m, setM] = useState(vibrate.isMuted());
  return (
    <button data-testid="taxi-vib-mute" onClick={() => { const n = !m; vibrate.setMuted(n); setM(n); }}
      className="rounded-lg border border-off-blue/40 px-2 py-1 text-[11px] text-gray-300">{m ? "🔕" : "🔔"}</button>
  );
}

function DriverHistory() {  const { data } = useQuery({ queryKey: ["taxi-d-history"], queryFn: async () => (await api.get("/taxi/driver/rides/history")).data });
  const rides = data || [];
  if (!rides.length) return null;
  const label = { completed: "Concluída", interrupted: "Interrompida" };
  return (
    <div className="mt-4 off-card p-4" data-testid="taxi-driver-history">
      <h3 className="mb-2 font-display text-sm font-bold text-white">Histórico de corridas</h3>
      <div className="space-y-2">
        {rides.map((r) => (
          <div key={r.id} className="rounded-xl border border-off-blue/30 bg-off-bg/40 p-3 text-sm" data-testid={`taxi-driver-history-${r.id}`}>
            <div className="flex items-center justify-between">
              <span className="text-white">📍 {r.origin?.address} → 🏁 {r.destination?.address}</span>
              <span className="font-semibold text-off-orange">{money(r.final_price ?? r.agreed_price)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
              <span>{r.rating ? `⭐ ${r.rating}` : "sem avaliação"}</span>
              <span className={r.status === "interrupted" ? "text-off-error" : "text-off-success"}>{label[r.status] || r.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
