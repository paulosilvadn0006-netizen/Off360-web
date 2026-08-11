import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Flashlight, CameraOff, RefreshCw } from "lucide-react";

export default function Scan() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("starting"); // starting | running | error
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const scannerRef = useRef(null);
  const lockRef = useRef(false);
  const [attempt, setAttempt] = useState(0);

  const resolve = async (token) => {
    if (lockRef.current) return;
    lockRef.current = true;
    try {
      const { data } = await api.post("/consumer/scan", { qr_token: (token || "").trim() });
      navigate(`/transaction/${data.transaction_id}`);
    } catch (err) {
      toast.error(formatApiError(err));
      lockRef.current = false;
    }
  };

  useEffect(() => {
    let mounted = true;
    const scanner = new Html5Qrcode("qr-reader", { verbose: false });
    scannerRef.current = scanner;
    setStatus("starting");
    scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (decoded) => { scanner.stop().then(() => resolve(decoded)).catch(() => resolve(decoded)); },
      () => {}
    ).then(() => {
      if (!mounted) return;
      setStatus("running");
      try {
        const caps = scanner.getRunningTrackCapabilities?.();
        if (caps && caps.torch) setTorchAvailable(true);
      } catch {}
    }).catch(() => { if (mounted) setStatus("error"); });

    return () => {
      mounted = false;
      const s = scannerRef.current;
      if (s) { try { s.stop().then(() => s.clear()).catch(() => {}); } catch {} }
    };
  }, [attempt]); // eslint-disable-line

  const toggleTorch = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try { await s.applyVideoConstraints({ advanced: [{ torch: !torchOn }] }); setTorchOn(!torchOn); }
    catch { toast.error("Lanterna indisponível neste dispositivo."); }
  };

  return (
    <div className="min-h-screen px-4 pt-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/home")} className="rounded-full bg-off-surface p-2 text-white"><ChevronLeft className="h-5 w-5" /></button>
        <h1 className="font-display text-lg font-bold text-white">Escanear QR Code</h1>
        <button data-testid="scan-torch" onClick={toggleTorch} disabled={!torchAvailable} className={`rounded-full p-2 ${torchOn ? "bg-off-orange text-white" : "bg-off-surface text-off-orange"} disabled:opacity-40`}>
          <Flashlight className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto mt-6 max-w-sm overflow-hidden rounded-3xl border-2 border-off-orange/40 bg-black">
        <div id="qr-reader" data-testid="qr-reader" className="w-full" />
        {status === "starting" && <p className="p-8 text-center text-sm text-gray-400">Solicitando acesso à câmera...</p>}
      </div>

      {status === "error" ? (
        <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-off-error/40 bg-off-error/10 p-5 text-center" data-testid="scan-camera-error">
          <CameraOff className="mx-auto h-10 w-10 text-off-error" />
          <p className="mt-3 text-sm text-gray-200">Não foi possível acessar a câmera. Permita o acesso à câmera nas configurações do navegador e tente novamente.</p>
          <Button data-testid="scan-retry" onClick={() => { lockRef.current = false; setAttempt((a) => a + 1); }} className="mt-4 h-11 w-full rounded-xl off-gradient font-semibold text-white"><RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente</Button>
        </div>
      ) : (
        <p className="mt-4 text-center text-sm text-gray-400">Aponte a câmera para o QR Code do estabelecimento. A leitura é automática.</p>
      )}
    </div>
  );
}
