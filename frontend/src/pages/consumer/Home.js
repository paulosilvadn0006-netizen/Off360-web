import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, money } from "@/components/shared";
import StoryViewer from "@/components/StoryViewer";
import * as Icons from "lucide-react";
import { Bell, Search, MapPin, ScanLine, CheckCircle2, AlertTriangle, Ticket, TrendingUp, ChevronRight, Star } from "lucide-react";

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [story, setStory] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["home"], queryFn: async () => (await api.get("/consumer/home")).data });
  const { data: notif } = useQuery({ queryKey: ["notif-count"], queryFn: async () => (await api.get("/notifications")).data });

  if (isLoading || !data) return <div className="px-4 pt-8"><Loading /></div>;
  const active = data.subscription.status === "active";

  return (
    <div className="px-4 pt-6 animate-fade-up">
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

      {data.stories.length > 0 && (
        <div className="mt-5 flex gap-4 overflow-x-auto pb-2 no-scrollbar" data-testid="home-stories">
          {data.stories.map((g) => (
            <button key={g.establishment.id} data-testid={g.sponsored ? "story-bubble-sponsored" : "story-bubble"} onClick={() => setStory(g)} className="flex w-16 shrink-0 flex-col items-center gap-1">
              <div className={`rounded-full p-[2px] ${g.sponsored ? "off-gradient animate-pulse motion-reduce:animate-none ring-2 ring-off-orange/60" : "off-gradient"}`}>
                <div className="h-14 w-14 overflow-hidden rounded-full border-2 border-off-bg bg-off-surface">
                  {g.establishment.logo_url ? <img alt="" src={fileUrl(g.establishment.logo_url)} className="h-full w-full object-cover" /> :
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-off-orange">{g.establishment.fantasy_name[0]}</div>}
                </div>
              </div>
              {g.sponsored
                ? <span className="flex items-center gap-0.5 text-[9px] font-bold text-off-orange"><Star className="h-2.5 w-2.5 fill-off-orange" /> PATROCINADO</span>
                : <span className="w-16 truncate text-center text-[10px] text-gray-300">{g.establishment.fantasy_name}</span>}
            </button>
          ))}
        </div>
      )}

      <div data-testid="subscription-card" className={`mt-5 rounded-3xl border p-5 ${active ? "border-off-success/30 bg-off-success/10" : "border-off-warning/40 bg-off-warning/10"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {active ? <CheckCircle2 className="h-6 w-6 text-off-success" /> : <AlertTriangle className="h-6 w-6 text-off-warning" />}
            <div>
              <p className={`font-display font-bold ${active ? "text-off-success" : "text-off-warning"}`}>{active ? "Assinatura ativa" : "Assinatura pendente"}</p>
              <p className="text-xs text-gray-300">{active ? `Próximo vencimento: ${data.subscription.next_due ? new Date(data.subscription.next_due).toLocaleDateString("pt-BR") : "-"}` : "Regularize para usar os descontos"}</p>
            </div>
          </div>
          {!active && <button onClick={() => navigate("/profile")} data-testid="fix-subscription" className="rounded-full off-gradient px-4 py-2 text-xs font-semibold text-white">Regularizar</button>}
        </div>
      </div>

      {active ? (
        <button data-testid="home-scan-btn" onClick={() => navigate("/scan")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl off-gradient py-4 font-display text-base font-bold text-white shadow-[0_10px_30px_rgba(255,75,18,0.35)] transition-transform active:scale-[0.98]">
          <ScanLine className="h-5 w-5" /> Escanear QR Code
        </button>
      ) : (
        <button data-testid="home-scan-btn-disabled" onClick={() => navigate("/profile")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-off-blue/40 bg-off-surface py-4 font-display text-base font-bold text-gray-500">
          <ScanLine className="h-5 w-5" /> Regularizar assinatura
        </button>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="off-card p-4">
          <div className="flex items-center gap-2 text-off-orange"><TrendingUp className="h-4 w-4" /><span className="text-xs font-semibold">Economia do mês</span></div>
          <p className="mt-2 font-display text-2xl font-bold text-white">{money(data.month_saved)}</p>
        </div>
        <button onClick={() => navigate("/raffles")} className="off-card p-4 text-left">
          <div className="flex items-center gap-2 text-off-orange"><Ticket className="h-4 w-4" /><span className="text-xs font-semibold">Bilhetes</span></div>
          <p className="mt-2 font-display text-2xl font-bold text-white">{data.ticket_count}</p>
        </button>
      </div>

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

      <SectionHeader title="Ofertas próximas" onSee={() => navigate("/explore?sort=discount")} />
      <div className="space-y-3">
        {data.featured.slice(0, 3).map((e) => <EstRow key={e.id} e={e} onClick={() => navigate(`/establishment/${e.id}`)} />)}
      </div>

      <SectionHeader title="Novos parceiros" />
      <div className="flex gap-3 overflow-x-auto pb-6 no-scrollbar">
        {data.new_partners.map((e) => (
          <button key={e.id} onClick={() => navigate(`/establishment/${e.id}`)} className="w-40 shrink-0 overflow-hidden off-card text-left">
            <div className="h-24 off-gradient opacity-90">{e.cover_url && <img alt="" src={fileUrl(e.cover_url)} className="h-full w-full object-cover" />}</div>
            <div className="p-3">
              <p className="truncate font-semibold text-white">{e.fantasy_name}</p>
              <p className="text-xs text-gray-400">{e.category_name}</p>
              <span className="mt-1 inline-block rounded-full bg-off-orange/20 px-2 py-0.5 text-[10px] font-bold text-off-orange">-{e.discount_percent}%</span>
            </div>
          </button>
        ))}
      </div>

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

export function EstRow({ e, onClick }) {
  return (
    <button data-testid={`est-row-${e.id}`} onClick={onClick} className="flex w-full items-center gap-3 off-card p-3 text-left transition-transform active:scale-[0.99]">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl off-gradient">
        {e.logo_url ? <img alt="" src={fileUrl(e.logo_url)} className="h-full w-full object-cover" /> :
          <div className="flex h-full w-full items-center justify-center font-display text-lg font-bold text-white">{e.fantasy_name[0]}</div>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{e.fantasy_name}</p>
        <p className="truncate text-xs text-gray-400">{e.category_name} · {e.neighborhood}</p>
      </div>
      <span className="rounded-full bg-off-orange/20 px-2.5 py-1 text-xs font-bold text-off-orange">-{e.discount_percent}%</span>
    </button>
  );
}
