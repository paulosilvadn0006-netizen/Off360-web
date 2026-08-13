import React, { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ZoomIn, Check, X, Smartphone } from "lucide-react";

// Enquadramento vertical 9:16 (Reels) — 1080x1920. Imagem: recorte real via canvas.
// Vídeo: valida duração (<= maxVideoSec) e mostra prévia 9:16 (sem recorte no cliente).
const OUT_W = 1080;
const OUT_H = 1920;
const FW = 234; // largura do quadro na tela
const FH = Math.round((FW * 16) / 9); // 416

export default function Media916Editor({ open, file, allowVideo = false, maxVideoSec = 60, onCancel, onConfirm }) {
  const [kind, setKind] = useState(null); // "image" | "video"
  const [imgEl, setImgEl] = useState(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoDur, setVideoDur] = useState(0);
  const [z, setZ] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [ready, setReady] = useState(false);
  const drag = useRef(null);

  const baseScale = nat.w && nat.h ? Math.max(FW / nat.w, FH / nat.h) : 1;

  const clampTo = useCallback((nx, ny, zoom) => {
    const ds = baseScale * zoom;
    const dw = nat.w * ds, dh = nat.h * ds;
    return [Math.min(0, Math.max(FW - dw, nx)), Math.min(0, Math.max(FH - dh, ny))];
  }, [baseScale, nat]);

  useEffect(() => {
    if (!file || !open) return;
    setReady(false); setZ(1); setTx(0); setTy(0); setImgEl(null); setVideoUrl(null); setVideoDur(0);
    const isVideo = file.type.startsWith("video");
    if (isVideo) {
      if (!allowVideo) { toast.error("Este espaço aceita apenas imagens."); onCancel?.(); return; }
      setKind("video");
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        if (v.duration > maxVideoSec + 0.5) {
          toast.error(`O vídeo tem ${Math.round(v.duration)}s. Máximo permitido: ${maxVideoSec}s.`);
          URL.revokeObjectURL(url);
          onCancel?.();
          return;
        }
        setVideoDur(v.duration); setVideoUrl(url); setReady(true);
      };
      v.onerror = () => { toast.error("Não foi possível ler o vídeo."); URL.revokeObjectURL(url); onCancel?.(); };
      v.src = url;
    } else {
      setKind("image");
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setNat({ w: img.naturalWidth, h: img.naturalHeight });
        setImgEl(img); setReady(true);
      };
      img.onerror = () => { toast.error("Não foi possível ler a imagem."); URL.revokeObjectURL(url); onCancel?.(); };
      img.src = url;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, open]);

  // Reposiciona para "cover" centralizado quando a imagem carrega ou zoom muda
  useEffect(() => {
    if (kind !== "image" || !nat.w) return;
    setTx((px) => { const [nx] = clampTo(px, ty, z); return nx; });
    setTy((py) => { const [, ny] = clampTo(tx, py, z); return ny; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat, kind]);

  const onZoom = (val) => {
    const nz = parseFloat(val);
    const oldDs = baseScale * z, newDs = baseScale * nz;
    const sx = (FW / 2 - tx) / oldDs, sy = (FH / 2 - ty) / oldDs;
    let nx = FW / 2 - sx * newDs, ny = FH / 2 - sy * newDs;
    [nx, ny] = clampTo(nx, ny, nz);
    setZ(nz); setTx(nx); setTy(ny);
  };

  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, tx, ty }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => {
    if (!drag.current) return;
    const nxRaw = drag.current.tx + (e.clientX - drag.current.x);
    const nyRaw = drag.current.ty + (e.clientY - drag.current.y);
    const [nx, ny] = clampTo(nxRaw, nyRaw, z);
    setTx(nx); setTy(ny);
  };
  const onUp = () => { drag.current = null; };

  const confirm = async () => {
    if (kind === "video") { onConfirm?.(file, "video"); return; }
    const ds = baseScale * z;
    const sx = (0 - tx) / ds, sy = (0 - ty) / ds;
    const sw = FW / ds, sh = FH / ds;
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W; canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
    canvas.toBlob((blob) => {
      if (!blob) { toast.error("Falha ao processar a imagem."); return; }
      const out = new File([blob], "story_9x16.jpg", { type: "image/jpeg" });
      onConfirm?.(out, "image");
    }, "image/jpeg", 0.92);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel?.(); }}>
      <DialogContent
        className="max-w-sm border-off-blue/40 bg-off-surface text-white"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="media916-editor"
      >
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Smartphone className="h-4 w-4 text-off-orange" /> Ajuste 9:16 (Reels)</DialogTitle></DialogHeader>
        <p className="-mt-1 text-[11px] text-gray-400">Formato vertical <b className="text-gray-200">9:16 · 1080×1920</b>. {kind === "image" ? "Arraste e use o zoom para enquadrar." : "Prévia do vídeo no formato vertical."}</p>

        <div className="flex justify-center py-2">
          <div
            className="relative overflow-hidden rounded-2xl border-2 border-off-orange/60 bg-black"
            style={{ width: FW, height: FH, touchAction: "none" }}
            data-testid="media916-frame"
          >
            {kind === "image" && imgEl && (
              <img
                alt=""
                src={imgEl.src}
                draggable={false}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                style={{
                  position: "absolute", left: 0, top: 0,
                  width: nat.w * baseScale * z, height: nat.h * baseScale * z,
                  transform: `translate(${tx}px, ${ty}px)`, cursor: "grab", userSelect: "none",
                }}
              />
            )}
            {kind === "video" && videoUrl && (
              <video src={videoUrl} className="h-full w-full object-cover" muted autoPlay loop playsInline data-testid="media916-video-preview" />
            )}
            {/* guias 9:16 */}
            <div className="pointer-events-none absolute inset-0 ring-1 ring-white/10" />
          </div>
        </div>

        {kind === "image" && (
          <div className="flex items-center gap-3 px-1">
            <ZoomIn className="h-4 w-4 shrink-0 text-gray-300" />
            <input
              type="range" min={1} max={3} step={0.01} value={z}
              onChange={(e) => onZoom(e.target.value)}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-off-blue/40 accent-off-orange"
              data-testid="media916-zoom"
            />
          </div>
        )}
        {kind === "video" && videoDur > 0 && (
          <p className="text-center text-[11px] text-off-success" data-testid="media916-duration">Duração: {Math.round(videoDur)}s · limite {maxVideoSec}s</p>
        )}

        <div className="mt-1 flex gap-2">
          <Button variant="outline" onClick={() => onCancel?.()} className="flex-1 rounded-xl border-off-blue/40 text-white" data-testid="media916-cancel"><X className="mr-1 h-4 w-4" /> Cancelar</Button>
          <Button onClick={confirm} disabled={!ready} className="flex-1 rounded-xl off-gradient font-semibold text-white" data-testid="media916-confirm"><Check className="mr-1 h-4 w-4" /> Usar mídia</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
