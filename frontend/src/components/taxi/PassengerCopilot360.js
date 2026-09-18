import React, { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { recordUtterance, isStopCommand } from "@/lib/voiceCapture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Mic, Send, X, Volume2, VolumeX, Settings as Cog, Square, Loader2, MapPin, Star, Car, Search } from "lucide-react";

const SID_KEY = "copilot_pax_sid";
function sessionId() {
  let v = localStorage.getItem(SID_KEY);
  if (!v) { v = (window.crypto?.randomUUID?.() || String(Date.now())); localStorage.setItem(SID_KEY, v); }
  return v;
}

export default function PassengerCopilot360({ origin, ride, onApplyDraft, onConfirmRide }) {
  const [open, setOpen] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [cfg, setCfg] = useState({ ai_name: "Copiloto 360", voice: "female", voice_enabled: true, usage: null });
  const [msgs, setMsgs] = useState([]);
  const [places, setPlaces] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState(null); // listening | thinking | speaking
  const sid = useRef(sessionId());
  const scrollRef = useRef(null);
  const audioRef = useRef(null);
  const voiceModeRef = useRef(false);
  const askRef = useRef(null);
  const notifRef = useRef({ status: null, near: false });

  const loadCtx = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        api.get("/passenger/copilot/settings"),
        api.get("/passenger/copilot/history", { params: { session_id: sid.current } }),
      ]);
      setCfg(s.data);
      setMsgs((h.data || []).map((x) => ({ role: x.role, content: x.content })));
    } catch (e) { /* silencioso */ }
  }, []);
  useEffect(() => { if (open) loadCtx(); }, [open, loadCtx]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, busy, voiceStatus]);

  const speakAwait = useCallback((text) => new Promise((resolve) => {
    if (!cfg.voice_enabled || !text) return resolve();
    api.post("/passenger/copilot/tts", { text }, { responseType: "blob" })
      .then(({ data }) => {
        const url = URL.createObjectURL(data);
        try { if (audioRef.current) audioRef.current.pause(); } catch (e) { /* noop */ }
        const a = new Audio(url); audioRef.current = a;
        a.onended = () => resolve(); a.onerror = () => resolve();
        a.play().catch(() => resolve());
      }).catch(() => resolve());
  }), [cfg.voice_enabled]);

  // Notificações ativas por voz no ciclo da corrida
  useEffect(() => {
    if (!ride) { notifRef.current = { status: null, near: false }; return; }
    const st = ride.status; const prev = notifRef.current.status;
    if (st !== prev) {
      if (st === "accepted") { const nm = ride.driver?.name || "O motorista"; const eta = ride.pickup_eta_min != null ? Math.max(1, Math.round(ride.pickup_eta_min)) : null; speakAwait(`${nm} aceitou sua chamada.${eta ? ` Ele está a aproximadamente ${eta} minutos.` : ""}`); }
      else if (st === "arrived") speakAwait("Seu motorista chegou.");
      else if (st === "in_progress") speakAwait("Boa viagem! Corrida iniciada.");
      notifRef.current.status = st; notifRef.current.near = false;
    }
    if (st === "accepted" && !notifRef.current.near && ride.pickup_eta_min != null && ride.pickup_eta_min <= 2) {
      speakAwait("Seu motorista está a aproximadamente dois minutos de você."); notifRef.current.near = true;
    }
  }, [ride, speakAwait]);

  const askCopilot = async (q, skipUserMsg = false) => {
    if (!skipUserMsg) setMsgs((m) => [...m, { role: "user", content: q }]);
    const ctx = origin ? { lat: origin.lat, lng: origin.lng, address: origin.address } : null;
    const { data } = await api.post("/passenger/copilot/chat", { session_id: sid.current, message: q, context: ctx });
    setMsgs((m) => [...m, { role: "assistant", content: data.reply }]);
    if (data.usage) setCfg((c) => ({ ...c, usage: data.usage }));
    if (data.places) setPlaces(data.places);
    if (data.ride_draft && onApplyDraft) onApplyDraft(data.ride_draft);
    if (data.confirm_ride && onConfirmRide) { onConfirmRide(); voiceModeRef.current = false; setVoiceMode(false); setVoiceStatus(null); setOpen(false); }
    return data.reply;
  };
  askRef.current = askCopilot;

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput(""); setBusy(true);
    try { const reply = await askCopilot(q); speakAwait(reply); }
    catch (e) { toast.error(formatApiError(e, "O Copiloto não respondeu. Tente novamente.")); }
    finally { setBusy(false); }
  };

  const stopVoiceMode = useCallback((msg) => {
    voiceModeRef.current = false; setVoiceMode(false); setVoiceStatus(null);
    try { if (audioRef.current) audioRef.current.pause(); } catch (e) { /* noop */ }
    if (msg) toast(msg);
  }, []);

  const runVoiceLoop = useCallback(async () => {
    while (voiceModeRef.current) {
      setVoiceStatus("listening");
      let cap;
      try { cap = await recordUtterance({ getActive: () => voiceModeRef.current }); }
      catch (e) { toast.error("Permita o microfone para o modo voz."); stopVoiceMode(); break; }
      if (!voiceModeRef.current || cap.reason === "aborted") break;
      if (cap.reason === "inactivity" || !cap.blob || cap.blob.size < 1200) { stopVoiceMode("Modo voz encerrado por silêncio."); break; }
      setVoiceStatus("thinking");
      let text = "";
      try { const fd = new FormData(); fd.append("file", cap.blob, "audio.webm"); const { data } = await api.post("/passenger/copilot/transcribe", fd); text = (data.text || "").trim(); } catch (e) { text = ""; }
      if (!voiceModeRef.current) break;
      if (!text) continue;
      setMsgs((m) => [...m, { role: "user", content: text }]);
      if (isStopCommand(text)) { setVoiceStatus("speaking"); await speakAwait("Encerrando o modo voz. Até logo!"); stopVoiceMode(); break; }
      let reply = "";
      try { reply = await (askRef.current || askCopilot)(text, true); } catch (e) { reply = ""; }
      if (!voiceModeRef.current) break;
      setVoiceStatus("speaking");
      await speakAwait(reply);
    }
    setVoiceStatus(null);
  }, [speakAwait, stopVoiceMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const startVoiceMode = async () => {
    if (voiceModeRef.current) return;
    voiceModeRef.current = true; setVoiceMode(true);
    toast.success("Modo voz ativo — pode falar! Toque no microfone para encerrar.");
    runVoiceLoop();
  };

  const closePanel = () => { stopVoiceMode(); setOpen(false); };

  const saveCfg = async (patch) => { const next = { ...cfg, ...patch }; setCfg(next); try { await api.put("/passenger/copilot/settings", patch); } catch (e) { toast.error(formatApiError(e)); } };

  const quick = [
    { label: "Chamar corrida", q: "Quero chamar uma corrida. Vou falar o destino.", icon: Car },
    { label: "Buscar lugares", q: "Procure bons lugares abertos perto de mim.", icon: Search },
  ];
  const statusText = voiceStatus === "listening" ? "🎙️ Ouvindo..." : voiceStatus === "thinking" ? "💭 Processando..." : voiceStatus === "speaking" ? "🔊 Respondendo..." : "Modo voz ativo";

  return (
    <>
      {!open && (
        <button data-testid="pax-copilot-fab" onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full off-gradient px-4 py-3 text-sm font-bold text-white shadow-lg shadow-off-orange/30 transition-transform active:scale-95">
          <Bot className="h-5 w-5" /> {cfg.ai_name || "Copiloto 360"}
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={closePanel}>
          <div className="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-off-blue/40 bg-off-surface sm:rounded-2xl" onClick={(e) => e.stopPropagation()} data-testid="pax-copilot-panel">
            <div className="flex items-center justify-between border-b border-off-blue/20 p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl off-gradient"><Bot className="h-5 w-5 text-white" /></span>
                <div>
                  <p className="font-display text-sm font-bold text-white">{cfg.ai_name || "Copiloto 360"}</p>
                  <p className="text-[10px] text-gray-400">{cfg.usage ? `IA: ${cfg.usage.day_count}/${cfg.usage.day_limit} hoje` : "Chame corridas e descubra lugares"}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button data-testid="pax-copilot-voice-toggle" onClick={() => saveCfg({ voice_enabled: !cfg.voice_enabled })} className="rounded-lg p-2 text-gray-300 hover:text-white">{cfg.voice_enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>
                <button data-testid="pax-copilot-settings-btn" onClick={() => setShowCfg((v) => !v)} className="rounded-lg p-2 text-gray-300 hover:text-white"><Cog className="h-4 w-4" /></button>
                <button data-testid="pax-copilot-close" onClick={closePanel} className="rounded-lg p-2 text-gray-300 hover:text-white"><X className="h-4 w-4" /></button>
              </div>
            </div>

            {showCfg && (
              <div className="space-y-3 border-b border-off-blue/20 bg-off-bg/40 p-3" data-testid="pax-copilot-settings">
                <div>
                  <p className="text-[11px] font-semibold text-gray-300">Nome do seu Copiloto</p>
                  <div className="mt-1 flex gap-2">
                    <Input data-testid="pax-copilot-name-input" value={cfg.ai_name} onChange={(e) => setCfg({ ...cfg, ai_name: e.target.value })} className="off-input h-9 text-sm" placeholder="Ex: Nina, Léo..." />
                    <Button data-testid="pax-copilot-name-save" onClick={() => saveCfg({ ai_name: cfg.ai_name })} className="h-9 rounded-lg off-gradient text-xs text-white">Salvar</Button>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-300">Voz</p>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {[["female", "Feminina"], ["male", "Masculina"]].map(([k, l]) => (
                      <button key={k} data-testid={`pax-copilot-voice-${k}`} onClick={() => saveCfg({ voice: k })} className={`rounded-lg border py-2 text-xs font-semibold ${cfg.voice === k ? "border-off-orange bg-off-orange/10 text-white" : "border-off-blue/40 text-gray-300"}`}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3" data-testid="pax-copilot-messages">
              {msgs.length === 0 && (
                <div className="rounded-xl border border-off-blue/30 bg-off-bg/40 p-3 text-sm text-gray-300">
                  Olá! Sou seu {cfg.ai_name || "Copiloto 360"}. Toque no microfone para conversar por voz sem parar — eu ouço, respondo e volto a ouvir sozinho. Diga "encerrar" para sair. 🚗
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "off-gradient text-white" : "border border-off-blue/30 bg-off-bg/50 text-gray-100"}`}>{m.content}</div>
                </div>
              ))}
              {places.length > 0 && (
                <div className="space-y-2" data-testid="pax-copilot-places">
                  {places.map((p) => (
                    <a key={p.id} data-testid={`pax-place-${p.id}`} href={p.link} className="block rounded-xl border border-off-blue/30 bg-off-bg/50 p-3 transition hover:border-off-orange">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-white">{p.name}</p>
                        {p.rating != null && <span className="flex items-center gap-0.5 text-xs text-off-orange"><Star className="h-3 w-3" /> {p.rating}</span>}
                      </div>
                      <p className="text-[11px] text-gray-400">{[p.category, p.neighborhood].filter(Boolean).join(" · ")}</p>
                      <div className="mt-1 flex items-center gap-2 text-[11px]">
                        {p.distance_km != null && <span className="flex items-center gap-0.5 text-gray-400"><MapPin className="h-3 w-3" /> {p.distance_km} km</span>}
                        {p.discount_percent ? <span className="rounded bg-off-orange/20 px-1.5 py-0.5 font-bold text-off-orange">{p.discount_percent}% OFF</span> : null}
                        <span className="ml-auto font-semibold text-off-orange">Abrir →</span>
                      </div>
                    </a>
                  ))}
                </div>
              )}
              {(busy || voiceStatus === "thinking") && <div className="flex justify-start"><div className="rounded-2xl border border-off-blue/30 bg-off-bg/50 px-3 py-2 text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /></div></div>}
            </div>

            <div className="flex flex-wrap gap-1.5 border-t border-off-blue/20 px-3 pt-2">
              {quick.map((qa) => (
                <button key={qa.label} data-testid={`pax-copilot-quick-${qa.label}`} onClick={() => send(qa.q)} disabled={busy || voiceMode}
                  className="flex items-center gap-1 rounded-full border border-off-blue/40 px-2.5 py-1 text-[11px] text-gray-300 hover:border-off-orange hover:text-white disabled:opacity-40">
                  <qa.icon className="h-3 w-3" /> {qa.label}
                </button>
              ))}
            </div>

            <div className="p-3">
              {voiceMode && (
                <div className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-off-blue/10 px-3 py-1.5 text-xs font-semibold text-off-orange" data-testid="pax-voice-status">
                  <span className={`h-2 w-2 rounded-full bg-off-orange ${voiceStatus === "listening" ? "animate-pulse" : ""}`} /> {statusText} · toque no microfone para encerrar
                </div>
              )}
              <div className="flex items-center gap-2">
                <button data-testid="pax-copilot-mic" onClick={voiceMode ? () => stopVoiceMode() : startVoiceMode}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${voiceMode ? "bg-off-error text-white animate-pulse" : "bg-off-blue text-white"}`}>
                  {voiceMode ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <Input data-testid="pax-copilot-input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={voiceMode ? "Modo voz — fale à vontade" : "Fale o destino ou pergunte..."} className="off-input h-11 flex-1" disabled={voiceMode} />
                <Button data-testid="pax-copilot-send" onClick={() => send()} disabled={busy || voiceMode || !input.trim()} className="h-11 w-11 shrink-0 rounded-xl off-gradient p-0 text-white"><Send className="h-5 w-5" /></Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
