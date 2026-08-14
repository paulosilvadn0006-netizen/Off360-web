import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import ActionButtons from "@/components/ActionButtons";
import { MapPin, Clock, Instagram, MessageCircle, Navigation, ScanLine, ChevronLeft, Percent, Heart, Star, Store } from "lucide-react";

export default function EstablishmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: e, isLoading, isError } = useQuery({ queryKey: ["est", id], retry: false, queryFn: async () => (await api.get(`/consumer/establishments/${id}`)).data });

  const [fav, setFav] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [myRating, setMyRating] = useState(0);
  const [ratingAvg, setRatingAvg] = useState(null);
  const [ratingCount, setRatingCount] = useState(0);
  useEffect(() => {
    if (!e) return;
    setFav(!!e.is_favorite); setFavCount(e.fav_count || 0);
    setMyRating(e.my_rating || 0); setRatingAvg(e.rating_avg); setRatingCount(e.rating_count || 0);
  }, [e]);

  if (isLoading) return <div className="px-4 pt-8"><Loading /></div>;
  if (isError || !e) return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center" data-testid="est-not-found">
      <Store className="h-12 w-12 text-gray-600" />
      <p className="mt-3 font-semibold text-white">Estabelecimento não encontrado</p>
      <p className="mt-1 text-sm text-gray-400">Ele pode ter saído do ar ou o link está incorreto.</p>
      <Button onClick={() => navigate("/home")} className="mt-4 rounded-xl off-gradient font-semibold text-white">Voltar para a Home</Button>
    </div>
  );
  const maps = e.lat && e.lng ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((e.address || "") + " " + (e.city || ""))}`;
  const wa = e.whatsapp ? `https://wa.me/${e.whatsapp.replace(/\D/g, "")}` : null;

  const toggleFav = async () => {
    try {
      const { data } = await api.post(`/consumer/favorites/${id}`);
      setFav(data.is_favorite); setFavCount(data.fav_count);
      qc.invalidateQueries({ queryKey: ["home"] }); qc.invalidateQueries({ queryKey: ["discover"] }); qc.invalidateQueries({ queryKey: ["c-favorites"] });
    } catch (err) { toast.error(formatApiError(err)); }
  };
  const rate = async (stars) => {
    try {
      const { data } = await api.post(`/consumer/establishments/${id}/rate`, { stars });
      setMyRating(data.my_rating); setRatingAvg(data.rating_avg); setRatingCount(data.rating_count);
      qc.invalidateQueries({ queryKey: ["home"] }); qc.invalidateQueries({ queryKey: ["discover"] });
      toast.success("Avaliação registrada!");
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="pb-6 animate-fade-up">
      <div className="relative h-40 w-full overflow-hidden off-gradient sm:h-52">
        {e.cover_url && <img alt="" src={fileUrl(e.cover_url)} className="h-full w-full object-cover" />}
        <button onClick={() => navigate(-1)} data-testid="est-back" className="absolute left-4 top-6 z-10 rounded-full bg-black/50 p-2 text-white backdrop-blur"><ChevronLeft className="h-5 w-5" /></button>
      </div>
      <div className="px-4 pt-4">
        <div className="flex items-center gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-off-blue/40 off-gradient">
            {e.logo_url ? <img alt="" src={fileUrl(e.logo_url)} className="h-full w-full object-cover" /> :
              <div className="flex h-full w-full items-center justify-center font-display text-2xl font-bold text-white">{e.fantasy_name[0]}</div>}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-bold text-white">{e.fantasy_name}</h1>
            <p className="text-sm text-gray-200">{e.category_name}</p>
          </div>
          <button data-testid="est-fav-btn" onClick={toggleFav} className="rounded-full border border-off-blue/40 bg-off-surface p-2.5">
            <Heart className={`h-6 w-6 ${fav ? "fill-off-orange text-off-orange" : "text-gray-300"}`} />
          </button>
        </div>

        {/* Prova social */}
        <div className="mt-3 flex items-center gap-4 text-sm" data-testid="est-social-proof">
          <span className="flex items-center gap-1 text-gray-200"><Heart className="h-4 w-4 text-off-orange" /> <b className="text-white">{favCount}</b> curtidas</span>
          {ratingCount > 0
            ? <span className="flex items-center gap-1 text-gray-200"><Star className="h-4 w-4 fill-off-orange text-off-orange" /> <b className="text-white">{String(ratingAvg).replace(".", ",")}</b> ({ratingCount} {ratingCount === 1 ? "avaliação" : "avaliações"})</span>
            : <span className="text-gray-400">Sem avaliações</span>}
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-off-orange/30 bg-off-orange/10 p-4">
          <Percent className="h-8 w-8 text-off-orange" />
          <div>
            <p className="font-display text-2xl font-bold text-off-orange">{e.discount_percent}% OFF</p>
            {e.discount_rules && <p className="text-xs text-gray-200">{e.discount_rules}</p>}
          </div>
        </div>

        {/* Avaliar */}
        <div className="mt-4 rounded-2xl border border-off-blue/40 bg-off-surface p-4" data-testid="est-rating-widget">
          <p className="text-sm font-semibold text-white">{myRating ? "Sua avaliação" : "Avalie sua experiência"}</p>
          <div className="mt-2 flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} data-testid={`rate-star-${n}`} onClick={() => rate(n)} className="p-0.5">
                <Star className={`h-8 w-8 ${n <= myRating ? "fill-off-orange text-off-orange" : "text-gray-500"}`} />
              </button>
            ))}
          </div>
          {myRating ? <p className="mt-1 text-[11px] text-gray-400">Toque em outra estrela para alterar sua nota.</p> : null}
        </div>

        {e.description && <p className="mt-4 text-sm text-gray-100">{e.description}</p>}

        <div className="mt-4 space-y-2 text-sm text-gray-100">
          {e.address && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-off-orange" /> {e.address}</p>}
          {e.hours && <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-off-orange" /> {e.hours}</p>}
          {e.instagram && <p className="flex items-center gap-2"><Instagram className="h-4 w-4 text-off-orange" /> {e.instagram}</p>}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <a href={maps} target="_blank" rel="noreferrer" data-testid="est-directions" className="flex items-center justify-center gap-2 rounded-xl border border-off-blue/40 bg-off-surface py-3 text-sm font-semibold text-white"><Navigation className="h-4 w-4 text-off-orange" /> Como chegar</a>
          {wa && <a href={wa} target="_blank" rel="noreferrer" data-testid="est-whatsapp" className="flex items-center justify-center gap-2 rounded-xl bg-off-success py-3 text-sm font-semibold text-white"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
        </div>

        <DeliveryPanel e={e} />

        {e.action_buttons?.length ? (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold text-white">Formas de atendimento</p>
            <ActionButtons establishment={e} />
          </div>
        ) : null}

        <Button data-testid="est-use-discount" onClick={() => navigate("/scan")} className="mt-3 h-12 w-full rounded-xl off-gradient font-semibold text-white">
          <ScanLine className="mr-2 h-5 w-5" /> Usar desconto
        </Button>
      </div>
    </div>
  );
}


function DeliveryPanel({ e }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null);
  const [pay, setPay] = useState("");
  const [needsChange, setNeedsChange] = useState(false);
  const [changeFor, setChangeFor] = useState("");
  const [busy, setBusy] = useState(false);
  const offersAny = e.offers_delivery || e.offers_pickup;
  const pays = [["pix", "PIX", e.pay_pix], ["card", "Cartão", e.pay_card], ["cash", "Dinheiro", e.pay_cash]].filter((p) => p[2]);

  const whatsapp = async () => {
    try {
      const { data } = await api.post("/consumer/whatsapp-order", { establishment_id: e.id });
      if (data.wa_link) window.open(data.wa_link, "_blank");
      else toast.error("Este estabelecimento não cadastrou WhatsApp.");
    } catch (err) { toast.error(formatApiError(err)); }
  };
  const createOrder = async () => {
    if (!mode) { toast.error("Escolha Entrega ou Retirada"); return; }
    setBusy(true);
    try {
      const body = {
        establishment_id: e.id, mode, payment_method: pay || null,
        needs_change: pay === "cash" ? needsChange : false,
        change_for: pay === "cash" && needsChange ? parseFloat(String(changeFor).replace(",", ".")) : null,
      };
      const { data } = await api.post("/consumer/orders", body);
      toast.success("Pedido OFF360 criado! Acompanhe o status.");
      navigate(`/order/${data.id}`);
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="mt-5 mb-24 rounded-2xl border border-off-blue/40 bg-off-surface p-4" data-testid="delivery-panel">
      <Button data-testid="wa-order-btn" onClick={whatsapp} className="h-12 w-full rounded-xl bg-off-success font-semibold text-white">
        <MessageCircle className="mr-2 h-5 w-5" /> Pedir pelo WhatsApp
      </Button>
      {offersAny && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-white">Fazer pedido OFF360</p>
          {(e.delivery_areas || e.delivery_eta || e.delivery_fee_text) && (
            <p className="mt-1 text-[11px] text-gray-400">
              {e.delivery_areas ? `Atende: ${e.delivery_areas}. ` : ""}{e.delivery_fee_text ? `Taxa: ${e.delivery_fee_text}. ` : ""}{e.delivery_eta ? `Tempo: ${e.delivery_eta}.` : ""}
            </p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {e.offers_delivery && <button type="button" data-testid="order-mode-delivery" onClick={() => setMode("delivery")} className={`rounded-xl py-2.5 text-sm font-semibold ${mode === "delivery" ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>Entrega</button>}
            {e.offers_pickup && <button type="button" data-testid="order-mode-pickup" onClick={() => setMode("pickup")} className={`rounded-xl py-2.5 text-sm font-semibold ${mode === "pickup" ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>Retirada</button>}
          </div>
          {pays.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-400">Forma de pagamento (na entrega/retirada):</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {pays.map(([k, label]) => (
                  <button key={k} type="button" data-testid={`order-pay-${k}`} onClick={() => setPay(k)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${pay === k ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>{label}</button>
                ))}
              </div>
            </div>
          )}
          {pay === "cash" && (
            <div className="mt-2">
              <label className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" data-testid="order-needs-change" checked={needsChange} onChange={(ev) => setNeedsChange(ev.target.checked)} /> Precisa de troco?</label>
              {needsChange && <input data-testid="order-change-for" value={changeFor} onChange={(ev) => setChangeFor(ev.target.value)} inputMode="decimal" placeholder="Troco para R$ ___" className="off-input mt-2" />}
            </div>
          )}
          <Button data-testid="order-create-btn" onClick={createOrder} disabled={busy} className="mt-3 h-12 w-full rounded-xl off-gradient font-semibold text-white">
            {busy ? "Enviando..." : "Fazer pedido OFF360"}
          </Button>
          <p className="mt-2 text-[11px] text-gray-500">O pagamento será realizado diretamente ao estabelecimento na entrega ou retirada. Em breve, você também poderá pagar seus pedidos pelo OFF360.</p>
        </div>
      )}
    </div>
  );
}
