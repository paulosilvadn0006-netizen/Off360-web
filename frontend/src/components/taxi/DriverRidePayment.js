import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrCode, Banknote, CreditCard, Loader2, CheckCircle2 } from "lucide-react";

// Painel de recebimento na tela do MOTORISTA, exibido após finalizar a corrida.
export default function DriverRidePayment({ rideId, onDone }) {
  const [pay, setPay] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cashVal, setCashVal] = useState("");
  const pollRef = useRef(null);

  const stop = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  const refresh = async () => {
    try {
      const { data } = await api.get(`/taxi/rides/${rideId}/pay/status`);
      setPay(data);
      if (cashVal === "" && data.amount) setCashVal(String(data.amount));
      if (data.status === "approved") stop();
    } catch (e) { /* ignore */ }
  };
  useEffect(() => { refresh(); pollRef.current = setInterval(refresh, 4000); return stop; }, [rideId]); // eslint-disable-line

  const informCash = async () => {
    const amount = parseFloat(String(cashVal).replace(",", "."));
    if (!amount || amount <= 0) return toast.error("Informe um valor válido.");
    setBusy(true);
    try { await api.post(`/taxi/rides/${rideId}/pay/cash-inform`, { amount }); toast.success("Valor informado. Aguardando o passageiro confirmar."); await refresh(); }
    catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  if (!pay) return <div className="off-card p-5 text-center" data-testid="driver-pay-loading"><Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /></div>;
  const approved = pay.status === "approved";
  const method = pay.method;

  return (
    <div className="off-card p-5" data-testid="driver-ride-payment">
      {approved ? (
        <div className="text-center" data-testid="driver-pay-approved">
          <CheckCircle2 className="mx-auto h-12 w-12 text-off-success" />
          <p className="mt-2 font-display text-lg font-bold text-off-success">Valor recebido com sucesso! Vamos para a próxima!</p>
          <p className="mt-1 text-xs text-gray-400">{money(pay.amount)} · {method === "cash" ? "Dinheiro" : method === "pix" ? "Pix" : "Cartão"}</p>
          <Button data-testid="driver-pay-done" onClick={onDone} className="mt-4 h-11 w-full rounded-xl off-gradient font-bold text-white">Concluir</Button>
        </div>
      ) : (
        <>
          <p className="font-display text-sm font-bold text-off-orange">🏁 Corrida finalizada — recebimento</p>
          <p className="mt-1 text-xs text-gray-400">Valor a receber</p>
          <p className="font-display text-2xl font-bold text-off-orange">{money(pay.amount)}</p>

          {method === "pix" && (
            <div className="mt-3 space-y-2 text-center" data-testid="driver-pay-pix">
              <p className="flex items-center justify-center gap-1 text-xs font-semibold text-gray-200"><QrCode className="h-4 w-4 text-off-orange" /> O passageiro paga o Pix na tela dele</p>
              {pay.qr_code_base64 ? <img alt="QR Code Pix" src={`data:image/png;base64,${pay.qr_code_base64}`} className="mx-auto h-44 w-44 rounded-lg bg-white p-2" /> : <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />}
              <div className="flex items-center justify-center gap-2 text-xs text-off-orange"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando o pagamento…</div>
            </div>
          )}

          {method === "card" && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-off-blue/30 bg-off-bg/40 p-3 text-xs text-gray-300" data-testid="driver-pay-card">
              <CreditCard className="h-4 w-4 text-off-orange" /> Cobrança automática no cartão do passageiro em andamento…
            </div>
          )}

          {method === "cash" && (
            <div className="mt-3 space-y-2 text-center" data-testid="driver-pay-cash">
              <Banknote className="mx-auto h-8 w-8 text-off-success" />
              {pay.status === "awaiting_confirm" ? (
                <p className="flex items-center justify-center gap-2 text-xs text-off-orange"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Você informou {money(pay.cash_amount)}. Aguardando o passageiro confirmar…</p>
              ) : (
                <>
                  <p className="text-xs text-gray-300">Informe o valor recebido em dinheiro:</p>
                  <div className="flex gap-2">
                    <Input data-testid="driver-cash-input" value={cashVal} onChange={(e) => setCashVal(e.target.value)} inputMode="decimal" placeholder="R$" className="off-input" />
                    <Button data-testid="driver-cash-inform" onClick={informCash} disabled={busy} className="rounded-xl bg-off-success font-bold text-white hover:bg-off-success/90">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Informar"}</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
