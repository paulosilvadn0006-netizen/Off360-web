import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X, MessageCircle, Sparkles, Store, Zap, Clock, MapPin } from "lucide-react";
import { api, fileUrl } from "@/lib/api";
import { fmtDate, money } from "@/components/shared";
import ActionButtons from "@/components/ActionButtons";

const IMG_DURATION = 3000; // 3s para imagem estática
const VIDEO_CAP = 30000;    // vídeo até 30s
const CAT_LABEL = { offer: "Oferta", job: "Vaga", event: "Evento", service: "Serviço", notice: "Aviso" };

// Hora local America/Sao_Paulo (independe do UTC do dispositivo)
function spNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Estado ao vivo a partir dos dados reais do Destaque (data/horário configurados)
function computeHappening(info) {
  if (!info?.date || !info?.start) return null;
  const n = spNow();
  const nowStr = `${n.date}T${n.time}`;
  const startStr = `${info.date}T${info.start}`;
  const endStr = info.end ? `${info.date}T${info.end}` : null;
  if (nowStr < startStr) return "soon";                                     // antes do início (mesmo dias antes) → começa em breve
  if (endStr && info.end > info.start && nowStr >= endStr) return null;     // após o término → encerrado
  return "now";                                                            // dentro da janela → acontecendo agora
}

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

  // Estado "acontecendo agora / começa em breve" recalculado ao vivo a cada 1 min
  const info = group?.happening_info;
  const [hap, setHap] = useState(() => (info ? computeHappening(info) : (group?.happening || null)));
  useEffect(() => {
    const tick = () => setHap(info ? computeHappening(info) : (group?.happening || null));
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [info, group]);

  const advance = useCallback(() => {
    setIdx((i) => { if (i < stories.length - 1) return i + 1; onClose(); return i; });
  }, [stories.length, onClose]);
  const back = useCallback(() => setIdx((i) => (i > 0 ? i - 1 : i)), []);

  useEffect(() => {
    const h = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  useEffect(() => {
    if (!s) return;
    const t = setTimeout(() => { api.post(`/consumer/stories/${s.id}/view`).catch(() => {}); }, 2000);
    return () => clearTimeout(t);
  }, [idx, s]);

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
  const hapInfo = info || {};
  const hapDate = hapInfo.date ? hapInfo.date.split("-").slice(1).reverse().join("/") : "";
  const hapRange = hapInfo.start ? `${hapInfo.start}${hapInfo.end ? ` às ${hapInfo.end}` : ""}` : "";
  const discSummary = est.discount_percent
    ? `${est.discount_percent}% OFF${est.discount_max_cap ? ` até ${money(est.discount_max_cap)}` : ""}`
    : null;
  const periodParts = [discSummary, hapDate, hapRange].filter(Boolean);

  // Barras de progresso (compartilhadas)
  const ProgressBars = (
    <div className="flex gap-1 px-3 pt-3">
      {stories.map((_, i) => (
        <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/40 ring-1 ring-black/20">
          <div className="h-full rounded-full bg-white" style={{ width: i < idx ? "100%" : i === idx ? `${progress * 100}%` : "0%" }} />
        </div>
      ))}
    </div>
  );

  const Header = (
    <div className="flex items-center justify-between px-4 pt-2 pb-2">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/30 bg-off-surface">
          {est.logo_url ? <img alt="" src={fileUrl(est.logo_url)} className="h-full w-full object-cover" /> : null}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-white drop-shadow">{est.fantasy_name}</span>
            {sponsored && <span data-testid="story-sponsored" className="inline-flex items-center gap-1 rounded-full bg-off-orange px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow"><Sparkles className="h-2.5 w-2.5" /> Patrocinado</span>}
          </div>
          {subtitle && <span className="text-[11px] text-gray-200 drop-shadow">{subtitle}</span>}
        </div>
      </div>
      <button onClick={onClose} data-testid="story-close" className="rounded-full bg-black/40 p-1.5"><X className="h-5 w-5 text-white" /></button>
    </div>
  );

  // Conteúdo da oferta (categoria, título, descrição, desconto, validade, ações)
  const OfferContent = (
    <>
      <span className="rounded-full bg-off-orange/20 px-3 py-1 text-xs font-semibold text-off-orange">{CAT_LABEL[s.category] || s.category}</span>
      <h3 className="mt-2 font-display text-2xl font-bold text-white">{s.title}</h3>
      {s.text && <p className="mt-1 text-sm text-gray-200 line-clamp-2">{s.text}</p>}

      {est.discount_percent ? (
        <div className="mt-3 rounded-xl border border-off-orange/40 bg-off-surface/80 p-3" data-testid="story-discount">
          <p className="font-display text-xl font-bold text-off-orange">{est.discount_percent}% OFF</p>
          <div className="mt-0.5 space-y-0.5 text-[11px] text-gray-300">
            {est.discount_min_purchase ? <p>Compra mínima: {money(est.discount_min_purchase)}</p> : null}
            {est.discount_max_cap ? <p>Desconto máximo: {money(est.discount_max_cap)}</p> : null}
            {est.discount_rules ? <p>{est.discount_rules}</p> : null}
          </div>
        </div>
      ) : null}

      {hapInfo.date && hapRange
        ? <p className="mt-2 text-[11px] text-gray-400" data-testid="story-validity">Válido: {hapDate} das {hapRange}</p>
        : (s.expires_at && <p className="mt-2 text-[11px] text-gray-400" data-testid="story-validity">Válido até {fmtDate(s.expires_at)}</p>)}

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
        <button onClick={goEstablishment} data-testid="story-see-establishment" className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/25 bg-off-surface/70 py-3 text-sm font-semibold text-white">
          <Store className="h-4 w-4" /> Ver estabelecimento
        </button>
      </div>
    </>
  );

  // Aviso dinâmico (só ele pulsa) + linha de informações do período
  const HappeningBlock = (
    <div className="px-3 pt-1">
      {hap && (
        <div data-testid="story-happening-banner"
             className={`animate-story-pulse flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-center shadow-lg ${hap === "now" ? "bg-off-orange text-white ring-2 ring-off-orange/60" : "border border-off-warning/70 bg-black/70 text-off-warning"}`}>
          {hap === "now" ? <Zap className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          <span data-testid={hap === "now" ? "story-happening-now" : "story-happening-soon"} className="text-sm font-extrabold uppercase tracking-wide">
            {hap === "now" ? "Acontecendo agora" : "Começa em breve"}
          </span>
        </div>
      )}
      {hapInfo.title && <p className="mt-1 text-center text-sm font-semibold text-white">{hapInfo.title}</p>}
      {(periodParts.length > 0 || hapInfo.region) && (
        <p className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1.5 text-center text-[11px] text-gray-300">
          {periodParts.join(" · ")}
          {hapInfo.region && <span className="inline-flex items-center gap-0.5 text-off-orange"><MapPin className="h-3 w-3" /> {hapInfo.region}</span>}
        </p>
      )}
    </div>
  );

  // Mídia (usada dentro do bloco stacked ou como fundo no orgânico) — absoluta p/ não empurrar o layout
  const Media = s.media_url ? (
    isVideo ? (
      <video ref={videoRef} src={fileUrl(s.media_url)} className="absolute inset-0 h-full w-full object-cover object-top" autoPlay muted playsInline onTimeUpdate={onVideoTime} onEnded={advance} data-testid="story-video" />
    ) : (
      <img alt="" src={fileUrl(s.media_url)} className="absolute inset-0 h-full w-full object-cover object-top" />
    )
  ) : <div className="absolute inset-0 off-gradient" />;

  // ---- LAYOUT PATROCINADO (empilhado, referência OFF360) ----
  if (sponsored) {
    return createPortal(
      <div className="fixed inset-0 z-[70] bg-black" data-testid="story-viewer">
        <div className="absolute inset-0 mx-auto flex max-w-[430px] flex-col overflow-hidden bg-black ring-2 ring-off-orange/60">
          {ProgressBars}
          {Header}
          {HappeningBlock}
          {/* Imagem: ocupa a maior área, alinhada ao topo; toque navega, segurar pausa */}
          <div className="relative mt-1 min-h-0 flex-1 overflow-hidden bg-black"
               onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={() => setHolding(false)} data-testid="story-touch">
            {Media}
          </div>
          {/* Conteúdo imediatamente abaixo da mídia (sem vão); pb livra a barra inferior */}
          <div className="shrink-0 overflow-y-auto px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+76px)]">
            {OfferContent}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ---- LAYOUT ORGÂNICO (mídia em tela cheia com sobreposição — preservado) ----
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black" data-testid="story-viewer">
      <div className="absolute inset-0 mx-auto flex max-w-[430px] flex-col overflow-hidden bg-black">
        <div className="absolute inset-0 z-0">
          {s.media_url ? (
            isVideo ? (
              <>
                <video src={fileUrl(s.media_url)} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" muted playsInline />
                <video ref={videoRef} src={fileUrl(s.media_url)} className="absolute inset-0 z-[1] mx-auto h-full w-full object-contain" autoPlay muted playsInline onTimeUpdate={onVideoTime} onEnded={advance} data-testid="story-video" />
              </>
            ) : (
              <>
                <img alt="" src={fileUrl(s.media_url)} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
                <img alt="" src={fileUrl(s.media_url)} className="absolute inset-0 z-[1] mx-auto h-full w-full object-contain" />
              </>
            )
          ) : (
            <div className="absolute inset-0 off-gradient" />
          )}
          <div className="absolute inset-0 z-[2] bg-gradient-to-t from-black/85 via-black/10 to-black/60" />
        </div>

        <div className="absolute inset-0 z-[5]" onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={() => setHolding(false)} data-testid="story-touch" />

        <div className="absolute inset-x-0 top-0 z-20">{ProgressBars}</div>
        <div className="absolute inset-x-0 top-6 z-20">{Header}</div>

        <div className="relative z-20 mt-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+80px)] pt-6" onPointerDown={(e) => e.stopPropagation()}>
          {OfferContent}
        </div>
      </div>
    </div>,
    document.body
  );
}
