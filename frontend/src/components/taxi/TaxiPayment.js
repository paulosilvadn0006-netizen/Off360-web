import React, { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadMp, loadDeviceId, getDeviceId } from "@/lib/mpSdk";
import { QrCode, CreditCard, Banknote, Copy, Loader2, RefreshCw, AlertTriangle } from "lucide-react";

// Tela do passageiro: conclui o pagamento com o método já escolhido antes da corrida.
export default function TaxiPayment({ ride, onPaid }) {
  const [pay, setPay] = useState(null);
  const [cvv, setCvv] = useState("");
  const [charging, setCharging] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState(null);
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
    setErr(null); setGenerating(true);
    try { const { data } = await api.post(`/taxi/rides/${ride.id}/pay`, { method: "pix", device_id: getDeviceId() }); setPay(data); startPoll(); }
    catch (e) { const m = formatApiError(e, "Não foi possível gerar o Pix. Tente novamente ou escolha outra forma de pagamento."); setErr(m); toast.error(m); }
    finally { setGenerating(false); }
  }, [ride.id]); // eslint-disable-line

  const chargeCard = useCallback(async (withCvv) => {
    if (cardTriedRef.current && !withCvv) return;
    cardTriedRef.current = true;
    setErr(null); setCharging(true);
    try {
      const { data: cardsData } = await api.get("/taxi/passenger/cards");
      const cardId = pay?.card_id || (cardsData.cards[0] && cardsData.cards[0].id);
      if (!cardId) { const m = "Nenhum cartão salvo. Cadastre no seu Perfil ou escolha outra forma de pagamento."; setErr(m); toast.error(m); setCharging(false); return; }
      const mp = await loadMp(cardsData.public_key);
      const tokenPayload = withCvv ? { cardId, securityCode: withCvv } : { cardId };
      const token = await mp.createCardToken(tokenPayload);
      const { data } = await api.post(`/taxi/rides/${ride.id}/pay`, { method: "card", card_id: cardId, card_token: token.id, device_id: getDeviceId() });
      setPay(data);
      if (data.status === "approved") { onPaid && onPaid(data); } else { startPoll(); }
    } catch (e) {
      const m = formatApiError(e, "Não foi possível cobrar o cartão. Digite o CVV e tente novamente ou escolha outra forma de pagamento.");
      setErr(m); toast.error(m);
    } finally { setCharging(false); }
  }, [ride.id, pay?.card_id]); // eslint-disable-line

  const startCash = useCallback(async () => {
    setErr(null); setCharging(true);
    try { const { data } = await api.post(`/taxi/rides/${ride.id}/pay`, { method: "cash" }); setPay(data); startPoll(); }
    catch (e) { const m = formatApiError(e); setErr(m); toast.error(m); }
    finally { setCharging(false); }
  }, [ride.id]); // eslint-disable-line

  // Troca de forma de pagamento pelo passageiro (destrava a tela se um método falhar).
  const switchMethod = (m) => {
    cardTriedRef.current = false;
    setErr(null);
    if (m === "pix") genPix();
    else if (m === "card") chargeCard(null);
    else if (m === "cash") startCash();
  };

  const confirmCash = async () => {
    setCharging(true);
    try { await api.post(`/taxi/rides/${ride.id}/pay/cash-confirm`); await refreshStatus(); }
    catch (e) { toast.error(formatApiError(e)); } finally { setCharging(false); }
  };

  // Ao montar: carrega o fingerprint antifraude, o status e dispara o método escolhido.
  useEffect(() => {
    loadDeviceId();
    (async () => {
      const s = await refreshStatus();
      if (!s || s.status === "approved") return;
      if (s.method === "pix" && !s.qr_code) { genPix(); }
      else if (s.method === "pix") { startPoll(); }
      else if (s.method === "card" && s.status === "pending") { chargeCard(null); }
      else if (s.method === "cash") { startPoll(); }
    })();
    return () => { stopPoll(); };
  }, [refreshStatus]); // eslint-disable-line

  if (!pay) return <div className="off-card p-6 text-center" data-testid="taxi-payment"><Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /></div>;
  const amount = pay.amount ?? ride.final_price;
  const method = pay.method || "pix";
  const copyPix = async () => { try { await navigator.clipboard.writeText(pay.qr_code || ""); toast.success("Código Pix copiado!"); } catch { toast.error("Não foi possível copiar."); } };
  const methodBtns = [["pix", "Pix", QrCode], ["card", "Cartão", CreditCard], ["cash", "Dinheiro", Banknote]];

  return (
    <div className="off-card p-5" data-testid="taxi-payment">
      <p className="font-display text-lg font-bold text-white">💳 Pagamento da corrida</p>
      <p className="mt-1 text-xs text-gray-400">Valor a pagar</p>
      <p className="font-display text-3xl font-bold text-off-orange" data-testid="taxi-pay-amount">{money(amount)}</p>

      {/* Seletor de forma de pagamento (permite trocar/destravar) */}
      <div className="mt-3 grid grid-cols-3 gap-2" data-testid="taxi-pay-methods">
        {methodBtns.map(([id, label, Icon]) => (
          <button key={id} data-testid={`taxi-pay-switch-${id}`} onClick={() => switchMethod(id)} disabled={charging || generating}
            className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-xs font-bold transition ${method === id ? "border-off-orange bg-off-orange/15 text-white" : "border-off-blue/40 text-gray-300 hover:border-off-blue"}`}>
            <Icon className="h-5 w-5" /> {label}
          </button>
        ))}
      </div>

      {err && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-off-error/50 bg-off-error/10 p-3 text-xs text-off-error" data-testid="taxi-pay-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{err}</span>
        </div>
      )}

      {method === "pix" && (
        <div className="mt-4 space-y-3 text-center" data-testid="taxi-pay-pix">
          {pay.qr_code_base64 ? (
            <img alt="QR Code Pix" src={`data:image/png;base64,${pay.qr_code_base64}`} className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />
          ) : generating ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-off-orange"><Loader2 className="h-5 w-5 animate-spin" /> Gerando QR Code Pix…</div>
          ) : (
            <Button data-testid="pix-generate" onClick={genPix} className="h-11 w-full rounded-xl off-gradient font-bold text-white"><RefreshCw className="mr-2 h-4 w-4" /> Gerar QR Code Pix</Button>
          )}
          {pay.qr_code_base64 && <p className="text-[11px] text-gray-400">Escaneie com o app do seu banco ou copie o código. A tela confirma sozinha quando o pagamento cair.</p>}
          {pay.qr_code && <Button data-testid="pix-copy" onClick={copyPix} className="h-10 w-full rounded-xl bg-off-blue font-semibold text-white"><Copy className="mr-2 h-4 w-4" /> Copiar Pix Copia e Cola</Button>}
          {pay.qr_code_base64 && <div className="flex items-center justify-center gap-2 text-xs text-off-orange"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando pagamento…</div>}
        </div>
      )}

      {method === "card" && (
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

      {method === "cash" && (
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
