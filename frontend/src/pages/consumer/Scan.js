import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, ChevronLeft, Keyboard, Camera } from "lucide-react";

export default function Scan() {
  const navigate = useNavigate();
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(true);
  const scannerRef = useRef(null);
  const runningRef = useRef(false);

  const resolve = async (token) => {
    try {
      const { data } = await api.post("/consumer/scan", { qr_token: token.trim() });
      sessionStorage.setItem("scan_est", JSON.stringify(data.establishment));
      navigate("/transaction/new");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  useEffect(() => {
    if (manual) return;
    let mounted = true;
    const el = "qr-reader";
    const scanner = new Html5Qrcode(el, { verbose: false });
    scannerRef.current = scanner;
    Html5Qrcode.getCameras().then((cams) => {
      if (!mounted || !cams || !cams.length) { setStarting(false); return; }
      const camId = cams[cams.length - 1].id;
      scanner.start(camId, { fps: 10, qrbox: 240 }, (decoded) => {
        if (runningRef.current) return;
        runningRef.current = true;
        scanner.stop().then(() => resolve(decoded)).catch(() => resolve(decoded));
      }, () => {}).then(() => { if (mounted) setStarting(false); }).catch(() => { if (mounted) { setStarting(false); setManual(true); } });
    }).catch(() => { setStarting(false); setManual(true); });

    return () => {
      mounted = false;
      const s = scannerRef.current;
      if (s) { try { s.stop().then(() => s.clear()).catch(() => {}); } catch {} }
    };
  }, [manual]); // eslint-disable-line

  return (
    <div className="min-h-screen px-4 pt-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/home")} className="rounded-full bg-off-surface p-2 text-white"><ChevronLeft className="h-5 w-5" /></button>
        <h1 className="font-display text-lg font-bold text-white">Escanear QR Code</h1>
        <button data-testid="scan-toggle-manual" onClick={() => setManual(!manual)} className="rounded-full bg-off-surface p-2 text-off-orange">
          {manual ? <Camera className="h-5 w-5" /> : <Keyboard className="h-5 w-5" />}
        </button>
      </div>

      {!manual ? (
        <>
          <div className="mx-auto mt-6 max-w-sm overflow-hidden rounded-3xl border-2 border-off-orange/40 bg-black">
            <div id="qr-reader" data-testid="qr-reader" className="w-full" />
            {starting && <p className="p-8 text-center text-sm text-gray-400">Iniciando câmera...</p>}
          </div>
          <p className="mt-4 text-center text-sm text-gray-400">Aponte para o QR Code do estabelecimento.</p>
          <button onClick={() => setManual(true)} className="mt-2 w-full text-center text-xs text-off-orange">Ou digitar o código manualmente</button>
        </>
      ) : (
        <div className="mx-auto mt-8 max-w-sm">
          <div className="flex flex-col items-center rounded-3xl border border-off-blue/40 bg-off-surface p-8">
            <ScanLine className="h-12 w-12 text-off-orange" />
            <p className="mt-3 text-center text-sm text-gray-300">Digite o código do QR Code do estabelecimento.</p>
            <Input data-testid="scan-manual-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código do estabelecimento"
              className="mt-4 h-12 rounded-xl border-off-blue/40 bg-off-bg text-white" />
            <Button data-testid="scan-manual-submit" onClick={() => resolve(code)} disabled={!code} className="mt-3 h-12 w-full rounded-xl off-gradient font-semibold text-white">Continuar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
