import React, { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadMp } from "@/lib/mpSdk";
import { QrCode, CreditCard, Banknote, Copy, Loader2 } from "lucide-react";

// Tela do passageiro: conclui o pagamento com o método já escolhido antes da corrida.
export default function TaxiPayment({ ride, onPaid }) {
  const [pay, setPay] = useState(null);
  const [cvv, setCvv] = useState("");
  const [charging, setCharging] = useState(false);
  const pollRef = useRef(null);
  const cardTriedRef = useRef(false);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/taxi/rides/${ride.id}/pay/status`);
      setPay(data);
      if (data.status === "approved") { stopPoll(); onPaid && onPaid(data); }
      return data;
    } catch (e) { return null; }
  }, [ride.id]); // eslint-disable-line

  const startPoll = () => { stopPoll(); pollRef.current = setInterval(refreshStatus, 4000); };

  const genPix = useCallback(async () => {
    try { const { data } = await api.post(`/taxi/rides/${ride.id}/pay`, { method: "pix" }); setPay(data); startPoll(); }
    catch (err) { toast.error(formatApiError(err)); }
  }, [ride.id]); // eslint-disable-line

  const chargeCard = useCallback(async (withCvv) => {
    if (cardTriedRef.current && !withCvv) return;
    cardTriedRef.current = true;
    setCharging(true);
    try {
      const { data: cardsData } = await api.get("/taxi/passenger/cards");
      const cardId = pay?.card_id || (cardsData.cards[0] && cardsData.cards[0].id);
      if (!cardId) { toast.error("Nenhum cartão salvo. Cadastre no seu Perfil."); setCharging(false); return; }
      const mp = await loadMp(cardsData.public_key);
      const tokenPayload = withCvv ? { cardId, securityCode: withCvv } : { cardId };
      const token = await mp.createCardToken(tokenPayload);
      const { data } = await api.post(`/taxi/rides/${ride.id}/pay`, { method: "card", card_id: cardId, card_token: token.id });
      setPay(data);
      if (data.status === "approved") { onPaid && onPaid(data); } else { startPoll(); }
    } catch (err) {
      toast.error(formatApiError(err, "Não foi possível cobrar o cartão. Digite o CVV e tente novamente."));
    } finally { setCharging(false); }
  }, [ride.id, pay?.card_id]); // eslint-disable-line

  const confirmCash = async () => {
    setCharging(true);
    try { await api.post(`/taxi/rides/${ride.id}/pay/cash-confirm`); await refreshStatus(); }
    catch (err) { toast.error(formatApiError(err)); } finally { setCharging(false); }
  };

  // Ao montar: carrega status e dispara automaticamente o método escolhido.
  useEffect(() => {
    let started = false;
    (async () => {
      const s = await refreshStatus();
      if (!s || s.status === "approved") return;
      if (s.method === "pix" && !s.qr_code) { genPix(); started = true; }
      else if (s.method === "pix") { startPoll(); started = true; }
      else if (s.method === "card" && s.status === "pending") { chargeCard(null); started = true; }
      else if (s.method === "cash") { startPoll(); started = true; }
    })();
    return () => { stopPoll(); };
  }, [refreshStatus]); // eslint-disable-line

  if (!pay) return <div className="off-card p-6 text-center" data-testid="taxi-payment"><Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /></div>;
  const amount = pay.amount ?? ride.final_price;
  const copyPix = async () => { try { await navigator.clipboard.writeText(pay.qr_code || ""); toast.success("Código Pix copiado!"); } catch { toast.error("Não foi possível copiar."); } };

  return (
    <div className="off-card p-5" data-testid="taxi-payment">
      <p className="font-display text-lg font-bold text-white">💳 Pagamento da corrida</p>
      <p className="mt-1 text-xs text-gray-400">Valor a pagar</p>
      <p className="font-display text-3xl font-bold text-off-orange" data-testid="taxi-pay-amount">{money(amount)}</p>

      {pay.method === "pix" && (
        <div className="mt-4 space-y-3 text-center" data-testid="taxi-pay-pix">
          {pay.qr_code_base64 ? <img alt="QR Code Pix" src={`data:image/png;base64,${pay.qr_code_base64}`} className="mx-auto h-56 w-56 rounded-lg bg-white p-2" /> : <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />}
          <p className="text-[11px] text-gray-400">Escaneie com o app do seu banco ou copie o código. A tela confirma sozinha quando o pagamento cair.</p>
          {pay.qr_code && <Button data-testid="pix-copy" onClick={copyPix} className="h-10 w-full rounded-xl bg-off-blue font-semibold text-white"><Copy className="mr-2 h-4 w-4" /> Copiar Pix Copia e Cola</Button>}
          <div className="flex items-center justify-center gap-2 text-xs text-off-orange"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando pagamento…</div>
        </div>
      )}

      {pay.method === "card" && (
        <div className="mt-4 space-y-2 text-center" data-testid="taxi-pay-card">
          <CreditCard className="mx-auto h-10 w-10 text-off-orange" />
          {charging ? <p className="flex items-center justify-center gap-2 text-sm text-off-orange"><Loader2 className="h-4 w-4 animate-spin" /> Processando cartão…</p> : (
            <>
              <p className="text-sm text-gray-300">Se necessário, confirme o CVV do cartão salvo para concluir.</p>
              <div className="flex gap-2">
                <Input data-testid="card-cvv-retry" value={cvv} onChange={(e) => setCvv(e.target.value)} inputMode="numeric" placeholder="CVV" className="off-input" />
                <Button data-testid="card-charge-retry" onClick={() => chargeCard(cvv)} className="rounded-xl off-gradient font-bold text-white">Pagar</Button>
              </div>
            </>
          )}
        </div>
      )}

      {pay.method === "cash" && (
        <div className="mt-4 space-y-2 text-center" data-testid="taxi-pay-cash">
          <Banknote className="mx-auto h-10 w-10 text-off-success" />
          {pay.status === "awaiting_confirm" ? (
            <>
              <p className="text-sm text-white">O motorista informou que recebeu <span className="font-bold text-off-orange">{money(pay.cash_amount)}</span> em dinheiro.</p>
              <Button data-testid="cash-confirm-btn" onClick={confirmCash} disabled={charging} className="h-12 w-full rounded-xl bg-off-success font-bold text-white hover:bg-off-success/90">{charging ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar recebimento"}</Button>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 text-xs text-off-orange"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando o motorista informar o valor recebido…</div>
          )}
        </div>
      )}
    </div>
  );
}
