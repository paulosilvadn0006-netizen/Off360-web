import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { api, uploadFile, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Camera, Upload, Loader2, Check, RefreshCw, FileText, AlertTriangle } from "lucide-react";

export const STATUS_UI = {
  aprovado: { t: "✅ Aprovado", c: "text-off-success" },
  vencido: { t: "⚠️ Vencido", c: "text-off-error" },
  irregular: { t: "❌ Irregular", c: "text-off-error" },
  suspeito: { t: "🔍 Suspeito (revisão)", c: "text-off-orange" },
};

// ---------- Upload de documento (foto ou PDF) ----------
export function DocUpload({ docType, label, allowPdf = false, value, onAnalyzed }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const up = await uploadFile(f);
      const form = new FormData();
      form.append("doc_type", docType);
      form.append("file", f);
      form.append("file_url", up.url);
      const { data } = await api.post("/taxi/documents/analyze", form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 });
      onAnalyzed({ ...data, file_url: data.file_url || up.url });
      toast.success(`${label}: ${(STATUS_UI[data.status] || {}).t || "enviado"}`);
    } catch (err) { toast.error(formatApiError(err, "Falha ao enviar o documento.")); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const st = value?.status ? (STATUS_UI[value.status] || {}) : null;
  const isPdf = value?.file_url && value.file_url.toLowerCase().endsWith(".pdf");

  return (
    <div className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-3" data-testid={`doc-${docType}`}>
      <p className="mb-2 text-xs font-semibold text-gray-300">{label} <span className="text-off-error">*</span></p>
      {value ? (
        <div className="flex items-center gap-3">
          {isPdf ? <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-off-surface"><FileText className="h-7 w-7 text-off-orange" /></div>
            : <img src={value.file_url?.startsWith("http") ? value.file_url : `${process.env.REACT_APP_BACKEND_URL}${value.file_url}`} alt={label} className="h-16 w-16 rounded-lg object-cover" />}
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-bold ${st?.c || "text-gray-300"}`}>{st?.t || "Enviado"}</p>
            {value.motivo && <p className="truncate text-[10px] text-gray-500">{value.motivo}</p>}
          </div>
          <Button data-testid={`doc-${docType}-redo`} size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="rounded-lg border-off-blue/40 text-gray-200"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      ) : (
        <Button data-testid={`doc-${docType}-btn`} onClick={() => fileRef.current?.click()} disabled={busy} className="h-11 w-full rounded-xl off-gradient text-white">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="mr-2 h-4 w-4" /> Enviar {allowPdf ? "foto ou PDF" : "foto"}</>}
        </Button>
      )}
      <input ref={fileRef} type="file" accept={allowPdf ? "image/*,application/pdf" : "image/*"} className="hidden" onChange={onFile} />
    </div>
  );
}

// ---------- Selfie segurando a CNH (SOMENTE câmera ao vivo, sem galeria) ----------
export function SelfieCnh({ value, onAnalyzed }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  const startCam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = s; setLive(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); } }, 50);
    } catch (e) {
      toast.error("Foto inválida. A selfie deve ser tirada agora pela câmera, não é permitido enviar fotos da galeria.");
    }
  };
  const stopCam = () => { try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch (_) {} setLive(false); };

  const capture = async () => {
    const v = videoRef.current; if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = 720; canvas.height = 720;
    const vw = v.videoWidth, vh = v.videoHeight, side = Math.min(vw, vh);
    canvas.getContext("2d").drawImage(v, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, 720, 720);
    setBusy(true);
    canvas.toBlob(async (blob) => {
      try {
        const file = new File([blob], "selfie_cnh.jpg", { type: "image/jpeg" });
        const up = await uploadFile(file);
        const form = new FormData();
        form.append("doc_type", "selfie"); form.append("file", file); form.append("file_url", up.url);
        const { data } = await api.post("/taxi/documents/analyze", form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 });
        onAnalyzed({ ...data, file_url: data.file_url || up.url });
        stopCam();
        toast.success("Selfie enviada para verificação.");
      } catch (e) { toast.error(formatApiError(e, "Falha ao enviar a selfie.")); }
      finally { setBusy(false); }
    }, "image/jpeg", 0.9);
  };

  return (
    <div className="rounded-xl border border-off-orange/50 bg-off-orange/5 p-3" data-testid="selfie-cnh">
      <p className="mb-1 text-xs font-semibold text-gray-200">Selfie segurando a CNH ao lado do rosto <span className="text-off-error">*</span></p>
      <p className="mb-2 flex items-start gap-1 text-[10px] text-off-orange"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> A selfie deve ser tirada agora pela câmera, não é permitido enviar fotos da galeria.</p>
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value.file_url?.startsWith("http") ? value.file_url : `${process.env.REACT_APP_BACKEND_URL}${value.file_url}`} alt="Selfie com CNH" className="h-20 w-20 rounded-lg object-cover" />
          <div className="flex items-center gap-1 text-sm text-off-success"><Check className="h-4 w-4" /> Selfie pronta</div>
          <Button size="sm" variant="outline" onClick={() => onAnalyzed(null)} className="ml-auto rounded-lg border-off-blue/40 text-gray-200"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      ) : live ? (
        <div className="space-y-2">
          <video ref={videoRef} playsInline muted className="mx-auto aspect-square w-48 rounded-lg bg-black object-cover" />
          <div className="flex gap-2">
            <Button data-testid="selfie-shoot" onClick={capture} disabled={busy} className="flex-1 rounded-xl off-gradient text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Capturar selfie"}</Button>
            <Button variant="outline" onClick={stopCam} className="rounded-xl border-off-blue/40 text-gray-200">Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button data-testid="selfie-start" onClick={startCam} className="h-11 w-full rounded-xl off-gradient text-white"><Camera className="mr-2 h-4 w-4" /> Abrir câmera para selfie</Button>
      )}
    </div>
  );
}
