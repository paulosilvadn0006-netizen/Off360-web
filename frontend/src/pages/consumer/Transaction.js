import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, money, fmtDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, ShieldCheck, Timer, Sparkles } from "lucide-react";
import { toast } from "sonner";

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span data-testid="live-clock">{now.toLocaleTimeString("pt-BR")}</span>;
}

function Countdown({ expiresAt, onExpire }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const calc = () => Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    setLeft(calc());
    const t = setInterval(() => { const l = calc(); setLeft(l); if (l <= 0) { onExpire?.(); clearInterval(t); } }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]); // eslint-disable-line
  const m = String(Math.floor(left / 60)).padStart(2, "0");
  const s = String(left % 60).padStart(2, "0");
  return <span data-testid="countdown" className="font-mono">{m}:{s}</span>;
}

function Row({ label, value, orange, big }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={`${big ? "font-display text-lg font-bold text-white" : orange ? "font-semibold text-off-orange" : "font-medium text-white"}`}>{value}</span>
    </div>
  );
}

export default function Transaction() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tx, setTx] = useState(null);
  const [expired, setExpired] = useState(false);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef(null);
  const pollCount = useRef(0);

  const load = async () => {
    try { const { data } = await api.get(`/consumer/transactions/${id}`); setTx(data); return data; }
    catch { navigate("/home"); return null; }
  };

  useEffect(() => {
    let mounted = true;
    const stop = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    load().then((t) => {
      if (!mounted || !t) return;
      const controlledWaiting = t.status === "pending_validation" && (t.validation_mode || "controlled") === "controlled";
      if (controlledWaiting) {
        pollRef.current = setInterval(async () => {
          pollCount.current += 1;
          if (document.hidden) return;                 // pause polling on hidden tab
          if (pollCount.current > 45) { stop(); return; } // hard cap (~2.5 min) to avoid runaway polling
          const d = await load();
          if (!d || d.status !== "pending_validation") stop();
        }, 3000);
      }
    });
    return () => { mounted = false; stop(); };
  }, [id]); // eslint-disable-line

  if (!tx) return <Loading />;
  const mode = tx.validation_mode || "controlled";

  const calcPreview = () => {
    const gross = parseFloat(String(amount).replace(",", ".")) || 0;
    let d = gross * (tx.discount_percent || 0) / 100;
    if (tx.discount_max_cap != null && d > tx.discount_max_cap) d = tx.discount_max_cap;
    return { gross, discount: d, final: gross - d };
  };

  const fastConfirm = async () => {
    const val = parseFloat(String(amount).replace(",", "."));
    if (!val || val <= 0) { toast.error("Informe o valor total da compra"); return; }
    setSubmitting(true);
    try { const { data } = await api.post(`/consumer/transactions/${id}/fast-confirm`, { gross_amount: val }); setTx(data); }
    catch (err) { toast.error(formatApiError(err)); }
    finally { setSubmitting(false); }
  };

  // ---------- CONFIRMED ----------
  if (tx.status === "confirmed") {
    const isFast = mode === "fast" || tx.origin === "fast_mode";
    if (isFast) {
      const expiresAt = new Date(tx.confirmed_at).getTime() + 120000;
      return (
        <div className="fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto bg-off-bg px-6 py-8 text-center" data-testid="benefit-screen">
          <div className="animate-benefit-pulse flex items-center gap-2 rounded-full bg-off-success/15 px-5 py-2 text-sm font-bold text-off-success"><Sparkles className="h-4 w-4" /> BENEFÍCIO LIBERADO</div>
          <div className="mt-4 h-20 w-20 overflow-hidden rounded-full border-4 border-off-orange off-gradient">
            {user?.photo_url || tx.consumer_photo ? <img alt="" src={fileUrl(user?.photo_url || tx.consumer_photo)} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center font-display text-2xl font-bold text-white">{(tx.consumer_name || "?")[0]}</div>}
          </div>
          <p className="mt-2 font-display text-lg font-bold text-white">{tx.consumer_name}</p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-off-success/15 px-3 py-0.5 text-xs font-bold text-off-success"><ShieldCheck className="h-3 w-3" /> ASSINATURA ATIVA</span>
          <p className="mt-3 font-display text-xl font-extrabold text-white">{tx.establishment_name}</p>
          <div className="mt-4 w-full max-w-sm space-y-2 off-card p-5 text-sm">
            <Row label="Valor original" value={money(tx.gross_amount)} />
            <Row label={`Desconto (${tx.discount_percent}%)`} value={`- ${money(tx.discount_amount)}`} orange />
            <Row label="Você economiza" value={money(tx.saved_amount)} orange />
            <div className="my-1 h-px bg-off-blue/40" />
            <Row label="Valor a pagar" value={money(tx.final_amount)} big />
          </div>
          <div className="mt-4 grid w-full max-w-sm grid-cols-2 gap-3">
            <div className="off-card p-4"><p className="text-[11px] text-gray-500">Código único</p><p className="font-mono text-lg font-bold text-white">{tx.transaction_code}</p></div>
            <div className="off-card p-4"><p className="text-[11px] text-gray-500">Expira em</p><p className="text-lg font-bold text-off-warning"><Countdown expiresAt={expiresAt} /></p></div>
          </div>
          <p className="mt-3 text-xs text-gray-500">Hora atual: <LiveClock /> · {fmtDate(tx.confirmed_at, false)}</p>
          <div className="mt-4 rounded-2xl bg-off-success/10 px-5 py-3 text-sm text-off-success">Mostre esta tela ao caixa. O valor a pagar é <b>{money(tx.final_amount)}</b>.</div>
          <Button onClick={() => navigate("/economy")} className="mt-5 h-11 w-full max-w-sm rounded-xl off-gradient font-semibold text-white">Concluir</Button>
        </div>
      );
    }
    // controlled confirmed
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center animate-fade-up">
        <div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-off-success/20"><CheckCircle2 className="h-14 w-14 text-off-success" /></div>
        <h1 data-testid="tx-confirmed" className="mt-5 font-display text-2xl font-extrabold text-off-success">TRANSAÇÃO CONFIRMADA</h1>
        <p className="mt-2 text-sm text-gray-300">{tx.consumer_name}</p>
        <p className="font-semibold text-white">{tx.establishment_name}</p>
        <div className="mt-6 w-full max-w-sm space-y-2 off-card p-5 text-sm">
          <Row label="Código da transação" value={tx.transaction_code} />
          <Row label="Valor original" value={money(tx.gross_amount)} />
          <Row label={`Desconto (${tx.discount_percent}%)`} value={`- ${money(tx.discount_amount)}`} orange />
          <Row label="Você economizou" value={money(tx.saved_amount)} orange />
          <div className="my-1 h-px bg-off-blue/40" />
          <Row label="Valor final" value={money(tx.final_amount)} big />
          <Row label="Confirmada em" value={fmtDate(tx.confirmed_at)} />
        </div>
        <div className="mt-5 rounded-2xl bg-off-success/10 px-5 py-3 text-sm text-off-success">Você economizou <b>{money(tx.saved_amount)}</b> na <b>{tx.establishment_name}</b>.</div>
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

  if (expired) {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
        <Timer className="h-12 w-12 text-off-warning" />
        <h1 className="mt-4 font-display text-xl font-bold text-off-warning">Sessão expirada</h1>
        <p className="mt-2 text-sm text-gray-400">O tempo para validação terminou. Escaneie o QR Code novamente.</p>
        <Button onClick={() => navigate("/scan")} className="mt-6 rounded-xl off-gradient px-8 font-semibold text-white">Escanear de novo</Button>
      </div>
    );
  }

  // ---------- FAST MODE: consumer enters the amount ----------
  if (mode === "fast") {
    const c = calcPreview();
    return (
      <div className="min-h-screen px-4 py-8 animate-fade-up" data-testid="fast-amount-screen">
        <div className="mx-auto max-w-sm">
          <div className="text-center">
            <Sparkles className="mx-auto h-10 w-10 text-off-orange" />
            <h1 className="mt-2 font-display text-xl font-bold text-white">{tx.establishment_name}</h1>
            <p className="text-sm text-off-orange">{tx.discount_percent}% de desconto</p>
          </div>
          <div className="mt-5 off-card p-5">
            <label className="text-sm text-gray-300">Digite o valor total da compra</label>
            <div className="mt-1 flex items-center rounded-xl border border-off-blue/40 bg-off-bg px-3">
              <span className="text-sm font-bold text-gray-400">R$</span>
              <Input data-testid="fast-amount-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className="h-12 border-0 bg-transparent text-lg font-bold text-white focus-visible:ring-0" />
            </div>
            {tx.discount_min_purchase ? <p className="mt-1 text-[11px] text-gray-500">Compra mínima: {money(tx.discount_min_purchase)}</p> : null}
            {c.gross > 0 && (
              <div className="mt-4 space-y-2 rounded-xl bg-off-bg/60 p-3 text-sm" data-testid="fast-summary">
                <Row label="Valor original" value={money(c.gross)} />
                <Row label={`Desconto (${tx.discount_percent}%)`} value={`- ${money(c.discount)}`} orange />
                <Row label="Valor a pagar" value={money(c.final)} big />
              </div>
            )}
            <Button data-testid="fast-confirm-btn" disabled={submitting} onClick={fastConfirm} className="mt-4 h-12 w-full rounded-xl off-gradient font-semibold text-white">{submitting ? "Gerando..." : "Confirmar valor"}</Button>
            <p className="mt-2 text-center text-[11px] text-gray-500">Após confirmar, o valor não poderá ser alterado.</p>
          </div>
        </div>
      </div>
    );
  }

  // ---------- CONTROLLED: waiting for merchant ----------
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto bg-off-bg px-6 py-8 text-center" data-testid="benefit-screen">
      <div className="animate-benefit-pulse flex items-center gap-2 rounded-full bg-off-success/15 px-5 py-2 text-sm font-bold text-off-success"><Sparkles className="h-4 w-4" /> BENEFÍCIO LIBERADO</div>
      <div className="mt-6 h-24 w-24 overflow-hidden rounded-full border-4 border-off-orange off-gradient">
        {user?.photo_url || tx.consumer_photo ? <img alt="" src={fileUrl(user?.photo_url || tx.consumer_photo)} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center font-display text-3xl font-bold text-white">{(tx.consumer_name || "?")[0]}</div>}
      </div>
      <p className="mt-3 font-display text-xl font-bold text-white">{tx.consumer_name}</p>
      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-off-success/15 px-3 py-0.5 text-xs font-bold text-off-success"><ShieldCheck className="h-3 w-3" /> ASSINATURA ATIVA</span>
      <div className="mt-6 w-full max-w-sm rounded-3xl border border-off-orange/40 bg-off-surface p-6">
        <p className="text-sm text-gray-400">Benefício em</p>
        <h2 className="font-display text-2xl font-extrabold text-white">{tx.establishment_name}</h2>
        <div className="mt-3 inline-flex animate-benefit-pulse items-center rounded-2xl bg-off-orange/20 px-5 py-2">
          <span className="font-display text-3xl font-extrabold text-off-orange">{tx.discount_percent}%</span>
          <span className="ml-2 text-sm font-semibold text-off-orange">de desconto</span>
        </div>
        {(tx.discount_min_purchase || tx.discount_max_cap || tx.discount_rules) && (
          <div className="mt-3 space-y-0.5 text-xs text-gray-300">
            {tx.discount_min_purchase ? <p>Compra mínima: {money(tx.discount_min_purchase)}</p> : null}
            {tx.discount_max_cap ? <p>Desconto máximo: {money(tx.discount_max_cap)}</p> : null}
            {tx.discount_rules ? <p>{tx.discount_rules}</p> : null}
          </div>
        )}
      </div>
      <div className="mt-5 grid w-full max-w-sm grid-cols-2 gap-3">
        <div className="off-card p-4"><p className="text-[11px] text-gray-500">Código temporário</p><p className="font-mono text-lg font-bold text-white">{tx.transaction_code}</p></div>
        <div className="off-card p-4"><p className="text-[11px] text-gray-500">Expira em</p><p className="text-lg font-bold text-off-warning"><Countdown expiresAt={tx.token_expires_at} onExpire={() => setExpired(true)} /></p></div>
      </div>
      <p className="mt-3 text-xs text-gray-500">Hora atual: <LiveClock /> · {fmtDate(tx.created_at, false)}</p>
      <div className="mt-5 rounded-2xl bg-off-warning/10 px-5 py-3 text-sm text-off-warning">Mostre esta tela ao balconista. Ele registrará o valor da compra e confirmará a transação.</div>
    </div>
  );
}
