import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { X, MessageCircle, Sparkles, Store } from "lucide-react";
import { api, fileUrl } from "@/lib/api";
import { fmtDate, money } from "@/components/shared";
import ActionButtons from "@/components/ActionButtons";

const IMG_DURATION = 12000; // 12s para imagem estática
const VIDEO_CAP = 30000;    // vídeo até 30s
const CAT_LABEL = { offer: "Oferta", job: "Vaga", event: "Evento", service: "Serviço", notice: "Aviso" };

export default function StoryViewer({ group, onClose }) {
  const navigate = useNavigate();
  const stories = group?.stories || [];
  const est = group?.establishment || {};
  const sponsored = !!group?.sponsored;
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [hidden, setHidden] = useState(false);

  const s = stories[idx];
  const isVideo = s?.media_type === "video" && s?.media_url;
  const paused = holding || interacting || hidden;
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const videoRef = useRef(null);
  const downRef = useRef(null);

  const advance = useCallback(() => {
    setIdx((i) => { if (i < stories.length - 1) return i + 1; onClose(); return i; });
  }, [stories.length, onClose]);
  const back = useCallback(() => setIdx((i) => (i > 0 ? i - 1 : i)), []);

  // Aba em segundo plano pausa o tempo
  useEffect(() => {
    const h = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  // Métrica: registra visualização somente após 2s visível (backend deduplica)
  useEffect(() => {
    if (!s) return;
    const t = setTimeout(() => { api.post(`/consumer/stories/${s.id}/view`).catch(() => {}); }, 2000);
    return () => clearTimeout(t);
  }, [idx, s]);

  // Temporizador para imagem estática (12s), respeitando pausa
  useEffect(() => {
    setProgress(0);
    if (!s || isVideo) return;
    let elapsed = 0; const step = 50;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      elapsed += step;
      setProgress(Math.min(elapsed / IMG_DURATION, 1));
      if (elapsed >= IMG_DURATION) { clearInterval(id); advance(); }
    }, step);
    return () => clearInterval(id);
  }, [idx, isVideo, s, advance]);

  // Controle de vídeo: pausa/retoma conforme estado
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause(); else v.play().catch(() => {});
  }, [paused, idx]);

  if (!stories.length || !s) return null;

  const onVideoTime = () => {
    const v = videoRef.current; if (!v) return;
    const dur = Math.min(v.duration || VIDEO_CAP / 1000, VIDEO_CAP / 1000);
    setProgress(Math.min(v.currentTime / dur, 1));
    if (v.currentTime >= VIDEO_CAP / 1000) advance();
  };

  // Toque: segurar pausa; toque curto navega (esquerda volta / direita avança)
  const onDown = (e) => { downRef.current = { x: e.clientX, t: Date.now() }; setHolding(true); };
  const onUp = (e) => {
    setHolding(false);
    const d = downRef.current; downRef.current = null;
    if (!d) return;
    if (Date.now() - d.t < 250) {
      const rect = e.currentTarget.getBoundingClientRect();
      const rel = (e.clientX - rect.left) / rect.width;
      if (rel < 0.35) back(); else advance();
    }
  };

  const goEstablishment = () => {
    api.post(`/consumer/stories/${s.id}/click`, { kind: "establishment" }).catch(() => {});
    onClose();
    navigate(`/establishment/${est.id}`);
  };

  const subtitle = [est.category_name, est.neighborhood].filter(Boolean).join(" · ");
  const hap = group?.happening;
  const hapInfo = group?.happening_info || {};
  const hapDate = hapInfo.date ? hapInfo.date.split("-").slice(1).reverse().join("/") : "";
  const hapTime = hapInfo.start ? `${hapInfo.start}${hapInfo.end ? `–${hapInfo.end}` : ""}` : "";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black" data-testid="story-viewer">
      <div className={`relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-black ${sponsored ? "ring-2 ring-off-orange/70" : ""}`}>
        {/* Mídia de fundo (blur) + principal (contain, sem distorção) */}
        <div className="absolute inset-0 z-0">
          {s.media_url ? (
            <>
              {isVideo ? (
                <>
                  <video src={fileUrl(s.media_url)} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" muted playsInline />
                  <video ref={videoRef} src={fileUrl(s.media_url)} className="absolute inset-0 z-[1] mx-auto h-full w-full object-contain object-top" autoPlay muted playsInline onTimeUpdate={onVideoTime} onEnded={advance} data-testid="story-video" />
                </>
              ) : (
                <>
                  <img alt="" src={fileUrl(s.media_url)} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
                  <img alt="" src={fileUrl(s.media_url)} className="absolute inset-0 z-[1] mx-auto h-full w-full object-contain object-top" />
                </>
              )}
            </>
          ) : (
            <div className="absolute inset-0 off-gradient" />
          )}
          <div className="absolute inset-0 z-[2] bg-gradient-to-t from-black/85 via-black/10 to-black/60" />
        </div>

        {/* Camada de interação (toque/segurar) — abaixo do cabeçalho e dos botões */}
        <div className="absolute inset-0 z-[5]" onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={() => setHolding(false)} data-testid="story-touch" />

        {/* Barras de progresso */}
        <div className="absolute inset-x-0 top-0 z-20 flex gap-1 p-3">
          {stories.map((_, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              <div className="h-full bg-white" style={{ width: i < idx ? "100%" : i === idx ? `${progress * 100}%` : "0%" }} />
            </div>
          ))}
        </div>

        {/* Cabeçalho */}
        <div className="absolute inset-x-0 top-3 z-20 flex items-center justify-between px-4 pt-2">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/30 bg-off-surface">
              {est.logo_url ? <img alt="" src={fileUrl(est.logo_url)} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white drop-shadow">{est.fantasy_name}</span>
              {subtitle && <span className="text-[11px] text-gray-200 drop-shadow">{subtitle}</span>}
            </div>
            {sponsored && <span data-testid="story-sponsored" className="ml-1 inline-flex items-center gap-1 rounded-full bg-off-orange px-2 py-0.5 text-[10px] font-bold text-white shadow"><Sparkles className="h-2.5 w-2.5" /> PATROCINADO</span>}
          </div>
          <button onClick={onClose} data-testid="story-close" className="rounded-full bg-black/40 p-1.5"><X className="h-5 w-5 text-white" /></button>
        </div>

        {/* Aviso especial ACIMA da mídia — só ele pulsa; a mídia do Story permanece estável */}
        {hap && (
          <div className="pointer-events-none absolute inset-x-0 top-[64px] z-20 px-4">
            <div data-testid="story-happening-banner" className={`animate-story-pulse flex flex-col gap-0.5 rounded-xl px-3 py-2 shadow-lg backdrop-blur-sm ${hap === "now" ? "bg-off-orange/95" : "border border-off-warning/70 bg-black/70"}`}>
              <span data-testid={hap === "now" ? "story-happening-now" : "story-happening-soon"} className={`text-sm font-extrabold ${hap === "now" ? "text-white" : "text-off-warning"}`}>{hap === "now" ? "⚡ ACONTECENDO AGORA" : "⏰ COMEÇA EM BREVE"}</span>
              {hapInfo.title && <span className="text-sm font-semibold text-white">{hapInfo.title}</span>}
              {(hapDate || hapTime) && <span className="text-[11px] text-gray-100">{[hapDate, hapTime].filter(Boolean).join(" · ")}</span>}
              {hapInfo.region && <span className="text-[11px] text-gray-100">📍 {hapInfo.region}</span>}
            </div>
          </div>
        )}

        {/* Conteúdo inferior (área segura) — elevado para aproveitar melhor a tela */}
        <div className="relative z-20 mt-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+80px)] pt-6" onPointerDown={(e) => e.stopPropagation()}>
          <span className="rounded-full bg-off-orange/25 px-3 py-1 text-xs font-semibold text-off-orange">{CAT_LABEL[s.category] || s.category}</span>
          <h3 className="mt-2 font-display text-2xl font-bold text-white drop-shadow">{s.title}</h3>
          {s.text && <p className="mt-1 text-sm text-gray-100 drop-shadow line-clamp-3">{s.text}</p>}

          {est.discount_percent ? (
            <div className="mt-3 rounded-xl border border-off-orange/40 bg-black/50 p-3 backdrop-blur-sm" data-testid="story-discount">
              <p className="font-display text-xl font-bold text-off-orange">{est.discount_percent}% OFF</p>
              <div className="mt-0.5 space-y-0.5 text-[11px] text-gray-200">
                {est.discount_min_purchase ? <p>Compra mínima: {money(est.discount_min_purchase)}</p> : null}
                {est.discount_max_cap ? <p>Desconto máximo: {money(est.discount_max_cap)}</p> : null}
                {est.discount_rules ? <p>{est.discount_rules}</p> : null}
              </div>
            </div>
          ) : null}

          {s.expires_at && <p className="mt-2 text-[11px] text-gray-300">Válido até {fmtDate(s.expires_at)}</p>}

          <div className="mt-3 space-y-2">
            {est.action_buttons?.length ? (
              <ActionButtons establishment={est} storyId={s.id} onInteract={setInteracting} />
            ) : (est.whatsapp ? (() => {
              const digits = (est.whatsapp || "").replace(/\D/g, "");
              const phone = digits.length <= 11 ? "55" + digits : digits;
              const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Venho pela OFF 360 e gostaria de falar sobre ${est.fantasy_name}.`)}`;
              return (
                <a href={waUrl} target="_blank" rel="noreferrer"
                   onClick={() => api.post(`/consumer/stories/${s.id}/click`, { kind: "story" }).catch(() => {})}
                   className="flex w-full items-center justify-center gap-2 rounded-xl bg-off-success py-3 text-sm font-semibold text-white" data-testid="story-whatsapp">
                  <MessageCircle className="h-4 w-4" /> Falar no WhatsApp
                </a>
              );
            })() : null)}
            <button onClick={goEstablishment} data-testid="story-see-establishment" className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/30 bg-black/40 py-3 text-sm font-semibold text-white backdrop-blur-sm">
              <Store className="h-4 w-4" /> Ver estabelecimento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
