import React, { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Mic, Send, X, Volume2, VolumeX, Loader2, Settings as Cog, Square, Target, TrendingUp, MessageSquarePlus } from "lucide-react";

const SID_KEY = "copilot_sid";
function sessionId() {
  let v = localStorage.getItem(SID_KEY);
  if (!v) { v = (window.crypto?.randomUUID?.() || String(Date.now())); localStorage.setItem(SID_KEY, v); }
  return v;
}

export default function Copilot360() {
  const [open, setOpen] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [cfg, setCfg] = useState({ ai_name: "Copiloto 360", voice: "male", voice_enabled: true, usage: null });
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [goal, setGoal] = useState(null);
  const sid = useRef(sessionId());
  const scrollRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);

  const loadContext = useCallback(async () => {
    try {
      const [s, m, g, h] = await Promise.all([
        api.get("/driver/copilot/settings"),
        api.get("/driver/copilot/metrics"),
        api.get("/driver/copilot/goal"),
        api.get("/driver/copilot/history", { params: { session_id: sid.current } }),
      ]);
      setCfg(s.data); setMetrics(m.data); setGoal(g.data);
      setMsgs((h.data || []).map((x) => ({ role: x.role, content: x.content })));
    } catch (e) { /* silencioso */ }
  }, []);

  useEffect(() => { if (open) loadContext(); }, [open, loadContext]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, busy]);

  const speak = useCallback(async (text) => {
    if (!cfg.voice_enabled || !text) return;
    try {
      const { data } = await api.post("/driver/copilot/tts", { text }, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      if (audioRef.current) { audioRef.current.pause(); }
      audioRef.current = new Audio(url);
      audioRef.current.play().catch(() => {});
    } catch (e) { /* voz é opcional */ }
  }, [cfg.voice_enabled]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const { data } = await api.post("/driver/copilot/chat", { session_id: sid.current, message: q });
      setMsgs((m) => [...m, { role: "assistant", content: data.reply }]);
      if (data.usage) setCfg((c) => ({ ...c, usage: data.usage }));
      loadContext();
      speak(data.reply);
    } catch (e) { toast.error(formatApiError(e, "O Copiloto não respondeu. Tente novamente.")); }
    finally { setBusy(false); }
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (!blob.size) return;
        setBusy(true);
        try {
          const fd = new FormData(); fd.append("file", blob, "audio.webm");
          const { data } = await api.post("/driver/copilot/transcribe", fd);
          const text = (data.text || "").trim();
          if (text) send(text); else toast.error("Não entendi o áudio. Tente de novo.");
        } catch (e) { toast.error(formatApiError(e, "Falha ao transcrever o áudio")); }
        finally { setBusy(false); }
      };
      recRef.current = mr; mr.start(); setRecording(true);
    } catch (e) { toast.error("Permita o acesso ao microfone para usar a voz."); }
  };
  const stopRec = () => { try { recRef.current?.stop(); } catch (e) {} setRecording(false); };

  const saveCfg = async (patch) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    try { await api.put("/driver/copilot/settings", patch); } catch (e) { toast.error(formatApiError(e)); }
  };

  const quick = [
    { label: "Resumo do dia", q: "Me dá o resumo do meu dia até agora.", icon: TrendingUp },
    { label: "Definir meta", q: "Quero definir uma meta de faturamento para hoje.", icon: Target },
    { label: "Melhores horários", q: "Quais os melhores horários e regiões de movimento?", icon: TrendingUp },
    { label: "Enviar sugestão", q: "Quero enviar uma sugestão para a plataforma.", icon: MessageSquarePlus },
  ];

  return (
    <>
      {!open && (
        <button data-testid="copilot-fab" onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full off-gradient px-4 py-3 text-sm font-bold text-white shadow-lg shadow-off-orange/30 transition-transform active:scale-95">
          <Bot className="h-5 w-5" /> {cfg.ai_name || "Copiloto 360"}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => setOpen(false)}>
          <div className="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-off-blue/40 bg-off-surface sm:rounded-2xl" onClick={(e) => e.stopPropagation()} data-testid="copilot-panel">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-off-blue/20 p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl off-gradient"><Bot className="h-5 w-5 text-white" /></span>
                <div>
                  <p className="font-display text-sm font-bold text-white">{cfg.ai_name || "Copiloto 360"}</p>
                  <p className="text-[10px] text-gray-400">{cfg.usage ? `IA: ${cfg.usage.day_count}/${cfg.usage.day_limit} hoje` : "Seu assistente de bordo"}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button data-testid="copilot-voice-toggle" title="Voz" onClick={() => saveCfg({ voice_enabled: !cfg.voice_enabled })} className="rounded-lg p-2 text-gray-300 hover:text-white">{cfg.voice_enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>
                <button data-testid="copilot-settings-btn" title="Ajustes" onClick={() => setShowCfg((v) => !v)} className="rounded-lg p-2 text-gray-300 hover:text-white"><Cog className="h-4 w-4" /></button>
                <button data-testid="copilot-close" onClick={() => setOpen(false)} className="rounded-lg p-2 text-gray-300 hover:text-white"><X className="h-4 w-4" /></button>
              </div>
            </div>

            {/* Settings */}
            {showCfg && (
              <div className="space-y-3 border-b border-off-blue/20 bg-off-bg/40 p-3" data-testid="copilot-settings">
                <div>
                  <p className="text-[11px] font-semibold text-gray-300">Nome do seu Copiloto</p>
                  <div className="mt-1 flex gap-2">
                    <Input data-testid="copilot-name-input" value={cfg.ai_name} onChange={(e) => setCfg({ ...cfg, ai_name: e.target.value })} className="off-input h-9 text-sm" placeholder="Ex: Léo, Nina..." />
                    <Button data-testid="copilot-name-save" onClick={() => saveCfg({ ai_name: cfg.ai_name })} className="h-9 rounded-lg off-gradient text-xs text-white">Salvar</Button>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-300">Voz</p>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {[["male", "Masculina"], ["female", "Feminina"]].map(([k, l]) => (
                      <button key={k} data-testid={`copilot-voice-${k}`} onClick={() => saveCfg({ voice: k })} className={`rounded-lg border py-2 text-xs font-semibold ${cfg.voice === k ? "border-off-orange bg-off-orange/10 text-white" : "border-off-blue/40 text-gray-300"}`}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Métricas rápidas */}
            <div className="grid grid-cols-3 gap-2 border-b border-off-blue/20 p-3 text-center" data-testid="copilot-metrics">
              <div><p className="text-[10px] text-gray-400">Corridas hoje</p><p className="font-display text-lg font-bold text-white">{metrics?.rides ?? "—"}</p></div>
              <div><p className="text-[10px] text-gray-400">Faturamento</p><p className="font-display text-lg font-bold text-off-orange">{metrics ? money(metrics.revenue) : "—"}</p></div>
              <div><p className="text-[10px] text-gray-400">Meta</p><p className="font-display text-lg font-bold text-white">{goal?.goal ? `${goal.pct}%` : "—"}</p></div>
            </div>

            {/* Chat */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3" data-testid="copilot-messages">
              {msgs.length === 0 && (
                <div className="rounded-xl border border-off-blue/30 bg-off-bg/40 p-3 text-sm text-gray-300">
                  Olá! Sou seu {cfg.ai_name || "Copiloto 360"}. Posso resumir seu dia, acompanhar sua meta, indicar os melhores horários e registrar suas sugestões. Fale ou escreva. 🚗
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "off-gradient text-white" : "border border-off-blue/30 bg-off-bg/50 text-gray-100"}`}>{m.content}</div>
                </div>
              ))}
              {busy && <div className="flex justify-start"><div className="rounded-2xl border border-off-blue/30 bg-off-bg/50 px-3 py-2 text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /></div></div>}
            </div>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-1.5 border-t border-off-blue/20 px-3 pt-2">
              {quick.map((qa) => (
                <button key={qa.label} data-testid={`copilot-quick-${qa.label}`} onClick={() => send(qa.q)} disabled={busy}
                  className="flex items-center gap-1 rounded-full border border-off-blue/40 px-2.5 py-1 text-[11px] text-gray-300 hover:border-off-orange hover:text-white">
                  <qa.icon className="h-3 w-3" /> {qa.label}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 p-3">
              <button data-testid="copilot-mic" onClick={recording ? stopRec : startRec} disabled={busy && !recording}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${recording ? "bg-off-error text-white animate-pulse" : "bg-off-blue text-white"}`}>
                {recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              <Input data-testid="copilot-input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={recording ? "Gravando... toque para parar" : "Pergunte ou fale..."} className="off-input h-11 flex-1" disabled={recording} />
              <Button data-testid="copilot-send" onClick={() => send()} disabled={busy || !input.trim()} className="h-11 w-11 shrink-0 rounded-xl off-gradient p-0 text-white"><Send className="h-5 w-5" /></Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
