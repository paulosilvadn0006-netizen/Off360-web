import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, money, fmtDistance } from "@/components/shared";
import StoryViewer from "@/components/StoryViewer";
import * as Icons from "lucide-react";
import { Bell, Search, MapPin, Ticket, TrendingUp, ChevronRight, Star, Heart, SlidersHorizontal, Plus, PartyPopper, ChevronDown } from "lucide-react";

export function estBadges(e, b) {
  if (!b) return [];
  const out = [];
  if (e.id === b.trending_id) out.push("🔥 EM ALTA");
  if (e.id === b.most_viewed_today_id) out.push("👁 MAIS VISTO HOJE");
  if (b.user_neighborhood && (e.neighborhood || "").trim().toLowerCase() === b.user_neighborhood) out.push("📍 PERTO DE VOCÊ");
  return out;
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [story, setStory] = useState(null);
  const [filter, setFilter] = useState(null);
  const [geo, setGeo] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["home"], queryFn: async () => (await api.get("/consumer/home")).data });
  const { data: notif } = useQuery({ queryKey: ["notif-count"], queryFn: async () => (await api.get("/notifications")).data });
  const { data: discover } = useQuery({
    enabled: !!filter,
    queryKey: ["discover", filter, geo?.lat, geo?.lng],
    queryFn: async () => (await api.get("/consumer/discover", { params: { filter, lat: geo?.lat, lng: geo?.lng } })).data,
  });

  const FILTERS = [
    ["bombando", "🔥 Bombando"], ["perto", "📍 Perto de você"], ["hoje", "⚡ Hoje"],
    ["ofertas", "💰 Ofertas"], ["novidades", "🆕 Novidades"], ["vagas", "💼 Vagas"],
  ];
  const selectFilter = (f) => {
    if (filter === f) { setFilter(null); return; }
    setFilter(f);
    if (f === "perto" && !geo && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => setGeo(null), { timeout: 8000 }
      );
    }
  };

  if (isLoading || !data) return <div className="px-4 pt-8"><Loading /></div>;

  // Dedupe entre as seções: cada estabelecimento aparece só na 1ª seção elegível.
  // Se uma seção não tem itens novos, ela é ocultada (evita repetição excessiva).
  const shown = new Set();
  const pick = (list = []) => {
    const fresh = list.filter((e) => !shown.has(e.id));
    fresh.forEach((e) => shown.add(e.id));
    return fresh;
  };
  const secBombando = pick(data.sections?.bombando);
  const secHoje = pick(data.sections?.hoje);
  const secTop = pick(data.sections?.top_rated);
  const secNov = pick(data.sections?.novidades);

  return (
    <div className="px-4 pt-6 animate-fade-up">
      {/* 360Taxi — botão flutuante fixo */}
      <button
        data-testid="home-taxi-fab"
        onClick={() => navigate("/taxi")}
        className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-2xl off-gradient px-4 py-3 text-left text-white shadow-[0_10px_30px_rgba(255,106,0,0.45)] transition-transform active:scale-95"
      >
        <span className="text-2xl">🚗</span>
        <span className="leading-tight">
          <span className="block text-[11px] font-medium opacity-90">Precisa ir em algum lugar?</span>
          <span className="block font-display text-sm font-bold">360Taxi te leva</span>
        </span>
      </button>

      {/* Cabeçalho: logo + notificações */}
      <div className="flex items-center justify-between" data-testid="home-logo">
        <span className="font-display text-2xl font-extrabold tracking-tight text-white">OFF<span className="text-off-orange">360</span></span>
        <button data-testid="home-notifications" onClick={() => navigate("/notifications")} className="relative rounded-full bg-off-surface p-2.5">
          <Bell className="h-5 w-5 text-white" />
          {notif?.unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full off-gradient text-[9px] font-bold text-white">{notif.unread}</span>}
        </button>
      </div>

      <h1 className="mt-3 font-display text-2xl font-extrabold leading-tight text-white">Olá, {data.greeting_name}! 👋</h1>
      <button onClick={() => navigate("/profile")} className="mt-1 flex items-center gap-1 text-sm text-gray-400">
        <MapPin className="h-4 w-4 text-off-orange" /> {data.neighborhood} <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {/* Busca */}
      <button data-testid="home-search" onClick={() => navigate("/explore")} className="mt-4 flex w-full items-center gap-2 rounded-2xl border border-off-blue/40 bg-off-surface px-4 py-3 text-left text-sm text-gray-500">
        <Search className="h-4 w-4" /> <span className="flex-1 truncate">Buscar estabelecimentos, categorias...</span>
        <SlidersHorizontal className="h-4 w-4 text-off-orange" />
      </button>

      {/* Filtros */}
      <div className="relative mt-3">
        <div className="flex gap-2 overflow-x-auto pb-1 pr-6 no-scrollbar" data-testid="home-filters">
          {FILTERS.map(([f, label]) => (
            <button key={f} data-testid={`filter-${f}`} onClick={() => selectFilter(f)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${filter === f ? "off-gradient text-white shadow-[0_4px_14px_rgba(255,75,18,0.4)]" : "border border-off-blue/40 bg-off-surface text-gray-300"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-off-bg to-transparent" />
      </div>

      {/* Resultados de filtro (lista) */}
      {filter && (
        <div className="mt-4" data-testid="discover-results">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-white">{FILTERS.find(([f]) => f === filter)?.[1]}</h2>
            <button onClick={() => setFilter(null)} className="text-xs font-semibold text-off-orange">Limpar</button>
          </div>
          {filter === "perto" && !geo && <p className="mb-2 text-xs text-gray-400">Autorize a localização para ver por proximidade real. Mostrando por bairro/cidade.</p>}
          {!discover ? <Loading /> : (discover.items.length ? (
            <div className="space-y-3 pb-4">
              {discover.items.map((e) => <EstRow key={e.id} e={e} onClick={() => navigate(`/establishment/${e.id}`)} />)}
            </div>
          ) : <p className="py-8 text-center text-sm text-gray-500">Nada encontrado neste filtro por enquanto.</p>)}
        </div>
      )}

      {!filter && <>
        {/* Stories */}
        {data.stories.length > 0 && (
          <div className="-mx-4 mt-5 flex gap-4 overflow-x-auto px-4 pt-2 pb-3 no-scrollbar" data-testid="home-stories">
            {data.stories.map((g) => (
              <button key={g.establishment.id} data-testid={g.sponsored ? "story-bubble-sponsored" : "story-bubble"} onClick={() => setStory(g)} className="flex w-16 shrink-0 flex-col items-center gap-1">
                <div className={`rounded-full p-[2px] ${g.sponsored ? "off-gradient animate-story-pulse" : "off-gradient"}`}>
                  <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-off-bg bg-off-surface">
                    {g.establishment.logo_url ? <img alt="" src={fileUrl(g.establishment.logo_url)} className="h-full w-full object-cover" /> :
                      <div className="flex h-full w-full items-center justify-center text-sm font-bold text-off-orange">{g.establishment.fantasy_name[0]}</div>}
                  </div>
                </div>
                <span className="w-16 truncate text-center text-[10px] font-medium text-gray-200">{g.establishment.fantasy_name}</span>
                {g.happening === "now"
                  ? <span className="rounded-full bg-off-orange px-1.5 py-0.5 text-[8px] font-bold text-white">⚡ AGORA</span>
                  : g.sponsored
                    ? <span className="text-[8px] font-bold tracking-wide text-off-orange">PATROCINADO</span>
                    : <span className="text-[8px] text-transparent">·</span>}
              </button>
            ))}
            <button data-testid="story-see-all" onClick={() => navigate("/explore")} className="flex w-16 shrink-0 flex-col items-center gap-1">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-off-blue/60 bg-off-surface">
                <Plus className="h-6 w-6 text-off-orange" />
              </div>
              <span className="text-[10px] text-gray-400">Ver todos</span>
            </button>
          </div>
        )}

        {/* Bombando perto de você */}
        {secBombando.length > 0 && <>
          <SectionHeader title="🔥 Bombando perto de você" onSee={() => navigate("/explore")} />
          <p className="-mt-2 mb-3 text-xs text-gray-400">O que está chamando atenção na sua região agora.</p>
          <Carousel>{secBombando.map((e) => <EstCard key={"b" + e.id} e={e} badge={estBadges(e, data.badges)[0]} onClick={() => navigate(`/establishment/${e.id}`)} />)}</Carousel>
        </>}

        {/* Economia da comunidade */}
        <div data-testid="community-savings" className="relative mt-5 overflow-hidden rounded-3xl" style={{ background: "#00390b" }}>
          <img src="/community-v3.jpg" alt="" aria-hidden className="pointer-events-none absolute inset-y-0 right-0 h-full w-[58%] object-cover" style={{ objectPosition: "50% 26%", WebkitMaskImage: "linear-gradient(to right, transparent 0%, #000 45%)", maskImage: "linear-gradient(to right, transparent 0%, #000 45%)" }} />
          <div className="relative z-10 max-w-[56%] p-5">
            <div className="flex items-center gap-1.5"><PartyPopper className="h-4 w-4 text-yellow-300" /><span className="text-[11px] font-bold uppercase tracking-wide text-white/85">A comunidade OFF360 já economizou</span></div>
            <p className="mt-1 font-display text-4xl font-extrabold text-white">{money(data.community_saved || 0)}</p>
            <p className="mt-1 text-[11px] text-white/70">E essa conta só aumenta. Participe e faça parte!</p>
          </div>
        </div>

        {/* Minha economia + Bilhetes */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button onClick={() => navigate("/economy")} className="off-card p-3.5 text-left" data-testid="my-savings">
            <div className="flex items-center gap-2 text-off-orange"><TrendingUp className="h-4 w-4" /><span className="text-xs font-semibold">Minha economia</span></div>
            <p className="mt-1.5 font-display text-xl font-bold text-white">{money(data.total_saved || 0)}</p>
          </button>
          <button onClick={() => navigate("/raffles")} className="off-card p-3.5 text-left">
            <div className="flex items-center gap-2 text-off-orange"><Ticket className="h-4 w-4" /><span className="text-xs font-semibold">Bilhetes</span></div>
            <p className="mt-1.5 font-display text-xl font-bold text-white">{data.ticket_count}</p>
          </button>
        </div>

        {/* Ofertas de hoje */}
        {secHoje.length > 0 && <>
          <SectionHeader title="⚡ Ofertas de hoje" onSee={() => navigate("/explore?category=")} />
          <Carousel>{secHoje.map((e) => <EstCard key={"h" + e.id} e={e} badge="⚡ HOJE" onClick={() => navigate(`/establishment/${e.id}`)} />)}</Carousel>
        </>}

        {/* Mais bem avaliados */}
        {secTop.length > 0 && <>
          <SectionHeader title="⭐ Mais bem avaliados" onSee={() => navigate("/explore")} />
          <Carousel>{secTop.map((e) => <EstCard key={"t" + e.id} e={e} badge={e.rating_count > 0 ? `⭐ ${String(e.rating_avg).replace(".", ",")}` : null} onClick={() => navigate(`/establishment/${e.id}`)} />)}</Carousel>
        </>}

        {/* Novidades */}
        {secNov.length > 0 && <>
          <SectionHeader title="🎁 Novidades no OFF360" onSee={() => navigate("/explore")} />
          <Carousel>{secNov.map((e) => <EstCard key={"n" + e.id} e={e} badge="🆕 NOVO" onClick={() => navigate(`/establishment/${e.id}`)} />)}</Carousel>
        </>}

        {/* Categorias */}
        <SectionHeader title="Explore por categoria" />
        <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar">
          {data.categories.map((c) => {
            const Icon = Icons[c.icon] || Icons.Store;
            return (
              <button key={c.id} data-testid={`cat-${c.id}`} onClick={() => navigate(`/explore?category=${c.id}`)} className="flex w-20 shrink-0 flex-col items-center gap-2">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-off-blue/40 bg-off-surface"><Icon className="h-6 w-6 text-off-orange" /></div>
                <span className="text-center text-[10px] text-gray-400">{c.name}</span>
              </button>
            );
          })}
        </div>
      </>}

      {story && <StoryViewer group={story} onClose={() => setStory(null)} />}
    </div>
  );
}

function SectionHeader({ title, onSee }) {
  return (
    <div className="mb-2.5 mt-5 flex items-center justify-between">
      <h2 className="font-display text-lg font-bold text-white">{title}</h2>
      {onSee && <button onClick={onSee} className="flex items-center gap-0.5 text-xs font-semibold text-off-orange">Ver tudo <ChevronRight className="h-3 w-3" /></button>}
    </div>
  );
}

function Carousel({ children }) {
  return <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar">{children}</div>;
}

export function EstCard({ e, badge, onClick }) {
  const [fav, setFav] = useState(!!e.is_favorite);
  const dist = fmtDistance(e.distance_km);
  const toggleFav = async (ev) => {
    ev.stopPropagation();
    try { const { data } = await api.post(`/consumer/favorites/${e.id}`); setFav(data.is_favorite); } catch (_) {}
  };
  const badgeCls = !badge ? "" : badge.includes("EM ALTA") || badge.includes("HOJE") ? "bg-off-orange text-white"
    : badge.includes("MAIS VISTO") ? "bg-purple-600 text-white"
    : badge.includes("NOVO") ? "bg-off-success text-white"
    : "bg-black/60 text-white";
  return (
    <button data-testid={`est-card-${e.id}`} onClick={onClick} className="flex w-36 shrink-0 flex-col text-left transition-transform active:scale-[0.98]">
      <div className="relative h-24 w-36 overflow-hidden rounded-2xl off-gradient">
        {e.logo_url ? <img alt="" src={fileUrl(e.logo_url)} className="h-full w-full object-cover" /> :
          <div className="flex h-full w-full items-center justify-center font-display text-3xl font-bold text-white">{e.fantasy_name[0]}</div>}
        {badge && <span data-testid={`badge-${e.id}`} className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[9px] font-bold shadow ${badgeCls}`}>{badge}</span>}
        <span data-testid={`fav-${e.id}`} onClick={toggleFav} role="button" aria-label="favoritar" className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 backdrop-blur">
          <Heart className={`h-4 w-4 ${fav ? "fill-off-orange text-off-orange" : "text-white"}`} />
        </span>
      </div>
      <p className="mt-1.5 truncate text-[13px] font-semibold text-white">{e.fantasy_name}</p>
      <p className="truncate text-[11px] text-gray-400">{[e.category_name, dist].filter(Boolean).join(" · ")}</p>
      <span className="text-[13px] font-bold text-off-orange">{e.discount_percent}% OFF</span>
    </button>
  );
}

export function EstRow({ e, onClick, badges = [] }) {
  const [fav, setFav] = useState(!!e.is_favorite);
  const [favCount, setFavCount] = useState(e.fav_count || 0);
  const dist = fmtDistance(e.distance_km);
  const toggleFav = async (ev) => {
    ev.stopPropagation();
    try { const { data } = await api.post(`/consumer/favorites/${e.id}`); setFav(data.is_favorite); setFavCount(data.fav_count); } catch (_) {}
  };
  return (
    <button data-testid={`est-row-${e.id}`} onClick={onClick} className="flex w-full items-center gap-3 off-card p-3 text-left transition-transform active:scale-[0.99]">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl off-gradient">
        {e.logo_url ? <img alt="" src={fileUrl(e.logo_url)} className="h-full w-full object-cover" /> :
          <div className="flex h-full w-full items-center justify-center font-display text-lg font-bold text-white">{e.fantasy_name[0]}</div>}
      </div>
      <div className="min-w-0 flex-1">
        {badges.length > 0 && <div className="mb-0.5 flex flex-wrap gap-1">{badges.map((bd) => <span key={bd} data-testid={`badge-${e.id}`} className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${bd.includes("EM ALTA") ? "bg-off-orange/20 text-off-orange" : bd.includes("MAIS VISTO") ? "bg-off-blue/40 text-white" : "bg-off-success/20 text-off-success"}`}>{bd}</span>)}</div>}
        <p className="truncate font-semibold text-white">{e.fantasy_name}</p>
        <p className="truncate text-xs text-gray-400">{e.category_name} · {e.neighborhood}</p>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-300">
          <span className="flex items-center gap-0.5"><Heart className="h-3 w-3 text-off-orange" /> {favCount}</span>
          {e.rating_count > 0
            ? <span className="flex items-center gap-0.5"><Star className="h-3 w-3 fill-off-orange text-off-orange" /> {String(e.rating_avg).replace(".", ",")} <span className="text-gray-500">({e.rating_count})</span></span>
            : <span className="text-gray-500">Sem avaliações</span>}
          {dist && <span className="flex items-center gap-0.5 text-off-orange"><MapPin className="h-3 w-3" /> {dist}</span>}
        </div>
      </div>
      <span className="rounded-full bg-off-orange/20 px-2.5 py-1 text-xs font-bold text-off-orange">-{e.discount_percent}%</span>
      <span data-testid={`fav-${e.id}`} onClick={toggleFav} className="ml-1 p-1" role="button" aria-label="favoritar">
        <Heart className={`h-5 w-5 ${fav ? "fill-off-orange text-off-orange" : "text-gray-400"}`} />
      </span>
    </button>
  );
}
