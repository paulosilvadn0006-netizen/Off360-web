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
import GoogleTrackMap from "@/components/taxi/GoogleTrackMap";
import AddressField from "@/components/taxi/AddressField";
import LostFound from "@/components/taxi/LostFound";
import CancelReasonDialog from "@/components/taxi/CancelReasonDialog";
import RideChat from "@/components/taxi/RideChat";
import TaxiPayment from "@/components/taxi/TaxiPayment";
import PassengerCopilot360 from "@/components/taxi/PassengerCopilot360";
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

// ---------------- Mapa ao fundo + lupa varrendo horizontalmente (busca) ----------------
function SearchingMap({ origin }) {
  return (
    <div className="relative h-44 w-full overflow-hidden rounded-xl border border-off-blue/30" data-testid="taxi-searching-anim">
      <div className="pointer-events-none absolute inset-0">
        <RouteMap origin={origin} drivers={[]} height={176} />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-black/10" />
      <motion.div
        className="pointer-events-none absolute top-1/2 z-[1000] -translate-y-1/2 text-4xl"
        style={{ filter: "drop-shadow(0 3px 6px rgba(0,0,0,.6))" }}
        animate={{ left: ["3%", "86%", "3%"] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      >
        🔍
      </motion.div>
    </div>
  );
}

export default function Taxi() {
  const navigate = useNavigate();
  const [testMode, setTestMode] = useState(true);
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [vehicle, setVehicle] = useState("carro");
  const [category, setCategory] = useState("basic");
  const [payMethod, setPayMethod] = useState("pix");
  const [payCardId, setPayCardId] = useState(null);
  const [savedCards, setSavedCards] = useState([]);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [offerVal, setOfferVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [counterVal, setCounterVal] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [searchCancelOpen, setSearchCancelOpen] = useState(false);
  const [paidInfo, setPaidInfo] = useState(null);
  const arrivedRef = useRef(false);

  const wsOn = useTaxiRealtime([["taxi-active"], ["taxi-nearby"]]);
  const activeQ = useQuery({
    queryKey: ["taxi-active"],
    queryFn: async () => (await api.get("/taxi/rides/active")).data,
    refetchInterval: wsOn ? 15000 : 2500,
  });
  const ride = activeQ.data;

  useEffect(() => { if (!ride || ride.status !== "completed") setPaidInfo(null); }, [ride?.id, ride?.status]);

  useEffect(() => {
    let on = true;
    api.get("/taxi/passenger/cards").then(({ data }) => { if (on) { setSavedCards(data.cards || []); if ((data.cards || [])[0]) setPayCardId(data.cards[0].id); } }).catch(() => {});
    return () => { on = false; };
  }, []);

  const nearbyQ = useQuery({
    queryKey: ["taxi-nearby", origin?.lat, origin?.lng, category],
    queryFn: async () => (await api.get(`/taxi/drivers/nearby?lat=${origin.lat}&lng=${origin.lng}&category=${category}`)).data,
    enabled: !!origin && !ride,
    refetchInterval: wsOn ? 15000 : 8000,
  });
  const nearby = nearbyQ.data || [];

  const savedQ = useQuery({ queryKey: ["taxi-addresses"], queryFn: async () => (await api.get("/taxi/addresses")).data });
  const [geoBias, setGeoBias] = useState(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGeoBias({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }, []);
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
  const saveLabeled = async (pt, label) => {
    if (!pt) { toast.error("Selecione o endereço primeiro."); return; }
    try { await api.post("/taxi/addresses", { address: pt.address, lat: pt.lat, lng: pt.lng, label }); toast.success(`Salvo como ${label}`); savedQ.refetch(); }
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
      async (p) => {
        const lat = p.coords.latitude, lng = p.coords.longitude;
        setOrigin({ lat, lng, address: "Minha localização (GPS)" });
        toast.success("Localização obtida");
        try { const { data } = await api.get("/taxi/reverse", { params: { lat, lng } }); if (data?.address) setOrigin({ lat, lng, address: data.address }); } catch (_) {}
      },
      () => toast.error("Não foi possível obter o GPS. Use o modo de teste."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };
  const getQuote = async () => {
    if (!origin || !destination) { toast.error("Informe origem e destino."); return; }
    setQuoting(true);
    try {
      const { data } = await api.post("/taxi/quote", { origin, destination, category });
      setQuote(data);
      const chosen = (data.categories || []).find((c) => c.id === category) || (data.categories || [])[0];
      if (chosen) setOfferVal(String(chosen.price));
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setQuoting(false); }
  };

  const requestRide = async (offer) => {
    setBusy(true);
    try {
      const body = { origin, destination, category, payment_method: payMethod };
      if (payMethod === "card") body.card_id = payCardId || undefined;
      if (offer != null) body.offer_price = offer;
      await api.post("/taxi/rides", body);
      setQuote(null);
      activeQ.refetch();
      toast.success("Solicitação enviada!");
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  };

  // Copiloto 360: preenche a tela com o destino/categoria e mostra a cotação.
  // O passageiro dá o TOQUE FINAL no botão "Chamar" para confirmar (nunca cria sozinho).
  const applyDraft = async (draft, ori) => {
    if (!draft?.destination) return;
    const useOri = ori || origin;
    if (!useOri) { toast.error("Ative sua localização (GPS) primeiro."); return; }
    if (ori && !origin) setOrigin(ori);
    const cat = draft.category || "basic";
    setDestination(draft.destination);
    setCategory(cat);
    try {
      const { data } = await api.post("/taxi/quote", { origin: useOri, destination: draft.destination, category: cat });
      setQuote(data);
      const chosen = (data.categories || []).find((c) => c.id === cat) || (data.categories || [])[0];
      if (chosen) setOfferVal(String(chosen.price));
      toast.success("Corrida preenchida! Confira e toque em Chamar para confirmar.");
    } catch (err) { toast.error(formatApiError(err)); }
  };

  // Handoff do Copiloto vindo da tela inicial OFF360: aplica a corrida preparada por voz.
  useEffect(() => {
    const raw = sessionStorage.getItem("copilot_ride_draft");
    if (!raw) return;
    sessionStorage.removeItem("copilot_ride_draft");
    try { const d = JSON.parse(raw); applyDraft(d, d.origin); } catch (e) { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confirmação por voz: o passageiro diz "confirmar" e o Copiloto aciona o toque final
  // (só dispara se a corrida já foi preparada/cotada na tela — 1 etapa de segurança mantida).
  const confirmVoiceRide = () => {
    if (!quote) { toast.error("Prepare a corrida antes de confirmar."); return; }
    requestRide(null);
    toast.success("Confirmado por voz! Chamando seu motorista...");
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

  // Alerta ao passageiro quando um motorista ACEITA: vibra 3 ciclos (2s on / 1s off).
  const prevStatus = useRef(null);
  useEffect(() => {
    vibrate.primeVibration();
    const st = ride?.status;
    if (st === "accepted" && prevStatus.current !== "accepted") {
      vibrate.startPassenger();
    }
    if (st !== "accepted") vibrate.stop();
    prevStatus.current = st;
    return () => vibrate.stop();
  }, [ride?.status]); // eslint-disable-line

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
        <PassengerCopilot360 origin={origin} ride={null} onApplyDraft={applyDraft} onConfirmRide={confirmVoiceRide} />
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

            {savedAddrs.length > 0 && (
              <div data-testid="taxi-fav-shortcuts">
                <p className="mb-1 text-[11px] text-gray-500">Atalhos (toque para ir até lá):</p>
                <div className="flex flex-wrap gap-2">
                  {savedAddrs.map((s) => {
                    const ic = /casa/i.test(s.label || "") ? "🏠" : /trabalho|work/i.test(s.label || "") ? "💼" : "📍";
                    return (
                      <button key={s.id} data-testid={`taxi-fav-chip-${s.id}`} onClick={() => setDestination({ lat: s.lat, lng: s.lng, address: s.address })}
                        className="flex items-center gap-1 rounded-full border border-off-blue/40 bg-off-surface px-3 py-1.5 text-xs font-semibold text-gray-200 hover:border-off-orange">
                        {ic} {s.label || (s.address || "").split(",")[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
                bias={geoBias}
                pointLabel="local de origem"
                testPoints={[]}
              />
              {origin && (
                <div className="mt-1 flex gap-3">
                  <button data-testid="save-origin-casa" onClick={() => saveLabeled(origin, "Casa")} className="text-[11px] text-gray-400 hover:text-off-orange">🏠 Salvar como Casa</button>
                  <button data-testid="save-origin-trabalho" onClick={() => saveLabeled(origin, "Trabalho")} className="text-[11px] text-gray-400 hover:text-off-orange">💼 Trabalho</button>
                </div>
              )}
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
                bias={origin || geoBias}
                pointLabel="destino"
                testPoints={[]}
              />
              {destination && (
                <div className="mt-1 flex gap-3">
                  <button data-testid="save-dest-casa" onClick={() => saveLabeled(destination, "Casa")} className="text-[11px] text-gray-400 hover:text-off-orange">🏠 Salvar como Casa</button>
                  <button data-testid="save-dest-trabalho" onClick={() => saveLabeled(destination, "Trabalho")} className="text-[11px] text-gray-400 hover:text-off-orange">💼 Trabalho</button>
                </div>
              )}
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
                <p className="text-xs font-semibold text-gray-300">Escolha a categoria</p>
                <div className="grid grid-cols-3 gap-2" data-testid="taxi-categories">
                  {(quote.categories || []).map((c) => (
                    <button key={c.id} data-testid={`taxi-cat-${c.id}`} onClick={() => { setCategory(c.id); setOfferVal(String(c.price)); }}
                      className={`flex flex-col items-center gap-1 rounded-xl border p-3 transition ${category === c.id ? "border-off-orange bg-off-orange/15" : "border-off-blue/40 hover:border-off-blue"}`}>
                      <Car className="h-6 w-6 text-black" fill="#111827" />
                      <span className="text-sm font-bold text-white">{c.label}</span>
                      <span className="font-display text-base font-bold text-off-orange">{money(c.price)}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-500">Comissão OFF360: {money(quote.commission)}. O valor vai integralmente ao motorista.</p>
                <div className="rounded-xl border border-off-blue/40 p-3" data-testid="taxi-pay-method">
                  <p className="mb-2 text-xs font-semibold text-gray-300">Forma de pagamento</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[["pix", "Pix", "💠"], ["card", "Cartão", "💳"], ["cash", "Dinheiro", "💵"]].map(([id, label, ic]) => (
                      <button key={id} data-testid={`pay-method-${id}`} onClick={() => setPayMethod(id)}
                        className={`rounded-xl border p-2 text-xs font-bold transition ${payMethod === id ? "border-off-orange bg-off-orange/15 text-white" : "border-off-blue/40 text-gray-300"}`}>
                        <span className="block text-base">{ic}</span>{label}
                      </button>
                    ))}
                  </div>
                  {payMethod === "card" && (
                    savedCards.length ? (
                      <select data-testid="pay-card-select" value={payCardId || ""} onChange={(e) => setPayCardId(e.target.value)} className="off-input mt-2 w-full">
                        {savedCards.map((c) => <option key={c.id} value={c.id}>{(c.brand || "cartão").toUpperCase()} •••• {c.last_four}</option>)}
                      </select>
                    ) : (
                      <p className="mt-2 text-[11px] text-off-error">Nenhum cartão salvo. Cadastre no seu Perfil para pagar com cartão.</p>
                    )
                  )}
                </div>
                <Button data-testid="taxi-accept-suggested" onClick={() => requestRide(null)} disabled={busy || (payMethod === "card" && !savedCards.length)} className="h-11 w-full rounded-xl off-gradient font-bold text-white">Chamar {(quote.categories || []).find((c) => c.id === category)?.label} · {money((quote.categories || []).find((c) => c.id === category)?.price || 0)}</Button>
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
          <LostFound endpoint="/taxi/lost-and-found/consumer" label="o motorista" />
        </div>
      </div>
    );
  }

  // =================== COM CORRIDA ATIVA ===================
  const d = ride.driver;
  const st = ride.status;

  const buildReceipt = () => {
    const when = ride.completed_at ? new Date(ride.completed_at).toLocaleString("pt-BR") : new Date().toLocaleString("pt-BR");
    return [
      "RECIBO — 360Taxi (OFF360)",
      `Data: ${when}`,
      `De: ${ride.origin?.address || "-"}`,
      `Para: ${ride.destination?.address || "-"}`,
      d?.name ? `Motorista: ${d.name}` : "",
      ride.trip_distance_km != null ? `Distância: ${km(ride.trip_distance_km)}` : "",
      `Valor: ${money(ride.final_price ?? ride.agreed_price)}`,
      ride.boarding_code ? `Código: ${ride.boarding_code}` : "",
      "Obrigado por ir de 360Taxi!",
    ].filter(Boolean).join("\n");
  };

  const wrapText = (ctx, text, maxW) => {
    const words = String(text).split(" ");
    const lines = []; let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  const drawReceiptCanvas = () => {
    const W = 720, pad = 48, contentW = W - pad * 2, headerH = 150;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const rows = [
      ["Data", ride.completed_at ? new Date(ride.completed_at).toLocaleString("pt-BR") : new Date().toLocaleString("pt-BR")],
      ["Origem", ride.origin?.address || "-"],
      ["Destino", ride.destination?.address || "-"],
    ];
    if (d?.name) rows.push(["Motorista", d.name]);
    if (ride.trip_distance_km != null) rows.push(["Distância", km(ride.trip_distance_km)]);
    if (ride.boarding_code) rows.push(["Código", String(ride.boarding_code)]);
    ctx.font = "500 22px Arial, sans-serif";
    let bodyH = 0;
    const rowLines = rows.map(([, v]) => { const ls = wrapText(ctx, v, contentW); bodyH += 28 + ls.length * 30 + 14; return ls; });
    const H = headerH + 40 + bodyH + 110 + 120;
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = "#0e1116"; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, headerH); g.addColorStop(0, "#FF6A00"); g.addColorStop(1, "#FF9330");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = "#ffffff"; ctx.font = "800 46px Arial, sans-serif"; ctx.fillText("OFF360", pad, 70);
    ctx.font = "700 26px Arial, sans-serif"; ctx.fillText("Recibo · 360Taxi", pad, 112);
    let y = headerH + 50;
    rows.forEach(([k], i) => {
      ctx.fillStyle = "#8a94a6"; ctx.font = "700 15px Arial, sans-serif"; ctx.fillText(String(k).toUpperCase(), pad, y);
      y += 28; ctx.fillStyle = "#ffffff"; ctx.font = "500 22px Arial, sans-serif";
      rowLines[i].forEach((ln) => { ctx.fillText(ln, pad, y); y += 30; });
      y += 14;
    });
    ctx.fillStyle = "#161b22"; ctx.fillRect(pad, y, contentW, 92);
    ctx.fillStyle = "#8a94a6"; ctx.font = "700 15px Arial, sans-serif"; ctx.fillText("VALOR DA CORRIDA", pad + 20, y + 34);
    ctx.fillStyle = "#FF6A00"; ctx.font = "800 40px Arial, sans-serif"; ctx.fillText(money(ride.final_price ?? ride.agreed_price), pad + 20, y + 76);
    y += 92 + 50;
    ctx.fillStyle = "#8a94a6"; ctx.font = "500 16px Arial, sans-serif"; ctx.fillText("Obrigado por ir de 360Taxi · OFF360", pad, y);
    return canvas;
  };

  const shareReceipt = async () => {
    try {
      const canvas = drawReceiptCanvas();
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      const file = new File([blob], "recibo-360taxi.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ title: "Recibo 360Taxi", files: [file] }); return; }
      if (navigator.share) { await navigator.share({ title: "Recibo 360Taxi", text: buildReceipt() }); return; }
      await navigator.clipboard.writeText(buildReceipt()); toast.success("Recibo copiado!");
    } catch (_) {}
  };
  const downloadReceipt = () => {
    try {
      const url = drawReceiptCanvas().toDataURL("image/png");
      const a = document.createElement("a"); a.href = url; a.download = "recibo-360taxi.png"; a.click();
      toast.success("Recibo (imagem) baixado");
    } catch (_) {
      const blob = new Blob([buildReceipt()], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "recibo-360taxi.txt"; a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="min-h-screen bg-off-bg px-4 pb-24 pt-6" data-testid="taxi-page">
      <PassengerCopilot360 origin={origin} ride={ride} onApplyDraft={applyDraft} onConfirmRide={confirmVoiceRide} />
      <div className="mx-auto max-w-md space-y-4">
        {/* PROCURANDO + MARKETPLACE DE OFERTAS */}
        {st === "searching" && (
          <div className="off-card p-5" data-testid="taxi-searching">
            <SearchingMap origin={ride.origin} />
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
                      <p className="truncate text-sm font-semibold text-white">🚗 {o.name} {o.is_gold ? "🏆" : ""}{o.verified ? " ✅" : ""}</p>
                      <p className="truncate text-[11px] text-gray-400">⭐ {o.rating != null ? String(o.rating).replace(".", ",") : "novo"} · {o.rides_count || 0} corridas · {o.modelo} {o.cor} · {o.plate}</p>
                    </div>
                    <span className="font-display text-lg font-bold text-off-orange">{money(o.amount)}</span>
                  </button>
                ))}
              </div>
            )}
            <Button data-testid="taxi-cancel" onClick={() => setSearchCancelOpen(true)} variant="outline" className="mt-4 w-full rounded-xl border-off-error/50 text-off-error">Cancelar</Button>
            <CancelReasonDialog open={searchCancelOpen} onOpenChange={setSearchCancelOpen}
              title="Cancelar corrida" confirmLabel="Cancelar corrida"
              reasons={["Demorou demais", "Mudei de ideia", "Valor alto", "Outro"]}
              onConfirm={(reason) => { setSearchCancelOpen(false); act("cancel", { reason }, "Corrida cancelada"); }} />
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
                  <p className="text-xs text-gray-400">{d?.vehicle}{d?.cor ? ` · ${d.cor}` : ""}{d?.plate ? ` · ${d.plate}` : ""}</p>
                </div>
              </div>
              {st === "accepted" && (
                <p className="mt-3 text-center text-sm text-gray-300">Seu motorista está chegando <span className="font-display text-lg font-bold text-off-orange">🚗 {eta(ride.pickup_eta_min)}</span></p>
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
            {st === "accepted" && ride.driver_location && (
              <div className="off-card p-2" data-testid="taxi-pickup-map">
                <GoogleTrackMap
                  origin={ride.origin}
                  carPos={ride.driver_location}
                  carVehicleType={ride.driver_vehicle_type || ride.vehicle_type}
                  etaMin={ride.pickup_eta_min}
                  etaText="até você"
                  height="48vh"
                />
              </div>
            )}
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
              <div className="mt-3"><GoogleTrackMap geometry={ride.trip_geometry} origin={ride.origin} destination={ride.destination} carPos={ride.driver_location} carVehicleType={ride.driver_vehicle_type || ride.vehicle_type} etaMin={ride.remaining_eta_min ?? ride.trip_duration_min} etaText="até o destino" height="56vh" /></div>
            </div>
            <ActionRow onMap={() => setShowMap(true)} onShare={share} onEmergency={() => act("emergency", {}, "Emergência acionada. Suporte avisado.")} />
            <RideChat rideId={ride.id} myRole="consumer" />
            <Button data-testid="taxi-interrupt" onClick={() => setCancelOpen(true)} variant="outline" className="w-full rounded-xl border-off-error/50 text-off-error">Interromper corrida</Button>
          </>
        )}
        {st === "completed" && !paidInfo && (ride.payment?.status !== "approved") && (
          <TaxiPayment ride={ride} onPaid={(info) => setPaidInfo(info)} />
        )}
        {st === "completed" && (paidInfo || ride.payment?.status === "approved") && (
          <div className="off-card p-6 text-center" data-testid="taxi-completed">
            <p className="font-display text-2xl font-bold text-white" data-testid="taxi-thankyou">Muito obrigado por andar, {paidInfo?.driver_name || ride.driver_name || "com a 360taxi"}! Volte sempre. 360taxi.</p>
            <p className="mt-3 text-xs text-gray-400">Valor pago</p>
            <p data-testid="taxi-final-price" className="font-display text-3xl font-bold text-off-orange">{money(ride.final_price)}</p>
            <div className="mt-3 flex gap-2">
              <Button data-testid="taxi-receipt-share" onClick={shareReceipt} variant="outline" className="flex-1 rounded-xl border-off-blue/40 text-gray-200">🧾 Compartilhar recibo</Button>
              <Button data-testid="taxi-receipt-download" onClick={downloadReceipt} variant="outline" className="flex-1 rounded-xl border-off-blue/40 text-gray-200">⬇️ Baixar imagem</Button>
            </div>
            {ride.rating == null ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-white">Como foi sua corrida?</p>
                <div className="mt-3 grid grid-cols-6 gap-1.5">
                  {[5, 6, 7, 8, 9, 10].map((n) => (
                    <button key={n} data-testid={`taxi-rate-${n}`} onClick={() => act("rate", { score: n }, "Obrigado pela avaliação!")} disabled={busy}
                      className="rounded-lg border border-off-blue/40 py-2 text-sm font-bold text-gray-200 hover:border-off-orange hover:text-off-orange">{n}</button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-gray-500">5 = péssimo · 6-7 regular · 8-9 bom · 10 ótimo</p>
                <button data-testid="taxi-rate-skip" onClick={async () => { try { await api.post(`/taxi/rides/${ride.id}/dismiss`); } catch (e) {} activeQ.refetch(); navigate("/home"); }} className="mt-3 text-[11px] text-gray-500">Pular avaliação</button>
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
          <GoogleTrackMap geometry={ride.trip_geometry} origin={ride.origin} destination={ride.destination} carPos={ride.driver_location} carVehicleType={ride.driver_vehicle_type || ride.vehicle_type} etaMin={st === "in_progress" ? (ride.remaining_eta_min ?? ride.trip_duration_min) : ride.pickup_eta_min} etaText={st === "in_progress" ? "até o destino" : "até você"} height={460} />
        </DialogContent>
      </Dialog>
      <CancelReasonDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Interromper corrida"
        confirmLabel="Interromper" onConfirm={(reason) => { setCancelOpen(false); act("cancel", { reason }, "Corrida interrompida"); }} />
    </div>
  );
}

function TaxiHistory() {
  const { data: stats } = useQuery({ queryKey: ["taxi-me-stats"], queryFn: async () => (await api.get("/taxi/me/stats")).data });
  if (!stats) return null;
  return (
    <div className="mt-5 off-card p-4" data-testid="taxi-history">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-bold text-white">Minhas viagens</span>
        <span data-testid="taxi-rider-stats" className="text-[11px] text-gray-400">🚗 {stats.rides_count} viagem(ns){stats.rating != null ? ` · ⭐ ${String(stats.rating).replace(".", ",")} (${stats.rating_count})` : ""}</span>
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
