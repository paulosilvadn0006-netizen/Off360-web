import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { api, fileUrl } from "@/lib/api";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, Instagram, MessageCircle, Navigation, ScanLine, ChevronLeft, Percent } from "lucide-react";

export default function EstablishmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: e, isLoading } = useQuery({ queryKey: ["est", id], queryFn: async () => (await api.get(`/consumer/establishments/${id}`)).data });

  if (isLoading || !e) return <div className="px-4 pt-8"><Loading /></div>;
  const maps = e.lat && e.lng ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((e.address || "") + " " + (e.city || ""))}`;
  const wa = e.whatsapp ? `https://wa.me/${e.whatsapp.replace(/\D/g, "")}` : null;

  return (
    <div className="pb-6 animate-fade-up">
      <div className="relative h-52 off-gradient">
        {e.cover_url && <img alt="" src={fileUrl(e.cover_url)} className="h-full w-full object-cover" />}
        <button onClick={() => navigate(-1)} className="absolute left-4 top-6 rounded-full bg-black/40 p-2 text-white backdrop-blur"><ChevronLeft className="h-5 w-5" /></button>
      </div>
      <div className="px-4">
        <div className="-mt-10 flex items-end gap-3">
          <div className="h-20 w-20 overflow-hidden rounded-2xl border-4 border-off-bg off-gradient">
            {e.logo_url ? <img alt="" src={fileUrl(e.logo_url)} className="h-full w-full object-cover" /> :
              <div className="flex h-full w-full items-center justify-center font-display text-2xl font-bold text-white">{e.fantasy_name[0]}</div>}
          </div>
          <div className="pb-1">
            <h1 className="font-display text-xl font-bold text-white">{e.fantasy_name}</h1>
            <p className="text-sm text-gray-400">{e.category_name}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-off-orange/30 bg-off-orange/10 p-4">
          <Percent className="h-8 w-8 text-off-orange" />
          <div>
            <p className="font-display text-2xl font-bold text-off-orange">{e.discount_percent}% OFF</p>
            {e.discount_rules && <p className="text-xs text-gray-400">{e.discount_rules}</p>}
          </div>
        </div>

        {e.description && <p className="mt-4 text-sm text-gray-300">{e.description}</p>}

        <div className="mt-4 space-y-2 text-sm text-gray-300">
          {e.address && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-off-orange" /> {e.address}</p>}
          {e.hours && <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-off-orange" /> {e.hours}</p>}
          {e.instagram && <p className="flex items-center gap-2"><Instagram className="h-4 w-4 text-off-orange" /> {e.instagram}</p>}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <a href={maps} target="_blank" rel="noreferrer" data-testid="est-directions" className="flex items-center justify-center gap-2 rounded-xl border border-off-blue/40 bg-off-surface py-3 text-sm font-semibold text-white"><Navigation className="h-4 w-4 text-off-orange" /> Como chegar</a>
          {wa && <a href={wa} target="_blank" rel="noreferrer" data-testid="est-whatsapp" className="flex items-center justify-center gap-2 rounded-xl bg-off-success py-3 text-sm font-semibold text-white"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
        </div>

        <Button data-testid="est-use-discount" onClick={() => navigate("/scan")} className="mt-3 h-12 w-full rounded-xl off-gradient font-semibold text-white">
          <ScanLine className="mr-2 h-5 w-5" /> Usar desconto
        </Button>
      </div>
    </div>
  );
}
