import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Loader2, Bell, Receipt, Plus, Minus, Utensils, Star } from "lucide-react";

export default function TableMenu() {
  const { token } = useParams();
  const qc = useQueryClient();
  const [cart, setCart] = useState({});
  const [obs, setObs] = useState({});
  const [addonsSel, setAddonsSel] = useState({});
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState({ stars: 0, waiter_stars: 0, comment: "" });
  const [rated, setRated] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [coverErr, setCoverErr] = useState(false);
  const [logoErr, setLogoErr] = useState(false);
  const [detail, setDetail] = useState(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["tablemenu", token], queryFn: async () => (await api.get(`/presencial/table/${token}`)).data, refetchInterval: 8000 });

  const extUrl = data?.menu_mode === "external" ? String(data?.menu_external_url || "").trim() : "";
  useEffect(() => {
    if (extUrl) {
      const url = /^https?:\/\//i.test(extUrl) ? extUrl : `https://${extUrl}`;
      window.location.replace(url);
    }
  }, [extUrl]);

  useEffect(() => {
    const cc = data?.comanda;
    if (cc && cc.status === "bill_requested" && !(rated || localStorage.getItem(`off_rated_${cc.id}`))) setShowRating(true);
  }, [data, rated]);

  if (isLoading) return <div className="flex min-h-screen items-center justify-center bg-off-bg"><Loader2 className="h-6 w-6 animate-spin text-off-orange" /></div>;
  if (error || !data) return <div className="flex min-h-screen items-center justify-center bg-off-bg px-6 text-center text-gray-300">Mesa não encontrada. Verifique o QR Code.</div>;
  if (extUrl) return <div className="flex min-h-screen items-center justify-center bg-off-bg px-6 text-center text-gray-300"><Loader2 className="mr-2 h-5 w-5 animate-spin text-off-orange" /> Abrindo o cardápio...</div>;

  const e = data.establishment; const cats = {};
  data.catalog.forEach((i) => { const c = i.category || "Itens"; (cats[c] = cats[c] || []).push(i); });
  const setQty = (id, d) => setCart((c) => { const q = Math.max(0, (c[id] || 0) + d); const n = { ...c }; if (q) n[id] = q; else delete n[id]; return n; });
  const items = data.catalog.filter((i) => cart[i.id]);
  const addonSum = (id) => (addonsSel[id] || []).reduce((s, a) => s + (a.price || 0), 0);
  const subtotal = items.reduce((s, i) => s + (i.eff_price + addonSum(i.id)) * cart[i.id], 0);
  const toggleAddon = (id, a) => setAddonsSel((m) => { const cur = m[id] || []; const has = cur.some((x) => x.name === a.name); return { ...m, [id]: has ? cur.filter((x) => x.name !== a.name) : [...cur, { name: a.name, price: a.price || 0 }] }; });

  const sendOrder = async () => {
    if (!items.length) return;
    setBusy(true);
    try {
      const body = { items: items.map((i) => ({ item_id: i.id, qty: cart[i.id], observations: obs[i.id] || "", addons: addonsSel[i.id] || [] })) };
      const { data: r } = await api.post(`/presencial/table/${token}/order`, body);
      toast.success(r.flow === "direct" ? "Pedido enviado à cozinha!" : "Pedido enviado! O garçom vai confirmar.");
      setCart({}); setObs({}); setAddonsSel({}); qc.invalidateQueries({ queryKey: ["tablemenu", token] });
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };
  const callWaiter = async () => { try { await api.post(`/presencial/table/${token}/call-waiter`, { note: "" }); toast.success("Garçom chamado!"); } catch (err) { toast.error(formatApiError(err)); } };
  const requestBill = async () => { try { await api.post(`/presencial/table/${token}/request-bill`); toast.success("Conta solicitada!"); qc.invalidateQueries({ queryKey: ["tablemenu", token] }); } catch (err) { toast.error(formatApiError(err)); } };
  const submitRating = async () => {
    if (!rate.stars) { toast.error("Escolha de 1 a 5 estrelas"); return; }
    try { await api.post(`/presencial/table/${token}/rate`, rate); if (c) localStorage.setItem(`off_rated_${c.id}`, "1"); setRated(true); setShowRating(false); toast.success("Obrigado pela avaliação!"); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const c = data.comanda;
  return (
    <div className="min-h-screen bg-off-bg pb-40" data-testid="table-menu">
      <div className="relative h-36 w-full overflow-hidden bg-off-surface">
        {e.cover_url && !coverErr ? <img alt="" src={fileUrl(e.cover_url)} onError={() => setCoverErr(true)} className="h-36 w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Utensils className="h-8 w-8 text-gray-600" /></div>}
        <div className="absolute inset-0 bg-gradient-to-t from-off-bg to-transparent" />
      </div>
      <div className="px-4">
        <div className="-mt-8 flex items-center gap-3">
          {e.logo_url && !logoErr ? <img alt="" src={fileUrl(e.logo_url)} onError={() => setLogoErr(true)} className="h-16 w-16 rounded-2xl border-2 border-off-bg object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-off-bg bg-off-surface"><Utensils className="h-7 w-7 text-off-orange" /></div>}
          <div><h1 className="font-display text-xl font-bold text-white">{e.fantasy_name}</h1><p className="text-xs text-off-orange">{data.table.name}</p></div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button data-testid="call-waiter-btn" onClick={callWaiter} className="flex-1 rounded-xl bg-off-blue text-sm font-semibold text-white"><Bell className="mr-1.5 h-4 w-4" /> Chamar garçom</Button>
          {c && <Button data-testid="request-bill-btn" onClick={requestBill} className="flex-1 rounded-xl off-gradient text-sm font-semibold text-white"><Receipt className="mr-1.5 h-4 w-4" /> Pedir a conta</Button>}
        </div>

        {data.google_review_url && (
          <a data-testid="google-review-btn" href={/^https?:\/\//i.test(data.google_review_url) ? data.google_review_url : `https://${data.google_review_url}`} target="_blank" rel="noreferrer"
             className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-off-blue/40 bg-off-surface py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98]">
            <Star className="h-4 w-4 text-off-orange" /> Avaliar no Google
          </a>
        )}

        {c && (
          <div className="mt-4 rounded-2xl border border-off-blue/40 bg-off-surface p-3" data-testid="table-comanda">
            <p className="text-xs font-semibold text-gray-300">Sua comanda</p>
            {c.waiter && (
              <div className="mt-1 flex items-center gap-2" data-testid="comanda-waiter">
                {c.waiter.photo_url ? <img alt="" src={fileUrl(c.waiter.photo_url)} className="h-8 w-8 rounded-full object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-off-bg text-off-orange">🧑‍🍳</span>}
                <span className="text-[11px] text-gray-300">Atendido por <b className="text-white">{c.waiter.name}</b></span>
              </div>
            )}
            {c.items.map((i, idx) => (<div key={idx} className="mt-1 flex justify-between text-sm text-gray-200"><span>{i.qty}× {i.name} <span className="text-[10px] text-gray-500">({i.status})</span></span><span>{money(i.unit_price * i.qty)}</span></div>))}
            <div className="mt-2 border-t border-off-blue/20 pt-2 text-sm">
              <div className="flex justify-between text-gray-300"><span>Subtotal</span><span>{money(c.subtotal)}</span></div>
              <div className="flex justify-between text-gray-300"><span>Taxa ({c.service_fee_percent}%)</span><span>{money(c.service_fee)}</span></div>
              <div className="flex justify-between font-bold text-white"><span>Total</span><span className="text-off-orange">{money(c.total)}</span></div>
            </div>
          </div>
        )}

        {c && c.status === "bill_requested" && !(rated || localStorage.getItem(`off_rated_${c.id}`)) && (
          <button data-testid="open-rating-btn" onClick={() => setShowRating(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-off-orange/40 bg-off-orange/10 p-3 text-sm font-bold text-off-orange">
            <Star className="h-4 w-4" /> Avaliar meu atendimento
          </button>
        )}
        {c && (rated || localStorage.getItem(`off_rated_${c.id}`)) && (
          <div className="mt-4 rounded-2xl border border-off-success/40 bg-off-success/10 p-3 text-center text-sm text-off-success" data-testid="table-rated">Obrigado pela sua avaliação! 💛</div>
        )}

        <div className="mt-5 space-y-5">
          {Object.entries(cats).map(([cat, list]) => (
            <div key={cat}>
              <p className="mb-2 font-display text-sm font-bold text-white">{cat}</p>
              <div className="space-y-2">
                {list.map((i) => (
                  <div key={i.id} className="flex gap-3 rounded-xl border border-off-blue/30 bg-off-surface p-2" data-testid={`menu-item-${i.id}`}>
                    <div onClick={() => setDetail(i)} className="h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-off-bg">{i.photo_url ? <img alt="" src={fileUrl(i.photo_url)} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-gray-600"><Utensils className="h-5 w-5" /></div>}</div>
                    <div onClick={() => setDetail(i)} data-testid={`menu-item-open-${i.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <p className="text-sm font-semibold text-white">{i.name} {i.best_seller && "🔥"}{i.featured && "⭐"}</p>
                      {i.description && <p className="truncate text-[11px] text-gray-400">{i.description}</p>}
                      <p className="text-sm font-bold text-off-orange">{money(i.eff_price)}</p>
                    </div>
                    <div className="flex flex-col items-center justify-center gap-1">
                      <div className="flex items-center gap-2">
                        <button data-testid={`menu-minus-${i.id}`} onClick={() => setQty(i.id, -1)} className="h-7 w-7 rounded-lg border border-off-blue/40 text-white"><Minus className="mx-auto h-3.5 w-3.5" /></button>
                        <span className="w-5 text-center text-sm font-bold text-white" data-testid={`menu-qty-${i.id}`}>{cart[i.id] || 0}</span>
                        <button data-testid={`menu-plus-${i.id}`} onClick={() => setQty(i.id, 1)} className="h-7 w-7 rounded-lg off-gradient text-white"><Plus className="mx-auto h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {data.catalog.length === 0 && <p className="text-sm text-gray-400">O cardápio ainda não foi cadastrado.</p>}
        </div>
      </div>

      {items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-off-blue/40 bg-off-surface p-3 safe-bottom">
          <Button data-testid="send-order-btn" onClick={sendOrder} disabled={busy} className="h-12 w-full rounded-xl off-gradient font-bold text-white">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : `Enviar pedido · ${money(subtotal)}`}
          </Button>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center" data-testid="item-detail-modal" onClick={() => setDetail(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-off-blue/40 bg-off-surface" onClick={(ev) => ev.stopPropagation()}>
            <div className="relative h-48 w-full bg-off-bg">
              {detail.photo_url ? <img alt="" src={fileUrl(detail.photo_url)} className="h-48 w-full object-cover" /> : <div className="flex h-full items-center justify-center text-gray-600"><Utensils className="h-10 w-10" /></div>}
              <button data-testid="item-detail-close" onClick={() => setDetail(null)} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-lg text-white">×</button>
            </div>
            <div className="p-4">
              <p className="font-display text-lg font-bold text-white" data-testid="item-detail-name">{detail.name} {detail.best_seller && "🔥"}{detail.featured && "⭐"}</p>
              {detail.description ? <p className="mt-1 text-sm text-gray-400" data-testid="item-detail-desc">{detail.description}</p> : <p className="mt-1 text-sm text-gray-500">Sem descrição cadastrada.</p>}
              <div className="mt-3 flex items-center gap-2" data-testid="item-detail-price">
                <span className="text-xl font-bold text-off-orange">{money(detail.eff_price)}</span>
                {detail.promo_price && detail.price ? <span className="text-sm text-gray-500 line-through">{money(detail.price)}</span> : null}
              </div>

              {(detail.addons || []).length > 0 && (
                <div className="mt-3" data-testid="item-detail-addons">
                  <p className="text-xs font-semibold text-gray-300">Adicionais</p>
                  <div className="mt-1 space-y-1.5">
                    {(detail.addons || []).map((a, ai) => {
                      const checked = (addonsSel[detail.id] || []).some((x) => x.name === a.name);
                      return (
                        <label key={ai} data-testid={`addon-${detail.id}-${ai}`} className="flex cursor-pointer items-center justify-between rounded-lg border border-off-blue/30 bg-off-bg/40 px-3 py-2">
                          <span className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={checked} onChange={() => toggleAddon(detail.id, a)} /> {a.name}</span>
                          {a.price ? <span className="text-xs font-semibold text-off-orange">+{money(a.price)}</span> : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-3">
                <p className="text-xs font-semibold text-gray-300">Observação</p>
                <textarea data-testid="item-detail-obs" value={obs[detail.id] || ""} onChange={(ev) => setObs({ ...obs, [detail.id]: ev.target.value })} placeholder="Ex: sem cebola, ponto da carne, molho à parte..." className="off-input mt-1 w-full resize-none py-2" rows={2} />
              </div>

              <Button data-testid="item-detail-add" onClick={() => { setQty(detail.id, 1); toast.success("Adicionado ao pedido"); setDetail(null); }} className="mt-4 h-12 w-full rounded-xl off-gradient font-bold text-white"><Plus className="mr-1.5 h-4 w-4" /> Adicionar ao pedido · {money(detail.eff_price + addonSum(detail.id))}</Button>
            </div>
          </div>
        </div>
      )}

      {showRating && c && !(rated || localStorage.getItem(`off_rated_${c.id}`)) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center" data-testid="rating-modal" onClick={() => setShowRating(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-off-orange/40 bg-off-surface p-5" onClick={(ev) => ev.stopPropagation()}>
            <p className="font-display text-lg font-bold text-white">Como foi seu atendimento?</p>
            <p className="mt-0.5 text-xs text-gray-400">Sua opinião ajuda muito a equipe! 💛</p>
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-300">Avalie o estabelecimento</p>
              <StarRow value={rate.stars} onChange={(v) => setRate({ ...rate, stars: v })} testid="rate-stars" />
            </div>
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-300">Avalie o garçom{c.waiter?.name ? ` · ${c.waiter.name}` : ""}</p>
              <StarRow value={rate.waiter_stars} onChange={(v) => setRate({ ...rate, waiter_stars: v })} testid="rate-waiter" />
            </div>
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-300">Observação</p>
              <textarea data-testid="rate-comment" value={rate.comment} onChange={(ev) => setRate({ ...rate, comment: ev.target.value })} placeholder="Escreva algo para a equipe (opcional)" className="off-input mt-1 w-full resize-none py-2" rows={3} />
            </div>
            <Button data-testid="rate-submit" onClick={submitRating} className="mt-4 h-11 w-full rounded-xl off-gradient font-bold text-white">Enviar avaliação</Button>
            <button data-testid="rate-skip" onClick={() => setShowRating(false)} className="mt-2 w-full text-xs text-gray-500">Agora não</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StarRow({ value, onChange, testid }) {
  return (
    <div className="mt-1 flex gap-1" data-testid={testid}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} data-testid={`${testid}-${n}`} onClick={() => onChange(n)} className={`text-2xl leading-none ${n <= value ? "text-off-orange" : "text-gray-600"}`}>★</button>
      ))}
    </div>
  );
}
