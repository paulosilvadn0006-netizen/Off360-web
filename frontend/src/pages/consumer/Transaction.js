import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, money } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Clock, ShieldCheck, ChevronLeft } from "lucide-react";

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span data-testid="live-clock">{now.toLocaleTimeString("pt-BR")}</span>;
}

export default function Transaction() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = id === "new";
  const [est, setEst] = useState(null);
  const [amount, setAmount] = useState("");
  const [tx, setTx] = useState(null);
  const [creating, setCreating] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    if (isNew) {
      const raw = sessionStorage.getItem("scan_est");
      if (!raw) { navigate("/scan"); return; }
      setEst(JSON.parse(raw));
    } else {
      api.get(`/consumer/transactions/${id}`).then(({ data }) => { setTx(data); startPoll(data); }).catch(() => navigate("/home"));
    }
    return () => pollRef.current && clearInterval(pollRef.current);
  }, [id]); // eslint-disable-line

  const startPoll = (t) => {
    if (t.status !== "awaiting_confirmation") return;
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/consumer/transactions/${t.id}`);
        setTx(data);
        if (data.status !== "awaiting_confirmation") clearInterval(pollRef.current);
      } catch {}
    }, 3000);
  };

  const create = async () => {
    const val = parseFloat(String(amount).replace(",", "."));
    if (!val || val <= 0) { toast.error("Informe um valor válido"); return; }
    setCreating(true);
    try {
      const { data } = await api.post("/consumer/transactions", { establishment_id: est.id, gross_amount: val });
      sessionStorage.removeItem("scan_est");
      setTx(data);
      navigate(`/transaction/${data.id}`, { replace: true });
      startPoll(data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally { setCreating(false); }
  };

  // ---- create screen ----
  if (isNew && !tx) {
    if (!est) return <Loading />;
    const val = parseFloat(String(amount).replace(",", ".")) || 0;
    const discount = val * (est.discount_percent || 0) / 100;
    return (
      <div className="px-4 pt-6 animate-fade-up">
        <button onClick={() => navigate("/scan")} className="rounded-full bg-off-surface p-2 text-white"><ChevronLeft className="h-5 w-5" /></button>
        <div className="mt-4 off-card p-5 text-center">
          <p className="text-sm text-gray-400">Validação em</p>
          <h1 className="font-display text-xl font-bold text-white">{est.fantasy_name}</h1>
          <span className="mt-2 inline-block rounded-full bg-off-orange/20 px-3 py-1 text-sm font-bold text-off-orange">{est.discount_percent}% de desconto</span>
        </div>
        <div className="mt-5">
          <label className="text-sm text-gray-300">Valor bruto da compra</label>
          <div className="mt-1.5 flex items-center rounded-xl border border-off-blue/40 bg-off-surface px-4">
            <span className="text-lg font-bold text-gray-400">R$</span>
            <Input data-testid="tx-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00"
              className="h-14 border-0 bg-transparent text-2xl font-bold text-white focus-visible:ring-0" />
          </div>
        </div>
        {val > 0 && (
          <div className="mt-4 space-y-2 off-card p-4 text-sm">
            <Row label="Valor original" value={money(val)} />
            <Row label={`Desconto (${est.discount_percent}%)`} value={`- ${money(discount)}`} orange />
            <div className="my-1 h-px bg-off-blue/40" />
            <Row label="Valor final a pagar" value={money(val - discount)} big />
          </div>
        )}
        <Button data-testid="tx-create-btn" onClick={create} disabled={creating || !val} className="mt-5 h-13 h-12 w-full rounded-xl off-gradient font-semibold text-white">
          {creating ? "Enviando..." : "Enviar para o estabelecimento"}
        </Button>
      </div>
    );
  }

  if (!tx) return <Loading />;

  // ---- confirmed screen ----
  if (tx.status === "confirmed") {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center animate-fade-up">
        <div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-off-success/20">
          <CheckCircle2 className="h-14 w-14 text-off-success" />
        </div>
        <h1 data-testid="tx-confirmed" className="mt-5 font-display text-2xl font-extrabold text-off-success">PAGAMENTO CONFIRMADO</h1>
        <p className="mt-2 text-sm text-gray-300">{tx.consumer_name}</p>
        <p className="font-semibold text-white">{tx.establishment_name}</p>
        <p className="mt-1 text-xs text-gray-500"><LiveClock /></p>
        <div className="mt-6 w-full max-w-sm space-y-2 off-card p-5 text-sm">
          <Row label="Código da transação" value={tx.transaction_code} />
          <Row label="Valor original" value={money(tx.gross_amount)} />
          <Row label="Você economizou" value={money(tx.saved_amount)} orange />
          <div className="my-1 h-px bg-off-blue/40" />
          <Row label="Valor final" value={money(tx.final_amount)} big />
        </div>
        <div className="mt-5 rounded-2xl bg-off-success/10 px-5 py-3 text-sm text-off-success">
          Você economizou <b>{money(tx.saved_amount)}</b> na <b>{tx.establishment_name}</b> às {new Date(tx.confirmed_at).toLocaleTimeString("pt-BR")}.
        </div>
        <Button onClick={() => navigate("/economy")} className="mt-6 h-12 w-full max-w-sm rounded-xl off-gradient font-semibold text-white">Ver minha economia</Button>
      </div>
    );
  }

  if (tx.status === "cancelled") {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-xl font-bold text-off-error">Validação recusada</h1>
        <p className="mt-2 text-sm text-gray-400">O estabelecimento recusou esta validação.</p>
        <Button onClick={() => navigate("/home")} className="mt-6 rounded-xl off-gradient px-8 font-semibold text-white">Voltar ao início</Button>
      </div>
    );
  }

  // ---- awaiting ----
  return (
    <div className="px-4 pt-8 animate-fade-up">
      <div className="off-card overflow-hidden">
        <div className="flex flex-col items-center bg-off-warning/10 p-6 text-center">
          <div className="flex items-center gap-2 rounded-full bg-off-warning/20 px-4 py-1.5 text-sm font-semibold text-off-warning">
            <Clock className="h-4 w-4 animate-pulse" /> Aguardando confirmação do estabelecimento
          </div>
          <div className="mt-4 h-16 w-16 overflow-hidden rounded-full border-2 border-off-orange off-gradient">
            {user?.photo_url ? <img alt="" src={user.photo_url} className="h-full w-full object-cover" /> :
              <div className="flex h-full w-full items-center justify-center font-display text-xl font-bold text-white">{(tx.consumer_name || "?")[0]}</div>}
          </div>
          <p className="mt-2 font-semibold text-white">{tx.consumer_name}</p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-off-success/15 px-3 py-0.5 text-xs font-bold text-off-success"><ShieldCheck className="h-3 w-3" /> ASSINANTE ATIVO</span>
          <p className="mt-1 text-xs text-gray-400">{tx.establishment_name}</p>
          <p className="mt-1 text-xs text-gray-500"><LiveClock /></p>
        </div>
        <div className="space-y-2 p-5 text-sm">
          <Row label="Valor total da compra" value={money(tx.gross_amount)} />
          <Row label={`Desconto (${tx.discount_percent}%)`} value={`- ${money(tx.discount_amount)}`} orange />
          <Row label="Valor economizado" value={money(tx.saved_amount)} orange />
          <div className="my-1 h-px bg-off-blue/40" />
          <Row label="Valor final a pagar" value={money(tx.final_amount)} big />
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-gray-500">Peça ao estabelecimento para confirmar em sua conta. Esta tela atualiza automaticamente.</p>
    </div>
  );
}

function Row({ label, value, orange, big }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={`${big ? "font-display text-lg font-bold text-white" : orange ? "font-semibold text-off-orange" : "font-medium text-white"}`}>{value}</span>
    </div>
  );
}
