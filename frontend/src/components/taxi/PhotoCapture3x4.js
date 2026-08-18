import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { uploadFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Camera, RefreshCw, Upload, Loader2, Check } from "lucide-react";

// Captura foto 3x4 pela câmera (com selfie) e valida proporção ~3:4. Fallback: upload de arquivo.
const RATIO = 3 / 4; // largura/altura
const TOL = 0.12;

export default function PhotoCapture3x4({ value, onChange }) {
  const videoRef = useRef(null);
  const fileRef = useRef(null);
  const streamRef = useRef(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  const startCam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = s;
      setLive(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); } }, 50);
    } catch (e) { toast.error("Não foi possível acessar a câmera. Use o envio de arquivo."); }
  };
  const stopCam = () => { try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch (_) {} setLive(false); };

  const capture = async () => {
    const v = videoRef.current;
    if (!v) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    // recorte central em proporção 3:4
    let cw = vw, ch = Math.round(vw / RATIO);
    if (ch > vh) { ch = vh; cw = Math.round(vh * RATIO); }
    const sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 800;
    canvas.getContext("2d").drawImage(v, sx, sy, cw, ch, 0, 0, 600, 800);
    setBusy(true);
    canvas.toBlob(async (blob) => {
      try {
        const file = new File([blob], "foto3x4.jpg", { type: "image/jpeg" });
        const up = await uploadFile(file);
        onChange(up.url);
        stopCam();
        toast.success("Foto 3x4 capturada");
      } catch (e) { toast.error("Falha ao enviar a foto."); } finally { setBusy(false); }
    }, "image/jpeg", 0.9);
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = async () => {
      const r = img.width / img.height;
      if (Math.abs(r - RATIO) > TOL) { toast.error("A foto deve estar na proporção 3x4 (retrato). Envie uma imagem 3x4."); return; }
      setBusy(true);
      try { const up = await uploadFile(f); onChange(up.url); toast.success("Foto 3x4 enviada"); }
      catch (e2) { toast.error("Falha ao enviar a foto."); } finally { setBusy(false); }
    };
    img.onerror = () => toast.error("Imagem inválida.");
    img.src = URL.createObjectURL(f);
  };

  return (
    <div data-testid="photo-3x4" className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-3">
      <p className="mb-2 text-xs font-semibold text-gray-300">Foto 3x4 (obrigatória) — capture pela câmera</p>
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value.startsWith("http") ? value : `${process.env.REACT_APP_BACKEND_URL}${value}`} alt="3x4" className="h-24 w-[72px] rounded-lg object-cover" />
          <div className="flex items-center gap-1 text-sm text-off-success"><Check className="h-4 w-4" /> Foto pronta</div>
          <Button data-testid="photo-3x4-retake" size="sm" variant="outline" onClick={() => { onChange(""); }} className="ml-auto rounded-lg border-off-blue/40 text-gray-200"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      ) : live ? (
        <div className="space-y-2">
          <video ref={videoRef} playsInline muted className="mx-auto aspect-[3/4] w-40 rounded-lg bg-black object-cover" />
          <div className="flex gap-2">
            <Button data-testid="photo-3x4-shoot" onClick={capture} disabled={busy} className="flex-1 rounded-xl off-gradient text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Capturar"}</Button>
            <Button variant="outline" onClick={stopCam} className="rounded-xl border-off-blue/40 text-gray-200">Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button data-testid="photo-3x4-start" onClick={startCam} className="flex-1 rounded-xl off-gradient text-white"><Camera className="mr-2 h-4 w-4" /> Abrir câmera</Button>
          <Button data-testid="photo-3x4-file" variant="outline" onClick={() => fileRef.current?.click()} className="rounded-xl border-off-blue/40 text-gray-200"><Upload className="h-4 w-4" /></Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </div>
      )}
    </div>
  );
}
