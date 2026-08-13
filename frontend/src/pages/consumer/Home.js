import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, money, fmtDistance } from "@/components/shared";
import StoryViewer from "@/components/StoryViewer";
import * as Icons from "lucide-react";
import { Bell, Search, MapPin, ScanLine, CheckCircle2, AlertTriangle, Ticket, TrendingUp, ChevronRight, Star, Heart } from "lucide-react";

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

  return (
    <div className="px-4 pt-6 animate-fade-up">
      <div className="mb-4 flex items-center" data-testid="home-logo">
        <span className="font-display text-2xl font-extrabold tracking-tight text-white">OFF<span className="text-off-orange">360</span></span>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 overflow-hidden rounded-full border-2 border-off-orange bg-off-surface">
            {user?.photo_url ? <img alt="" src={fileUrl(user.photo_url)} className="h-full w-full object-cover" /> :
              <div className="flex h-full w-full items-center justify-center font-display text-lg font-bold text-off-orange">{(data.greeting_name || "?")[0]}</div>}
          </div>
          <div>
            <p className="text-sm text-gray-400">Olá,</p>
            <p className="font-display text-lg font-bold leading-none text-white">{data.greeting_name}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-gray-500"><MapPin className="h-3 w-3" /> {data.neighborhood}</p>
          </div>
        </div>
        <button data-testid="home-notifications" onClick={() => navigate("/notifications")} className="relative rounded-full bg-off-surface p-2.5">
          <Bell className="h-5 w-5 text-white" />
          {notif?.unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full off-gradient text-[9px] font-bold text-white">{notif.unread}</span>}
        </button>
      </div>

      <button data-testid="home-search" onClick={() => navigate("/explore")} className="mt-5 flex w-full items-center gap-2 rounded-2xl border border-off-blue/40 bg-off-surface px-4 py-3 text-left text-sm text-gray-500">
        <Search className="h-4 w-4" /> Buscar lojas, serviços ou produtos...
      </button>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 no-scrollbar" data-testid="home-filters">
        {FILTERS.map(([f, label]) => (
          <button key={f} data-testid={`filter-${f}`} onClick={() => selectFilter(f)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${filter === f ? "off-gradient text-white" : "border border-off-blue/40 bg-off-surface text-gray-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {filter && (
        <div className="mt-4" data-testid="discover-results">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-white">{FILTERS.find(([f]) => f === filter)?.[1]}</h2>
            <button onClick={() => setFilter(null)} className="text-xs font-semibold text-off-orange">Limpar</button>
          </div>
          {filter === "perto" && !geo && <p className="mb-2 text-xs text-gray-400">Autorize a localização para ver por proximidade real. Mostrando por bairro/cidade.</p>}
          {!discover ? <Loading /> : (discover.items.length ? (
            <div className="space-y-3 pb-4">
              {discover.items.map((e) => (
                <EstRow key={e.id} e={e} onClick={() => navigate(`/establishment/${e.id}`)} />
              ))}
            </div>
          ) : <p className="py-8 text-center text-sm text-gray-500">Nada encontrado neste filtro por enquanto.</p>)}
        </div>
      )}

      {!filter && data.stories.length > 0 && (
        <div className="mt-5 flex gap-4 overflow-x-auto pb-2 no-scrollbar" data-testid="home-stories">
          {data.stories.map((g) => (
            <button key={g.establishment.id} data-testid={g.sponsored ? "story-bubble-sponsored" : "story-bubble"} onClick={() => setStory(g)} className="flex w-16 shrink-0 flex-col items-center gap-1">
              <div className={`rounded-full p-[2px] ${g.sponsored ? "off-gradient animate-story-pulse ring-2 ring-off-orange" : "off-gradient"}`}>
                <div className="h-14 w-14 overflow-hidden rounded-full border-2 border-off-bg bg-off-surface">
                  {g.establishment.logo_url ? <img alt="" src={fileUrl(g.establishment.logo_url)} className="h-full w-full object-cover" /> :
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-off-orange">{g.establishment.fantasy_name[0]}</div>}
                </div>
              </div>
              {g.happening === "now" && <span className="mt-0.5 rounded-full bg-off-orange px-1.5 py-0.5 text-[8px] font-bold text-white">⚡ AGORA</span>}
              {g.happening === "soon" && <span className="mt-0.5 rounded-full bg-off-warning/30 px-1.5 py-0.5 text-[8px] font-bold text-off-warning">⏰ EM BREVE</span>}
              {g.sponsored
                ? <span className="flex items-center gap-0.5 text-[9px] font-bold text-off-orange"><Star className="h-2.5 w-2.5 fill-off-orange" /> PATROCINADO</span>
                : <span className="w-16 truncate text-center text-[10px] text-gray-300">{g.establishment.fantasy_name}</span>}
            </button>
          ))}
        </div>
      )}

      <div data-testid="community-savings" className="mt-5 rounded-3xl border border-off-blue/40 bg-off-surface p-5">
        <div className="flex items-center gap-2 text-off-orange"><Icons.PiggyBank className="h-5 w-5" /><span className="text-sm font-semibold">A comunidade OFF360 já economizou</span></div>
        <p className="mt-1 font-display text-3xl font-extrabold text-off-success">{money(data.community_saved || 0)}</p>
        <p className="mt-1 text-xs text-gray-400">E essa conta só aumenta. Participe e faça parte!</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="off-card p-4" data-testid="my-savings">
          <div className="flex items-center gap-2 text-off-orange"><TrendingUp className="h-4 w-4" /><span className="text-xs font-semibold">Minha economia</span></div>
          <p className="mt-2 font-display text-2xl font-bold text-white">{money(data.total_saved || 0)}</p>
        </div>
        <button onClick={() => navigate("/raffles")} className="off-card p-4 text-left">
          <div className="flex items-center gap-2 text-off-orange"><Ticket className="h-4 w-4" /><span className="text-xs font-semibold">Bilhetes</span></div>
          <p className="mt-2 font-display text-2xl font-bold text-white">{data.ticket_count}</p>
        </button>
      </div>

      {!filter && <>
      <SectionHeader title="Categorias" />
      <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
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

      {data.sections?.bombando?.length > 0 && <>
        <SectionHeader title="🔥 Bombando perto de você" />
        <p className="-mt-2 mb-3 text-xs text-gray-400">O que está chamando atenção na sua região agora.</p>
        <div className="space-y-3">{data.sections.bombando.map((e) => <EstRow key={"b" + e.id} e={e} badges={estBadges(e, data.badges)} onClick={() => navigate(`/establishment/${e.id}`)} />)}</div>
      </>}

      {data.sections?.hoje?.length > 0 && <>
        <SectionHeader title="⚡ Ofertas de hoje" />
        <div className="space-y-3">{data.sections.hoje.map((e) => <EstRow key={"h" + e.id} e={e} badges={estBadges(e, data.badges)} onClick={() => navigate(`/establishment/${e.id}`)} />)}</div>
      </>}

      {data.sections?.top_rated?.length > 0 && <>
        <SectionHeader title="⭐ Mais bem avaliados" />
        <div className="space-y-3">{data.sections.top_rated.map((e) => <EstRow key={"t" + e.id} e={e} badges={estBadges(e, data.badges)} onClick={() => navigate(`/establishment/${e.id}`)} />)}</div>
      </>}

      {data.sections?.novidades?.length > 0 && <>
        <SectionHeader title="🎁 Novidades no OFF360" />
        <div className="space-y-3 pb-4">{data.sections.novidades.map((e) => <EstRow key={"n" + e.id} e={e} badges={estBadges(e, data.badges)} onClick={() => navigate(`/establishment/${e.id}`)} />)}</div>
      </>}
      </>}

      {story && <StoryViewer group={story} onClose={() => setStory(null)} />}
    </div>
  );
}

function SectionHeader({ title, onSee }) {
  return (
    <div className="mb-3 mt-6 flex items-center justify-between">
      <h2 className="font-display text-lg font-bold text-white">{title}</h2>
      {onSee && <button onClick={onSee} className="flex items-center gap-0.5 text-xs font-semibold text-off-orange">Ver todos <ChevronRight className="h-3 w-3" /></button>}
    </div>
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
