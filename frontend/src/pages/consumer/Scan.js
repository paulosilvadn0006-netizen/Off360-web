import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Flashlight, CameraOff, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

// Maps a getUserMedia error to a user-friendly Portuguese message.
function cameraErrorMessage(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return { title: "Permissão da câmera negada", detail: "Toque no cadeado da barra de endereço, permita o acesso à câmera e tente novamente." };
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return { title: "Câmera não encontrada", detail: "Nenhuma câmera disponível neste dispositivo." };
  if (name === "NotReadableError" || name === "TrackStartError")
    return { title: "Câmera em uso", detail: "A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente." };
  if (name === "OverconstrainedError")
    return { title: "Câmera indisponível", detail: "Não foi possível usar a câmera traseira. Tente novamente." };
  if (name === "SecurityError")
    return { title: "Conexão insegura", detail: "A câmera exige uma conexão segura (HTTPS)." };
  return { title: "Falha ao iniciar a câmera", detail: "Não foi possível iniciar a câmera. Tente novamente." };
}

export default function Scan() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const active = user?.subscription_status === "active";

  const [status, setStatus] = useState("starting"); // starting | running | recognized | error
  const [error, setError] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lockRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const s = streamRef.current;
    if (s) { s.getTracks().forEach((t) => { try { t.stop(); } catch {} }); streamRef.current = null; }
    if (videoRef.current) { try { videoRef.current.srcObject = null; } catch {} }
  }, []);

  const submitToken = useCallback(async (token) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setStatus("recognized");
    stopCamera();
    try {
      const { data } = await api.post("/consumer/scan", { qr_token: (token || "").trim() });
      navigate(`/transaction/${data.transaction_id}`);
    } catch (err) {
      toast.error(formatApiError(err)); // QR inválido / estabelecimento inativo / desconto não configurado etc.
      lockRef.current = false;
      setAttempt((a) => a + 1); // restart camera to allow another read
    }
  }, [navigate, stopCamera]);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { rafRef.current = requestAnimationFrame(tick); return; }
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    let imageData;
    try { imageData = ctx.getImageData(0, 0, w, h); } catch { rafRef.current = requestAnimationFrame(tick); return; }
    const code = jsQR(imageData.data, w, h, { inversionAttempts: "dontInvert" });
    if (code && code.data) { submitToken(code.data); return; }
    rafRef.current = requestAnimationFrame(tick);
  }, [submitToken]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    lockRef.current = false;
    setError(null);
    setStatus("starting");

    const start = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (!cancelled) { setError({ title: "Navegador incompatível", detail: "Este navegador não suporta acesso à câmera. Atualize ou use outro navegador." }); setStatus("error"); }
        return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (err) {
        if (err?.name === "OverconstrainedError") {
          try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
          catch (e2) { if (!cancelled) { setError(cameraErrorMessage(e2)); setStatus("error"); } return; }
        } else { if (!cancelled) { setError(cameraErrorMessage(err)); setStatus("error"); } return; }
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.setAttribute("playsinline", "true");
      video.setAttribute("muted", "true");
      video.muted = true;
      video.srcObject = stream;
      try { await video.play(); } catch {}
      // torch capability
      try {
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps && caps.torch) setTorchAvailable(true);
      } catch {}
      if (!cancelled) { setStatus("running"); rafRef.current = requestAnimationFrame(tick); }
    };
    start();
    return () => { cancelled = true; stopCamera(); };
  }, [active, attempt, tick, stopCamera]);

  const toggleTorch = async () => {
    const s = streamRef.current;
    if (!s) return;
    const track = s.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ torch: !torchOn }] }); setTorchOn(!torchOn); }
    catch { toast.error("Lanterna indisponível neste dispositivo."); }
  };

  if (!active) {
    return (
      <div className="min-h-screen px-4 pt-6 animate-fade-up" data-testid="scan-inactive">
        <button onClick={() => navigate("/home")} className="rounded-full bg-off-surface p-2 text-white"><ChevronLeft className="h-5 w-5" /></button>
        <div className="mx-auto mt-16 max-w-sm rounded-3xl border border-off-warning/40 bg-off-warning/10 p-6 text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-off-warning" />
          <h1 className="mt-4 font-display text-xl font-bold text-off-warning">Assinatura não ativa</h1>
          <p className="mt-2 text-sm text-gray-200">Sua assinatura não está ativa. Regularize para utilizar os descontos.</p>
          <Button data-testid="scan-regularize" onClick={() => navigate("/profile")} className="mt-5 h-12 w-full rounded-xl off-gradient font-semibold text-white">Regularizar assinatura</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 pt-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/home")} className="rounded-full bg-off-surface p-2 text-white"><ChevronLeft className="h-5 w-5" /></button>
        <h1 className="font-display text-lg font-bold text-white">Escanear QR Code</h1>
        <button data-testid="scan-torch" onClick={toggleTorch} disabled={!torchAvailable || status !== "running"} className={`rounded-full p-2 ${torchOn ? "bg-off-orange text-white" : "bg-off-surface text-off-orange"} disabled:opacity-40`}>
          <Flashlight className="h-5 w-5" />
        </button>
      </div>

      <div className="relative mx-auto mt-6 aspect-square max-w-sm overflow-hidden rounded-3xl border-2 border-off-orange/40 bg-black" data-testid="qr-reader">
        <video ref={videoRef} data-testid="scan-video" autoPlay playsInline muted className={`h-full w-full object-cover ${status === "error" ? "hidden" : ""}`} />
        <canvas ref={canvasRef} className="hidden" />
        {/* framing overlay */}
        {status === "running" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-2/3 w-2/3 rounded-2xl border-4 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
          </div>
        )}
        {status === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-300">
            <RefreshCw className="h-6 w-6 animate-spin text-off-orange" />
            <p className="text-sm">Iniciando câmera…</p>
          </div>
        )}
        {status === "recognized" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-off-success/20 text-off-success" data-testid="scan-recognized">
            <CheckCircle2 className="h-10 w-10" />
            <p className="text-sm font-semibold">QR Code reconhecido</p>
          </div>
        )}
      </div>

      {status === "error" ? (
        <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-off-error/40 bg-off-error/10 p-5 text-center" data-testid="scan-camera-error">
          <CameraOff className="mx-auto h-10 w-10 text-off-error" />
          <h2 className="mt-3 font-display font-bold text-off-error">{error?.title || "Falha na câmera"}</h2>
          <p className="mt-1 text-sm text-gray-200">{error?.detail}</p>
          <Button data-testid="scan-retry" onClick={() => { lockRef.current = false; setAttempt((a) => a + 1); }} className="mt-4 h-11 w-full rounded-xl off-gradient font-semibold text-white"><RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente</Button>
        </div>
      ) : (
        <p className="mt-4 text-center text-sm text-gray-400">Aponte a câmera para o QR Code do estabelecimento. A leitura é automática.</p>
      )}
    </div>
  );
}
