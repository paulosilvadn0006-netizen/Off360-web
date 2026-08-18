import React, { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { api, formatApiError } from "@/lib/api";
import { useTaxiRealtime } from "@/lib/taxiSocket";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import RouteMap from "@/components/taxi/RouteMap";
import AddressField from "@/components/taxi/AddressField";
import CancelReasonDialog from "@/components/taxi/CancelReasonDialog";
import RideChat from "@/components/taxi/RideChat";
import * as voice from "@/lib/taxiVoice";
import * as vibrate from "@/lib/taxiVibrate";
import {
  MapPin, Navigation, Car, Star, Share2, ShieldAlert, X, Loader2, ArrowLeft, Volume2, VolumeX, Flag, Search,
} from "lucide-react";

const TEST_POINTS = [
  { key: "centro", label: "Centro", lat: -22.7326, lng: -47.3306 },
  { key: "shopping", label: "Shopping", lat: -22.755, lng: -47.345 },
  { key: "rodoviaria", label: "Rodoviária", lat: -22.742, lng: -47.338 },
  { key: "hospital", label: "Hospital", lat: -22.725, lng: -47.32 },
  { key: "aeroporto", label: "Aeroporto", lat: -22.77, lng: -47.31 },
];
const km = (v) => (v == null ? "-" : `${Number(v).toFixed(1).replace(".", ",")} km`);
const eta = (v) => (v == null ? "-" : `${Math.max(1, Math.round(v))} min`);

// ---------------- Lupa percorrendo o mapa (indicador de busca) ----------------
function SearchingCar() {
  return (
    <div className="relative h-16 w-full overflow-hidden rounded-xl border border-off-blue/30 bg-off-bg/50" data-testid="taxi-searching-anim">
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "linear-gradient(90deg,transparent 39px,rgba(0,150,255,.25) 40px),linear-gradient(0deg,transparent 39px,rgba(0,150,255,.25) 40px)", backgroundSize: "40px 40px" }} />
      <motion.div className="absolute top-2 text-3xl" animate={{ x: ["0%", "85%", "30%", "70%"], y: [0, 8, 2, 10] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>🔍</motion.div>
    </div>
  );
}

export default function Taxi() {
  const navigate = useNavigate();
  const [testMode, setTestMode] = useState(true);
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [vehicle, setVehicle] = useState("carro");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [offerVal, setOfferVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [counterVal, setCounterVal] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const arrivedRef = useRef(false);

  const wsOn = useTaxiRealtime([["taxi-active"], ["taxi-nearby"]]);
  const activeQ = useQuery({
    queryKey: ["taxi-active"],
    queryFn: async () => (await api.get("/taxi/rides/active")).data,
    refetchInterval: wsOn ? 15000 : 2500,
  });
  const ride = activeQ.data;

  const nearbyQ = useQuery({
    queryKey: ["taxi-nearby", origin?.lat, origin?.lng, vehicle],
    queryFn: async () => (await api.get(`/taxi/drivers/nearby?lat=${origin.lat}&lng=${origin.lng}&vehicle_type=${vehicle}`)).data,
    enabled: !!origin && !ride,
    refetchInterval: wsOn ? 15000 : 8000,
  });
  const nearby = nearbyQ.data || [];

  const savedQ = useQuery({ queryKey: ["taxi-addresses"], queryFn: async () => (await api.get("/taxi/addresses")).data });
  const savedAddrs = savedQ.data || [];
  const saveAddr = async (pt) => {
    if (!pt) return;
    try { await api.post("/taxi/addresses", { address: pt.address, lat: pt.lat, lng: pt.lng }); toast.success("Endereço salvo"); savedQ.refetch(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const removeAddr = async (id) => {
    try { await api.delete(`/taxi/addresses/${id}`); savedQ.refetch(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  // aviso sonoro + visual quando o motorista chega
  useEffect(() => {
    if (ride?.status === "arrived" && !arrivedRef.current) {
      arrivedRef.current = true;
      voice.announceArrival();
    }
    if (!ride || ride.status !== "arrived") arrivedRef.current = false;
  }, [ride?.status]); // eslint-disable-line

  const useGps = () => {
    if (!navigator.geolocation) { toast.error("GPS indisponível neste dispositivo."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude, address: "Minha localização (GPS)" }); toast.success("Localização obtida"); },
      () => toast.error("Não foi possível obter o GPS. Use o modo de teste."),
      { timeout: 8000 }
    );
  };
  const getQuote = async () => {
    if (!origin || !destination) { toast.error("Informe origem e destino."); return; }
    setQuoting(true);
    try {
      const { data } = await api.post("/taxi/quote", { origin, destination, vehicle_type: vehicle });
      setQuote(data);
      setOfferVal(String(data.suggested_price));
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setQuoting(false); }
  };

  const requestRide = async (offer) => {
    setBusy(true);
    try {
      const body = { origin, destination, vehicle_type: vehicle };
      if (offer != null) body.offer_price = offer;
      await api.post("/taxi/rides", body);
      setQuote(null);
      activeQ.refetch();
      toast.success("Solicitação enviada!");
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  };

  const act = async (path, body, ok) => {
    setBusy(true);
    try { await api.post(`/taxi/rides/${ride.id}/${path}`, body || {}); if (ok) toast.success(ok); activeQ.refetch(); }
    catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  };

  const choose = async (driverId) => {
    vibrate.stop();
    setBusy(true);
    try { await api.post(`/taxi/rides/${ride.id}/choose`, { driver_id: driverId }); toast.success("Motorista escolhido!"); activeQ.refetch(); }
    catch (err) { toast.error(formatApiError(err)); activeQ.refetch(); }
    finally { setBusy(false); }
  };

  // Alerta por vibração quando chega nova oferta (para ao agir/silenciar).
  const offersCount = ride?.driver_offers?.length || 0;
  const prevOffers = useRef(0);
  useEffect(() => {
    if (ride?.status === "searching" && offersCount > prevOffers.current) vibrate.start();
    if (!ride || ride.status !== "searching") vibrate.stop();
    prevOffers.current = offersCount;
    return () => vibrate.stop();
  }, [offersCount, ride?.status]); // eslint-disable-line

  const share = async () => {
    const url = `${window.location.origin}/taxi/track/${ride.share_token}`;
    try {
      if (navigator.share) await navigator.share({ title: "Meu trajeto 360Taxi", url });
      else { await navigator.clipboard.writeText(url); toast.success("Link do trajeto copiado!"); }
    } catch (_) { try { await navigator.clipboard.writeText(url); toast.success("Link copiado!"); } catch (e) {} }
  };

  // =================== SEM CORRIDA ATIVA: solicitação ===================
  if (!ride) {
    return (
      <div className="min-h-screen bg-off-bg px-4 pb-24 pt-6" data-testid="taxi-page">
        <div className="mx-auto max-w-md">
          <button onClick={() => navigate("/home")} className="mb-4 flex items-center gap-1 text-sm text-gray-400"><ArrowLeft className="h-4 w-4" /> Voltar</button>
          <div className="flex items-center gap-2">
            <span className="text-3xl">🚗</span>
            <div>
              <h1 className="font-display text-2xl font-bold text-white">360Taxi</h1>
              <p className="text-sm text-gray-400">Para onde vamos?</p>
            </div>
          </div>

          <div className="mt-5 space-y-3 off-card p-5">
            <button
              data-testid="taxi-test-mode"
              onClick={() => setTestMode((v) => !v)}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold ${testMode ? "border-off-orange/50 bg-off-orange/10 text-off-orange" : "border-off-blue/40 text-gray-400"}`}
            >
              <span>🧪 Modo de teste (localização simulada)</span>
              <span>{testMode ? "ON" : "OFF"}</span>
            </button>

            <div>
              <label className="text-xs text-gray-300">Origem</label>
              <AddressField
                testId="taxi-origin-input"
                icon={<MapPin className="h-4 w-4 text-off-orange" />}
                placeholder="Digite o endereço de origem"
                value={origin}
                onChange={setOrigin}
                saved={savedAddrs}
                onSave={saveAddr}
                onRemoveSaved={removeAddr}
                onGps={useGps}
                testPoints={testMode ? TEST_POINTS : []}
              />
            </div>

            <div>
              <label className="text-xs text-gray-300">Destino</label>
              <AddressField
                testId="taxi-dest-input"
                icon={<Flag className="h-4 w-4 text-gray-300" />}
                placeholder="Digite o endereço de destino"
                value={destination}
                onChange={setDestination}
                saved={savedAddrs}
                onSave={saveAddr}
                onRemoveSaved={removeAddr}
                testPoints={testMode ? TEST_POINTS : []}
              />
            </div>

            <div>
              <label className="text-xs text-gray-300">Tipo de veículo</label>
              <Select value={vehicle} onValueChange={setVehicle}>
                <SelectTrigger data-testid="taxi-vehicle" className="off-input mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="border-off-blue/40 bg-off-surface text-white">
                  <SelectItem value="carro">🚗 Carro</SelectItem>
                  <SelectItem value="moto">🏍️ Moto</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!quote ? (
              <Button data-testid="taxi-get-quote" onClick={getQuote} disabled={quoting} className="h-12 w-full rounded-xl off-gradient font-bold text-white">
                {quoting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Calcular valor"}
              </Button>
            ) : (
              <div className="space-y-3 rounded-xl border border-off-orange/40 bg-off-orange/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Distância</span>
                  <span className="text-sm font-semibold text-white">{km(quote.trip.distance_km)} · {eta(quote.trip.duration_min)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Valor sugerido</span>
                  <span data-testid="taxi-suggested-price" className="font-display text-2xl font-bold text-off-orange">{money(quote.suggested_price)}</span>
                </div>
                <p className="text-[11px] text-gray-500">Comissão OFF360: {money(quote.commission)}. O valor vai integralmente ao motorista.</p>
                <Button data-testid="taxi-accept-suggested" onClick={() => requestRide(null)} disabled={busy} className="h-11 w-full rounded-xl off-gradient font-bold text-white">Aceitar valor e chamar</Button>
                <div className="flex items-center gap-2">
                  <Input data-testid="taxi-offer-input" value={offerVal} onChange={(e) => setOfferVal(e.target.value)} inputMode="decimal" placeholder="Sua oferta (R$)" className="off-input" />
                  <Button data-testid="taxi-make-offer" onClick={() => requestRide(parseFloat(String(offerVal).replace(",", ".")))} disabled={busy} variant="outline" className="rounded-xl border-off-blue/40 text-gray-200">Fazer oferta</Button>
                </div>
              </div>
            )}
          </div>
          {origin && (
            <div className="mt-4 off-card p-3" data-testid="taxi-nearby-map">
              <p className="mb-2 text-xs font-semibold text-gray-300">🚗 Motoristas disponíveis por perto</p>
              <RouteMap origin={origin} drivers={nearby} height={170} />
              <p className="mt-1 text-[11px] text-gray-500">{nearby.length} motorista(s) 360Taxi online por perto</p>
            </div>
          )}
          <TaxiHistory />
        </div>
      </div>
    );
  }

  // =================== COM CORRIDA ATIVA ===================
  const d = ride.driver;
  const st = ride.status;
  return (
    <div className="min-h-screen bg-off-bg px-4 pb-24 pt-6" data-testid="taxi-page">
      <div className="mx-auto max-w-md space-y-4">
        {/* PROCURANDO + MARKETPLACE DE OFERTAS */}
        {st === "searching" && (
          <div className="off-card p-5" data-testid="taxi-searching">
            <SearchingCar />
            <h2 className="mt-3 text-center font-display text-lg font-bold text-white">Procurando motorista...</h2>
            {(ride.driver_offers || []).length === 0 ? (
              <p className="mt-1 text-center text-sm text-gray-400">Valor pedido: <b className="text-off-orange">{money(ride.current_price)}</b></p>
            ) : (
              <div className="mt-3 space-y-2" data-testid="taxi-offers-list">
                <p className="text-xs font-semibold text-gray-300">{ride.driver_offers.length} oferta(s) — toque para escolher:</p>
                {ride.driver_offers.map((o) => (
                  <button key={o.driver_id} data-testid={`taxi-offer-card-${o.driver_id}`} onClick={() => choose(o.driver_id)} disabled={busy}
                    className="flex w-full items-center gap-3 rounded-xl border border-off-blue/40 bg-off-bg/50 p-3 text-left transition-colors hover:border-off-orange">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-off-surface">
                      {o.photo_url ? <img alt="" src={o.photo_url.startsWith("http") ? o.photo_url : `${process.env.REACT_APP_BACKEND_URL}${o.photo_url}`} className="h-full w-full object-cover" /> : <Car className="m-2.5 h-6 w-6 text-gray-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{o.vehicle_type === "moto" ? "🏍️" : "🚗"} {o.name} {o.is_gold ? "🏆" : ""}{o.verified ? " ✅" : ""}</p>
                      <p className="truncate text-[11px] text-gray-400">⭐ {o.rating != null ? String(o.rating).replace(".", ",") : "novo"} · {o.rides_count || 0} corridas · {o.modelo} {o.cor} · {o.plate}</p>
                    </div>
                    <span className="font-display text-lg font-bold text-off-orange">{money(o.amount)}</span>
                  </button>
                ))}
              </div>
            )}
            <Button data-testid="taxi-cancel" onClick={() => act("cancel", {}, "Corrida cancelada")} variant="outline" className="mt-4 w-full rounded-xl border-off-error/50 text-off-error">Cancelar</Button>
          </div>
        )}

        {/* NEGOCIANDO (motorista fez contraproposta) */}
        {st === "negotiating" && (
          <div className="off-card p-6" data-testid="taxi-negotiating">
            <h2 className="font-display text-lg font-bold text-white">Contraproposta do motorista</h2>
            <p className="mt-1 text-sm text-gray-400">O motorista propôs:</p>
            <p className="my-2 font-display text-3xl font-bold text-off-orange">{money(ride.current_price)}</p>
            <Button data-testid="taxi-negotiate-accept" onClick={() => act("accept-price", {}, "Valor aceito!")} disabled={busy} className="h-11 w-full rounded-xl off-gradient font-bold text-white">Aceitar {money(ride.current_price)}</Button>
            <div className="mt-2 flex items-center gap-2">
              <Input data-testid="taxi-counter-input" value={counterVal} onChange={(e) => setCounterVal(e.target.value)} inputMode="decimal" placeholder="Nova oferta (R$)" className="off-input" />
              <Button data-testid="taxi-negotiate-offer" onClick={() => act("offer", { amount: parseFloat(String(counterVal).replace(",", ".")) }, "Oferta enviada")} disabled={busy} variant="outline" className="rounded-xl border-off-blue/40 text-gray-200">Ofertar</Button>
            </div>
            <Button data-testid="taxi-cancel" onClick={() => act("cancel", {}, "Corrida cancelada")} variant="ghost" className="mt-2 w-full text-off-error">Cancelar corrida</Button>
          </div>
        )}

        {/* MOTORISTA ENCONTRADO / A CAMINHO / CHEGOU */}
        {(st === "accepted" || st === "arrived") && (
          <>
            {st === "arrived" && (
              <div className="rounded-2xl border border-off-success/50 bg-off-success/10 p-4 text-center" data-testid="taxi-arrived-banner">
                <p className="font-display text-xl font-bold text-off-success">🚗 Seu motorista chegou!</p>
                <p className="text-sm text-gray-300">Informe o código de embarque ao motorista.</p>
              </div>
            )}
            <div className="off-card p-5" data-testid="taxi-driver-card">
              <p className="font-display text-sm font-bold text-off-orange">{st === "arrived" ? "NO PONTO DE EMBARQUE" : "MOTORISTA ENCONTRADO!"}</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-off-surface">
                  {d?.photo_url ? <img alt="" src={d.photo_url.startsWith("http") ? d.photo_url : `${process.env.REACT_APP_BACKEND_URL}${d.photo_url}`} className="h-full w-full object-cover" /> : <Car className="m-3 h-8 w-8 text-gray-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{d?.name}</p>
                  <p className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="flex items-center gap-0.5 text-off-orange"><Star className="h-3 w-3 fill-current" /> {d?.rating != null ? d.rating.toFixed(1).replace(".", ",") : "novo"}</span>
                    <span>· {d?.rides_count || 0} corridas</span>
                  </p>
                  <p className="text-xs text-gray-400">{d?.vehicle} {d?.plate ? `· ${d.plate}` : ""}</p>
                </div>
              </div>
              {st === "accepted" && (
                <p className="mt-3 text-center text-sm text-gray-300">Seu motorista está chegando <span className="font-display text-lg font-bold text-off-orange">{d?.vehicle_type === "moto" ? "🏍️" : "🚗"} {eta(ride.pickup_eta_min)}</span></p>
              )}
              {/* CÓDIGO DE EMBARQUE */}
              <div className="mt-4 rounded-xl border border-off-blue/40 bg-off-bg/60 p-4 text-center">
                <p className="text-xs text-gray-400">Código de embarque</p>
                <p data-testid="taxi-boarding-code" className="font-display text-4xl font-extrabold tracking-[0.4em] text-white">{ride.boarding_code}</p>
                <p className="mt-1 text-[11px] text-gray-500">Informe ao motorista para iniciar a corrida.</p>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-gray-300">Valor</span>
                <span className="font-semibold text-off-orange">{money(ride.agreed_price)}</span>
              </div>
            </div>
            <ActionRow onMap={() => setShowMap(true)} onShare={share} onEmergency={() => act("emergency", {}, "Emergência acionada. Suporte avisado.")} />
            <RideChat rideId={ride.id} myRole="consumer" />
          </>
        )}

        {/* EM ANDAMENTO */}
        {st === "in_progress" && (
          <>
            <div className="off-card p-5" data-testid="taxi-inprogress">
              <p className="font-display text-lg font-bold text-white">🚗 Corrida em andamento</p>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Destino</span><span className="text-white">{ride.destination?.address || "Destino"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Distância</span><span className="text-white">{km(ride.remaining_distance_km ?? ride.trip_distance_km)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Tempo estimado</span><span className="text-white">{eta(ride.remaining_eta_min ?? ride.trip_duration_min)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Valor</span><span className="font-semibold text-off-orange">{money(ride.agreed_price)}</span></div>
              </div>
              <div className="mt-3"><RouteMap geometry={ride.trip_geometry} origin={ride.origin} destination={ride.destination} carPos={ride.driver_location} carVehicleType={ride.driver_vehicle_type} height={180} /></div>
            </div>
            <ActionRow onMap={() => setShowMap(true)} onShare={share} onEmergency={() => act("emergency", {}, "Emergência acionada. Suporte avisado.")} />
            <RideChat rideId={ride.id} myRole="consumer" />
            <Button data-testid="taxi-interrupt" onClick={() => setCancelOpen(true)} variant="outline" className="w-full rounded-xl border-off-error/50 text-off-error">Interromper corrida</Button>
          </>
        )}
        {st === "completed" && (
          <div className="off-card p-6 text-center" data-testid="taxi-completed">
            <p className="font-display text-3xl font-bold text-white">🏁 Você chegou!</p>
            <p className="mt-1 text-sm text-gray-300">Obrigado por ir de 360Taxi. Até a próxima!</p>
            <p className="mt-3 text-xs text-gray-400">Valor da corrida</p>
            <p data-testid="taxi-final-price" className="font-display text-3xl font-bold text-off-orange">{money(ride.final_price)}</p>
            {ride.rating == null ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-white">Como foi sua corrida?</p>
                <div className="mt-3 grid grid-cols-6 gap-1.5">
                  {[5, 6, 7, 8, 9, 10].map((n) => (
                    <button key={n} data-testid={`taxi-rate-${n}`} onClick={() => act("rate", { score: n }, "Obrigado pela avaliação!")} disabled={busy}
                      className="rounded-lg border border-off-blue/40 py-2 text-sm font-bold text-gray-200 hover:border-off-orange hover:text-off-orange">{n}</button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-gray-500">5 = muito ruim · 10 = excelente</p>
              </div>
            ) : (
              <Button onClick={() => navigate("/home")} className="mt-5 rounded-xl off-gradient font-bold text-white">Concluir</Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={showMap} onOpenChange={setShowMap}>
        <DialogContent className="border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle>🗺️ Ver trajeto</DialogTitle></DialogHeader>
          <RouteMap geometry={ride.trip_geometry} origin={ride.origin} destination={ride.destination} carPos={ride.driver_location} carVehicleType={ride.driver_vehicle_type} height={340} />
        </DialogContent>
      </Dialog>
      <CancelReasonDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Interromper corrida"
        confirmLabel="Interromper" onConfirm={(reason) => { setCancelOpen(false); act("cancel", { reason }, "Corrida interrompida"); }} />
    </div>
  );
}

function TaxiHistory() {
  const { data } = useQuery({ queryKey: ["taxi-history"], queryFn: async () => (await api.get("/taxi/rides/history")).data });
  const rides = data || [];
  if (!rides.length) return null;
  const label = { completed: "Concluída", cancelled: "Cancelada", interrupted: "Interrompida" };
  return (
    <div className="mt-5 off-card p-5" data-testid="taxi-history">
      <h2 className="mb-3 font-display text-sm font-bold text-white">Minhas corridas</h2>
      <div className="space-y-2">
        {rides.map((r) => (
          <div key={r.id} className="rounded-xl border border-off-blue/30 bg-off-bg/40 p-3 text-sm" data-testid={`taxi-history-${r.id}`}>
            <div className="flex items-center justify-between">
              <span className="text-white">📍 {r.origin?.address} → 🏁 {r.destination?.address}</span>
              <span className="font-semibold text-off-orange">{money(r.final_price ?? r.agreed_price ?? r.current_price)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
              <span>{r.driver?.name ? `Motorista: ${r.driver.name}` : "—"}{r.rating ? ` · ⭐ ${r.rating}` : ""}</span>
              <span className={r.status === "interrupted" ? "text-off-error" : r.status === "cancelled" ? "text-gray-500" : "text-off-success"}>{label[r.status] || r.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionRow({ onMap, onShare, onEmergency }) {
  const [muted, setMuted] = useState(voice.isMuted());
  const toggle = () => { const m = !muted; voice.setMuted(m); setMuted(m); };
  return (
    <div className="grid grid-cols-4 gap-2">
      <button data-testid="taxi-view-route" onClick={onMap} className="flex flex-col items-center gap-1 rounded-xl border border-off-blue/40 bg-off-surface py-2.5 text-[11px] text-gray-200"><MapPin className="h-4 w-4 text-off-orange" /> Ver trajeto</button>
      <button data-testid="taxi-share" onClick={onShare} className="flex flex-col items-center gap-1 rounded-xl border border-off-blue/40 bg-off-surface py-2.5 text-[11px] text-gray-200"><Share2 className="h-4 w-4 text-off-orange" /> Compartilhar</button>
      <button data-testid="taxi-mute" onClick={toggle} className="flex flex-col items-center gap-1 rounded-xl border border-off-blue/40 bg-off-surface py-2.5 text-[11px] text-gray-200">{muted ? <VolumeX className="h-4 w-4 text-gray-400" /> : <Volume2 className="h-4 w-4 text-off-orange" />} {muted ? "Mudo" : "Som"}</button>
      <button data-testid="taxi-emergency" onClick={onEmergency} className="flex flex-col items-center gap-1 rounded-xl border border-off-error/50 bg-off-error/10 py-2.5 text-[11px] text-off-error"><ShieldAlert className="h-4 w-4" /> Emergência</button>
    </div>
  );
}
