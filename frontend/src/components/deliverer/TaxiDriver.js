import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useTaxiRealtime } from "@/lib/taxiSocket";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RouteMap from "@/components/taxi/RouteMap";
import CancelReasonDialog from "@/components/taxi/CancelReasonDialog";
import RideChat from "@/components/taxi/RideChat";
import TaxiRegister from "@/components/taxi/TaxiRegister";
import LostFound from "@/components/taxi/LostFound";
import * as vibrate from "@/lib/taxiVibrate";
import { Car, MapPin, Navigation, CheckCircle2, Loader2, Flag, Clock, User, Wallet, X } from "lucide-react";

const TEST_DRIVER_START = { lat: -22.7305, lng: -47.3285 };
const km = (v) => (v == null ? "-" : `${Number(v).toFixed(1).replace(".", ",")} km`);
const eta = (v) => (v == null ? "-" : `${Math.max(1, Math.round(v))} min`);
const imgUrl = (u) => (!u ? null : u.startsWith("http") ? u : `${process.env.REACT_APP_BACKEND_URL}${u}`);

function PaxAvatar({ p, size = 36 }) {
  const src = imgUrl(p?.photo_url);
  return (
    <div className="shrink-0 overflow-hidden rounded-full bg-off-bg" style={{ width: size, height: size }}>
      {src ? <img alt="" src={src} className="h-full w-full object-cover" /> : <User className="h-full w-full p-1.5 text-gray-500" />}
    </div>
  );
}

export default function TaxiDriver() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [counter, setCounter] = useState({});
  const [code, setCode] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState("carro");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [ratePax, setRatePax] = useState(null);
  const driverPosRef = useRef(TEST_DRIVER_START);

  const wsOn = useTaxiRealtime([["taxi-d-status"], ["taxi-d-offers"], ["taxi-d-active"]]);
  const statusQ = useQuery({ queryKey: ["taxi-d-status"], queryFn: async () => (await api.get("/taxi/driver/status")).data, refetchInterval: wsOn ? 20000 : 8000 });
  const online = !!statusQ.data?.online;
  const offersQ = useQuery({ queryKey: ["taxi-d-offers"], queryFn: async () => (await api.get("/taxi/driver/offers")).data, refetchInterval: wsOn ? 15000 : 5000, enabled: online });
  const activeQ = useQuery({ queryKey: ["taxi-d-active"], queryFn: async () => (await api.get("/taxi/driver/rides/active")).data, refetchInterval: wsOn ? 15000 : 4000 });
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
    setBusy(true); setBusyId(id);
    try { await api.post(`/taxi/rides/${id}/${path}`, body || {}); if (ok) toast.success(ok); refreshAll(); }
    catch (err) {
      if (err?.response?.status === 409) toast.error("Esta corrida não está mais disponível.");
      else toast.error(formatApiError(err));
      refreshAll();
    } finally { setBusy(false); setBusyId(null); }
  };

  const finishRide = async () => {
    const snap = { rideId: ride.id, paxName: ride.passenger?.name || ride.consumer_name || "Passageiro" };
    await offerAct(ride.id, "complete", {}, "Corrida finalizada!");
    qc.invalidateQueries({ queryKey: ["taxi-d-earnings"] });
    setRatePax(snap);
  };

  const ratePaxSubmit = async (score) => {
    if (!ratePax) return;
    setBusy(true);
    try { await api.post(`/taxi/rides/${ratePax.rideId}/rate-passenger`, { score }); toast.success("Obrigado pela avaliação!"); }
    catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); setRatePax(null); }
  };
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
      {/* Avaliação do passageiro (após finalizar) */}
      {ratePax && !ride && (
        <div className="mb-4 off-card p-5 text-center" data-testid="taxi-driver-rate-pax">
          <p className="font-display text-lg font-bold text-white">Avalie o passageiro</p>
          <p className="text-sm text-gray-400">{ratePax.paxName}</p>
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {[5, 6, 7, 8, 9, 10].map((n) => (
              <button key={n} data-testid={`taxi-driver-rate-pax-${n}`} onClick={() => ratePaxSubmit(n)} disabled={busy}
                className="rounded-lg border border-off-blue/40 py-2 text-sm font-bold text-gray-200 hover:border-off-orange hover:text-off-orange">{n}</button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-gray-500">5 = péssimo · 6-7 regular · 8-9 bom · 10 ótimo</p>
          <button onClick={() => setRatePax(null)} className="mt-2 text-[11px] text-gray-500">Pular avaliação</button>
        </div>
      )}

      {/* Status online */}
      <div className="mb-4 flex items-center justify-between rounded-2xl border border-off-blue/40 bg-off-surface p-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🚗</span>
          <div>
            <p className="flex items-center gap-1 font-display text-sm font-bold text-white">360Taxi {reg?.profile?.verified && <span title="Verificado">✅</span>} {reg?.profile?.is_gold && <span title="Selo Ouro (1.000+ corridas)">🏆</span>}</p>
            <p className="text-[11px] text-gray-400">{online ? "Recebendo corridas próximas" : "Fique online para receber corridas"}{reg?.profile?.rating != null ? ` · ⭐ ${reg.profile.rating}` : ""}{reg?.profile ? ` · ${reg.profile.rides_count || 0} corridas` : ""}</p>
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

      {!ride && <FavoritesCard onApplied={refreshAll} />}
      <EarningsCard />

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
            {ride.passenger && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-off-blue/30 bg-off-bg/40 p-2" data-testid="taxi-driver-passenger">
                <PaxAvatar p={ride.passenger} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{ride.passenger.name}</p>
                  <p className="truncate text-[11px] text-gray-400">{ride.passenger.rating != null ? `⭐ ${String(ride.passenger.rating).replace(".", ",")}` : "novo"} · {ride.passenger.rides_count || 0} viagens</p>
                </div>
              </div>
            )}
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
              <Button data-testid="taxi-driver-complete" onClick={finishRide} disabled={busy} className="h-12 w-full rounded-xl off-gradient font-bold text-white">FINALIZAR CORRIDA</Button>
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
                {o.passenger && (
                  <div className="mt-1 flex items-center gap-2" data-testid={`taxi-offer-passenger-${o.id}`}>
                    <PaxAvatar p={o.passenger} size={28} />
                    <span className="text-[11px] text-gray-400">{o.passenger.name} · {o.passenger.rating != null ? `⭐ ${String(o.passenger.rating).replace(".", ",")}` : "novo"} · {o.passenger.rides_count || 0} viagens</span>
                  </div>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="button" data-testid={`taxi-offer-accept-${o.id}`} onClick={() => offerAct(o.id, "driver-accept", {}, o.already_offered ? "Oferta atualizada" : "Oferta enviada!")} disabled={busyId === o.id} className="h-11 flex-1 rounded-xl off-gradient font-bold text-white">{o.already_offered ? "OFERTA ENVIADA" : "ENVIAR OFERTA"}</Button>
              </div>
              <div className="mt-2 flex gap-2">
                <Input data-testid={`taxi-offer-counter-input-${o.id}`} value={counter[o.id] || ""} onChange={(e) => setCounter((s) => ({ ...s, [o.id]: e.target.value }))} inputMode="decimal" placeholder="Contraproposta (R$)" className="off-input" />
                <Button type="button" data-testid={`taxi-offer-counter-${o.id}`} onClick={() => offerAct(o.id, "driver-offer", { amount: parseFloat(String(counter[o.id]).replace(",", ".")) }, "Proposta enviada")} disabled={busyId === o.id} variant="outline" className="rounded-xl border-off-blue/40 text-gray-200">Ofertar</Button>
              </div>
              <Button type="button" data-testid={`taxi-offer-claim-${o.id}`} onClick={() => offerAct(o.id, "driver-claim", {}, "Corrida aceita! Você está a caminho.")} disabled={busyId === o.id} className="mt-2 h-11 w-full rounded-xl bg-off-success font-bold text-white hover:bg-off-success/90">ACEITAR CORRIDA</Button>
            </div>
          ))}
        </div>
      )}
      {online && !ride && <LostFound endpoint="/taxi/lost-and-found/driver" label="o passageiro" />}
    </div>
  );
}

function FavoritesCard({ onApplied }) {
  const favQ = useQuery({ queryKey: ["taxi-d-favs"], queryFn: async () => (await api.get("/taxi/driver/favorites")).data });
  const favs = favQ.data || [];
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const addCurrent = () => {
    if (!navigator.geolocation) { toast.error("GPS indisponível neste dispositivo."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await api.post("/taxi/driver/favorites", { label: label.trim(), lat: pos.coords.latitude, lng: pos.coords.longitude });
        toast.success("Ponto favorito salvo"); setLabel(""); favQ.refetch();
      } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
    }, () => { toast.error("Não foi possível obter o GPS."); setBusy(false); }, { timeout: 8000 });
  };

  const apply = async (f) => {
    try { await api.post("/taxi/driver/location", { lat: f.lat, lng: f.lng }); toast.success(`Localização definida: ${f.label}`); onApplied && onApplied(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const remove = async (id) => { try { await api.delete(`/taxi/driver/favorites/${id}`); favQ.refetch(); } catch (err) { toast.error(formatApiError(err)); } };

  return (
    <div className="mb-4 rounded-2xl border border-off-blue/30 bg-off-bg/40 p-4" data-testid="taxi-driver-favorites">
      <p className="mb-2 text-xs font-semibold text-gray-300">📍 Meus pontos favoritos</p>
      {favs.length === 0 && <p className="mb-2 text-[11px] text-gray-500">Salve pontos de partida e toque para definir sua localização rapidamente.</p>}
      <div className="flex flex-wrap gap-2">
        {favs.map((f) => (
          <div key={f.id} className="flex items-center gap-1 rounded-full border border-off-blue/40 bg-off-surface px-3 py-1.5" data-testid={`taxi-fav-${f.id}`}>
            <button onClick={() => apply(f)} data-testid={`taxi-fav-apply-${f.id}`} className="flex items-center gap-1 text-xs font-semibold text-gray-200 hover:text-off-orange"><MapPin className="h-3.5 w-3.5 text-off-orange" /> {f.label}</button>
            <button onClick={() => remove(f.id)} data-testid={`taxi-fav-remove-${f.id}`} className="text-gray-500 hover:text-off-error"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input data-testid="taxi-fav-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome do ponto (ex: Casa, Centro)" className="off-input flex-1" />
        <Button data-testid="taxi-fav-add" onClick={addCurrent} disabled={busy} variant="outline" className="rounded-xl border-off-orange/40 text-off-orange"><Navigation className="mr-1 h-4 w-4" /> Salvar local</Button>
      </div>
    </div>
  );
}

function EarningsCard() {
  const eq = useQuery({ queryKey: ["taxi-d-earnings"], queryFn: async () => (await api.get("/taxi/driver/earnings")).data });
  const d = eq.data;
  if (!d) return null;
  const cols = [["today", "Hoje"], ["month", "Este mês"], ["all", "Total"]];
  return (
    <div className="mb-4 off-card p-4" data-testid="taxi-driver-earnings">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400"><Wallet className="h-4 w-4 text-off-orange" /> Ganhos 360Taxi</p>
      <div className="grid grid-cols-3 gap-2">
        {cols.map(([k, label]) => (
          <div key={k} className="rounded-xl border border-off-blue/30 bg-off-bg/40 p-3 text-center">
            <p className="text-[10px] font-semibold uppercase text-gray-500">{label}</p>
            <p className="mt-1 font-display text-lg font-bold text-off-success" data-testid={`taxi-earn-value-${k}`}>{money(d[k].earnings)}</p>
            <p className="text-[10px] text-gray-400" data-testid={`taxi-earn-count-${k}`}>{d[k].count} corrida(s)</p>
          </div>
        ))}
      </div>
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
