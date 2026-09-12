import React, { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadMp } from "@/lib/mpSdk";
import { QrCode, CreditCard, Banknote, Copy, Loader2, Plus, Trash2, ArrowLeft } from "lucide-react";

// ---------------- Cartão salvo + adicionar cartão ----------------
function AddCard({ pk, onAdded, onCancel }) {
  const [f, setF] = useState({ number: "", name: "", exp: "", cvv: "", cpf: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    if (!f.number || !f.name || !f.exp || !f.cvv || !f.cpf) return toast.error("Preencha todos os campos do cartão.");
    const [mm, yyRaw] = f.exp.split("/").map((x) => (x || "").trim());
    if (!mm || !yyRaw) return toast.error("Validade no formato MM/AA.");
    setBusy(true);
    try {
      const mp = await loadMp(pk);
      const token = await mp.createCardToken({
        cardNumber: f.number.replace(/\s/g, ""),
        cardholderName: f.name,
        cardExpirationMonth: mm,
        cardExpirationYear: yyRaw.length === 2 ? `20${yyRaw}` : yyRaw,
        securityCode: f.cvv,
        identificationType: "CPF",
        identificationNumber: f.cpf.replace(/\D/g, ""),
      });
      await api.post("/taxi/passenger/cards", { token: token.id });
      toast.success("Cartão salvo!");
      onAdded();
    } catch (err) {
      toast.error(formatApiError(err, "Não foi possível validar o cartão. Confira os dados."));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2" data-testid="taxi-add-card">
      <Input data-testid="card-number" value={f.number} onChange={set("number")} inputMode="numeric" placeholder="Número do cartão" className="off-input" />
      <Input data-testid="card-name" value={f.name} onChange={set("name")} placeholder="Nome impresso no cartão" className="off-input" />
      <div className="grid grid-cols-3 gap-2">
        <Input data-testid="card-exp" value={f.exp} onChange={set("exp")} placeholder="MM/AA" className="off-input" />
        <Input data-testid="card-cvv" value={f.cvv} onChange={set("cvv")} inputMode="numeric" placeholder="CVV" className="off-input" />
        <Input data-testid="card-cpf" value={f.cpf} onChange={set("cpf")} inputMode="numeric" placeholder="CPF" className="off-input" />
      </div>
      <div className="flex gap-2">
        <Button data-testid="card-save" onClick={save} disabled={busy} className="h-11 flex-1 rounded-xl off-gradient font-bold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar cartão"}</Button>
        {onCancel && <Button variant="outline" onClick={onCancel} className="h-11 rounded-xl border-off-blue/40 text-gray-200">Cancelar</Button>}
      </div>
    </div>
  );
}

function CardPay({ rideId, onBack, onDone }) {
  const [cards, setCards] = useState(null);
  const [pk, setPk] = useState(null);
  const [sel, setSel] = useState(null);
  const [cvv, setCvv] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/taxi/passenger/cards");
      setCards(data.cards); setPk(data.public_key);
      if (data.cards[0]) setSel(data.cards[0].id);
      setAdding(data.cards.length === 0);
    } catch (err) { toast.error(formatApiError(err)); setCards([]); }
  };
  useEffect(() => { load(); }, []);

  const removeCard = async (id) => { try { await api.delete(`/taxi/passenger/cards/${id}`); load(); } catch (err) { toast.error(formatApiError(err)); } };

  const payWithCard = async () => {
    if (!sel) return toast.error("Selecione um cartão.");
    if (!cvv) return toast.error("Digite o CVV do cartão.");
    setBusy(true);
    try {
      const mp = await loadMp(pk);
      const token = await mp.createCardToken({ cardId: sel, securityCode: cvv });
      await api.post(`/taxi/rides/${rideId}/pay`, { method: "card", card_id: sel, card_token: token.id });
      toast.success("Pagamento aprovado!");
      onDone && onDone();
    } catch (err) { toast.error(formatApiError(err, "Não foi possível pagar com o cartão.")); }
    finally { setBusy(false); }
  };

  if (cards === null) return <div className="py-6 text-center text-sm text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-3" data-testid="taxi-card-pay">
      <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-gray-400"><ArrowLeft className="h-3 w-3" /> Voltar</button>
      {adding ? (
        <AddCard pk={pk} onAdded={() => { setAdding(false); load(); }} onCancel={cards.length ? () => setAdding(false) : null} />
      ) : (
        <>
          <div className="space-y-2">
            {cards.map((c) => (
              <div key={c.id} className={`flex items-center justify-between rounded-xl border p-3 ${sel === c.id ? "border-off-orange bg-off-orange/10" : "border-off-blue/40"}`} data-testid={`saved-card-${c.id}`}>
                <button onClick={() => setSel(c.id)} className="flex items-center gap-2 text-sm text-white">
                  <CreditCard className="h-4 w-4 text-off-orange" /> {(c.brand || "cartão").toUpperCase()} •••• {c.last_four} <span className="text-[11px] text-gray-400">{c.exp}</span>
                </button>
                <button onClick={() => removeCard(c.id)} data-testid={`del-card-${c.id}`} className="text-gray-500 hover:text-off-error"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <Button variant="outline" onClick={() => setAdding(true)} data-testid="add-card-btn" className="h-9 w-full rounded-xl border-off-blue/40 text-xs text-gray-200"><Plus className="mr-1 h-4 w-4" /> Adicionar cartão</Button>
          <Input data-testid="pay-cvv" value={cvv} onChange={(e) => setCvv(e.target.value)} inputMode="numeric" placeholder="CVV do cartão selecionado" className="off-input" />
          <Button data-testid="pay-card-confirm" onClick={payWithCard} disabled={busy} className="h-12 w-full rounded-xl off-gradient font-bold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pagar com cartão"}</Button>
        </>
      )}
    </div>
  );
}

// ---------------- Componente principal (tela do passageiro) ----------------
export default function TaxiPayment({ ride, onPaid }) {
  const [pay, setPay] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("choose"); // choose | pix | cash | card
  const pollRef = useRef(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/taxi/rides/${ride.id}/pay/status`);
      setPay(data);
      if (data.status === "approved") { stopPoll(); onPaid && onPaid(data); return data; }
      if (data.method === "pix") setView("pix");
      else if (data.method === "cash") setView("cash");
      return data;
    } catch (e) { return null; }
  }, [ride.id]); // eslint-disable-line

  useEffect(() => { refreshStatus(); return stopPoll; }, [refreshStatus]);

  const startPoll = () => { stopPoll(); pollRef.current = setInterval(refreshStatus, 4000); };

  const choose = async (method) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/taxi/rides/${ride.id}/pay`, { method });
      setPay(data); setView(method); startPoll();
      if (data.status === "approved") { stopPoll(); onPaid && onPaid(data); }
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  const copyPix = async () => { try { await navigator.clipboard.writeText(pay?.qr_code || ""); toast.success("Código Pix copiado!"); } catch { toast.error("Não foi possível copiar."); } };

  const amount = pay?.amount ?? ride.final_price;

  return (
    <div className="off-card p-5" data-testid="taxi-payment">
      <p className="font-display text-lg font-bold text-white">💳 Pagamento da corrida</p>
      <p className="mt-1 text-xs text-gray-400">Valor a pagar</p>
      <p className="font-display text-3xl font-bold text-off-orange" data-testid="taxi-pay-amount">{money(amount)}</p>

      {view === "choose" && (
        <div className="mt-4 space-y-2" data-testid="taxi-pay-methods">
          <Button data-testid="pay-method-pix" onClick={() => choose("pix")} disabled={busy} className="h-12 w-full justify-start rounded-xl off-gradient font-bold text-white"><QrCode className="mr-2 h-5 w-5" /> Pagar com Pix</Button>
          <Button data-testid="pay-method-card" onClick={() => setView("card")} disabled={busy} variant="outline" className="h-12 w-full justify-start rounded-xl border-off-blue/40 font-semibold text-gray-100"><CreditCard className="mr-2 h-5 w-5 text-off-orange" /> Cartão de crédito</Button>
          <Button data-testid="pay-method-cash" onClick={() => choose("cash")} disabled={busy} variant="outline" className="h-12 w-full justify-start rounded-xl border-off-blue/40 font-semibold text-gray-100"><Banknote className="mr-2 h-5 w-5 text-off-success" /> Dinheiro (presencial)</Button>
        </div>
      )}

      {view === "card" && <div className="mt-4"><CardPay rideId={ride.id} onBack={() => setView("choose")} onDone={() => refreshStatus()} /></div>}

      {view === "pix" && (
        <div className="mt-4 space-y-3 text-center" data-testid="taxi-pay-pix">
          {pay?.qr_code_base64 ? <img alt="QR Code Pix" src={`data:image/png;base64,${pay.qr_code_base64}`} className="mx-auto h-56 w-56 rounded-lg bg-white p-2" /> : <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />}
          <p className="text-[11px] text-gray-400">Escaneie com o app do seu banco ou copie o código. A tela confirma sozinha quando o pagamento cair.</p>
          {pay?.qr_code && <textarea readOnly value={pay.qr_code} className="h-16 w-full rounded-lg border border-off-blue/40 bg-off-bg p-2 text-[11px] text-gray-300" />}
          {pay?.qr_code && <Button data-testid="pix-copy" onClick={copyPix} className="h-10 w-full rounded-xl bg-off-blue font-semibold text-white"><Copy className="mr-2 h-4 w-4" /> Copiar Pix Copia e Cola</Button>}
          <div className="flex items-center justify-center gap-2 text-xs text-off-orange"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando pagamento…</div>
        </div>
      )}

      {view === "cash" && (
        <div className="mt-4 space-y-2 text-center" data-testid="taxi-pay-cash">
          <Banknote className="mx-auto h-10 w-10 text-off-success" />
          <p className="text-sm text-white">Pague <span className="font-bold text-off-orange">{money(amount)}</span> em dinheiro ao motorista.</p>
          <p className="text-[11px] text-gray-400">O motorista confirmará o recebimento. A tela atualiza automaticamente.</p>
          <div className="flex items-center justify-center gap-2 text-xs text-off-orange"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando confirmação do motorista…</div>
        </div>
      )}
    </div>
  );
}
