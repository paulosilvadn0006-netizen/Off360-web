import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [cart, setCart] = useState({});
  const [addr, setAddr] = useState({ delivery_street: "", delivery_number: "", delivery_neighborhood: "", delivery_city: "", delivery_complement: "" });
  const [saveAddr, setSaveAddr] = useState(true);
  const offersAny = e.offers_delivery || e.offers_pickup;
  const pays = [["pix", "PIX", e.pay_pix], ["card", "Cartão", e.pay_card], ["cash", "Dinheiro", e.pay_cash]].filter((p) => p[2]);
  const catalog = e.catalog || [];
  const money = (v) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
  const fpPct = e.first_purchase_available ? Number(e.first_purchase_percent || 0) : 0;
  const setQty = (id, d) => setCart((c) => { const q = Math.max(0, (c[id] || 0) + d); const n = { ...c }; if (q) n[id] = q; else delete n[id]; return n; });
  const lines = catalog.filter((it) => cart[it.id]).map((it) => { const applied = Math.max(Number(it.discount_percent || 0), fpPct); const unit = it.price * (1 - applied / 100); return { it, qty: cart[it.id], applied, unit, total: unit * cart[it.id] }; });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const fee = mode === "delivery" ? Number(e.delivery_fee || 0) : 0;
  const total = subtotal + fee;

  const whatsapp = async () => {
    try { const { data } = await api.post("/consumer/whatsapp-order", { establishment_id: e.id }); if (data.wa_link) window.open(data.wa_link, "_blank"); else toast.error("Este estabelecimento não cadastrou WhatsApp."); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const createOrder = async () => {
    if (!mode) { toast.error("Escolha Entrega ou Retirada"); return; }
    if (mode === "delivery" && !addr.delivery_street.trim()) { toast.error("Informe o endereço de entrega"); return; }
    setBusy(true);
    try {
      const body = {
        establishment_id: e.id, mode, payment_method: pay || null,
        needs_change: pay === "cash" ? needsChange : false,
        change_for: pay === "cash" && needsChange ? parseFloat(String(changeFor).replace(",", ".")) : null,
        items: Object.entries(cart).map(([item_id, qty]) => ({ item_id, qty })),
        ...(mode === "delivery" ? { ...addr, save_address: saveAddr } : {}),
      };
      const { data } = await api.post("/consumer/orders", body);
      toast.success("Pedido OFF360 criado! Acompanhe o status.");
      navigate(`/order/${data.id}`);
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="mt-5 mb-24 rounded-2xl border border-off-blue/40 bg-off-surface p-4" data-testid="delivery-panel">
      {catalog.length > 0 && (
        <div className="mb-4" data-testid="consumer-catalog">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Catálogo</p>
            {fpPct > 0 && <span className="rounded-full bg-off-orange/15 px-2 py-0.5 text-[10px] font-bold text-off-orange" data-testid="first-purchase-badge">1ª compra {fpPct}% OFF</span>}
          </div>
          <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
            {catalog.map((it) => {
              const applied = Math.max(Number(it.discount_percent || 0), fpPct);
              const finalp = it.price * (1 - applied / 100);
              return (
                <div key={it.id} className="w-40 shrink-0 rounded-xl border border-off-blue/30 bg-off-bg/50 p-2" data-testid={`catalog-card-${it.id}`}>
                  <div className="h-24 w-full overflow-hidden rounded-lg bg-off-surface">{it.photo_url ? <img alt="" src={fileUrl(it.photo_url)} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-gray-600"><Store className="h-6 w-6" /></div>}</div>
                  <p className="mt-1 truncate text-sm font-semibold text-white">{it.name}</p>
                  {it.description && <p className="truncate text-[10px] text-gray-400">{it.description}</p>}
                  <div className="mt-1">
                    {applied > 0 ? <p className="text-[11px] text-gray-500 line-through">{money(it.price)}</p> : null}
                    <p className="text-sm font-bold text-off-orange">{money(finalp)} {applied > 0 && <span className="text-[10px]">({applied}% OFF)</span>}</p>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <button data-testid={`catalog-minus-${it.id}`} onClick={() => setQty(it.id, -1)} className="h-7 w-7 rounded-lg border border-off-blue/40 text-white">−</button>
                    <span className="text-sm font-bold text-white" data-testid={`catalog-qty-${it.id}`}>{cart[it.id] || 0}</span>
                    <button data-testid={`catalog-plus-${it.id}`} onClick={() => setQty(it.id, 1)} className="h-7 w-7 rounded-lg off-gradient text-white">+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Button data-testid="wa-order-btn" onClick={whatsapp} className="h-12 w-full rounded-xl bg-off-success font-semibold text-white">
        <MessageCircle className="mr-2 h-5 w-5" /> Pedir pelo WhatsApp
      </Button>
      {offersAny && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-white">Fazer pedido OFF360</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {e.offers_delivery && <button type="button" data-testid="order-mode-delivery" onClick={() => setMode("delivery")} className={`rounded-xl py-2.5 text-sm font-semibold ${mode === "delivery" ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>Entrega</button>}
            {e.offers_pickup && <button type="button" data-testid="order-mode-pickup" onClick={() => setMode("pickup")} className={`rounded-xl py-2.5 text-sm font-semibold ${mode === "pickup" ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>Retirada</button>}
          </div>

          {mode === "delivery" && (
            <div className="mt-3 space-y-2" data-testid="consumer-address">
              <p className="text-xs font-semibold text-gray-300">Endereço de entrega</p>
              <div className="grid grid-cols-[1fr_80px] gap-2">
                <Input data-testid="addr-street" value={addr.delivery_street} onChange={(ev) => setAddr({ ...addr, delivery_street: ev.target.value })} placeholder="Rua" className="off-input" />
                <Input data-testid="addr-number" value={addr.delivery_number} onChange={(ev) => setAddr({ ...addr, delivery_number: ev.target.value })} placeholder="Nº" className="off-input" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input data-testid="addr-neighborhood" value={addr.delivery_neighborhood} onChange={(ev) => setAddr({ ...addr, delivery_neighborhood: ev.target.value })} placeholder="Bairro" className="off-input" />
                <Input data-testid="addr-city" value={addr.delivery_city} onChange={(ev) => setAddr({ ...addr, delivery_city: ev.target.value })} placeholder="Cidade" className="off-input" />
              </div>
              <Input data-testid="addr-complement" value={addr.delivery_complement} onChange={(ev) => setAddr({ ...addr, delivery_complement: ev.target.value })} placeholder="Complemento (opcional)" className="off-input" />
              <label className="flex items-center gap-2 text-[11px] text-gray-400"><input type="checkbox" data-testid="addr-save" checked={saveAddr} onChange={(ev) => setSaveAddr(ev.target.checked)} /> Salvar endereço na minha conta</label>
            </div>
          )}

          {pays.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-400">Forma de pagamento (na entrega/retirada):</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {pays.map(([k, label]) => (<button key={k} type="button" data-testid={`order-pay-${k}`} onClick={() => setPay(k)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${pay === k ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300"}`}>{label}</button>))}
              </div>
            </div>
          )}
          {pay === "cash" && (
            <div className="mt-2">
              <label className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" data-testid="order-needs-change" checked={needsChange} onChange={(ev) => setNeedsChange(ev.target.checked)} /> Precisa de troco?</label>
              {needsChange && <input data-testid="order-change-for" value={changeFor} onChange={(ev) => setChangeFor(ev.target.value)} inputMode="decimal" placeholder="Troco para R$ ___" className="off-input mt-2" />}
            </div>
          )}

          {lines.length > 0 && (
            <div className="mt-3 rounded-xl bg-off-bg/60 p-3 text-xs text-gray-300" data-testid="order-summary">
              <div className="flex justify-between"><span>Subtotal</span><span data-testid="sum-subtotal">{money(subtotal)}</span></div>
              {mode === "delivery" && <div className="flex justify-between"><span>Taxa de entrega</span><span data-testid="sum-fee">{money(fee)}</span></div>}
              <div className="mt-1 flex justify-between border-t border-off-blue/20 pt-1 text-sm font-bold text-white"><span>Total</span><span data-testid="sum-total">{money(total)}</span></div>
              {e.avg_prep_minutes ? <p className="mt-1 text-[11px] text-gray-500" data-testid="sum-eta">Tempo estimado de preparo: {e.avg_prep_minutes} min</p> : null}
            </div>
          )}

          <Button data-testid="order-create-btn" onClick={createOrder} disabled={busy} className="mt-3 h-12 w-full rounded-xl off-gradient font-semibold text-white">
            {busy ? "Enviando..." : "Fazer pedido OFF360"}
          </Button>
          <p className="mt-2 text-[11px] text-gray-500">O pagamento será realizado diretamente ao estabelecimento na entrega ou retirada.</p>
        </div>
      )}
    </div>
  );
}
