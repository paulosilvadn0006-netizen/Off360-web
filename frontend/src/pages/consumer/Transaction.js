import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, money, fmtDate } from "@/components/shared";
import { fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ShieldCheck, Timer, Sparkles } from "lucide-react";

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

export default function Transaction() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tx, setTx] = useState(null);
  const [expired, setExpired] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try { const { data } = await api.get(`/consumer/transactions/${id}`); if (mounted) setTx(data); return data; }
      catch { navigate("/home"); }
    };
    load().then((t) => {
      if (t && t.status === "pending_validation") {
        pollRef.current = setInterval(async () => {
          const d = await load();
          if (d && d.status !== "pending_validation") clearInterval(pollRef.current);
        }, 2500);
      }
    });
    return () => { mounted = false; pollRef.current && clearInterval(pollRef.current); };
  }, [id]); // eslint-disable-line

  if (!tx) return <Loading />;

  // ---- confirmed ----
  if (tx.status === "confirmed") {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center animate-fade-up">
        <div className="animate-pop flex h-24 w-24 items-center justify-center rounded-full bg-off-success/20">
          <CheckCircle2 className="h-14 w-14 text-off-success" />
        </div>
        <h1 data-testid="tx-confirmed" className="mt-5 font-display text-2xl font-extrabold text-off-success">TRANSAÇÃO CONFIRMADA</h1>
        <p className="mt-2 text-sm text-gray-300">{tx.consumer_name}</p>
        <p className="font-semibold text-white">{tx.establishment_name}</p>
        <p className="mt-1 text-xs text-gray-500"><LiveClock /></p>
        <div className="mt-6 w-full max-w-sm space-y-2 off-card p-5 text-sm">
          <Row label="Código da transação" value={tx.transaction_code} />
          <Row label="Valor original" value={money(tx.gross_amount)} />
          <Row label={`Desconto (${tx.discount_percent}%)`} value={`- ${money(tx.discount_amount)}`} orange />
          <Row label="Você economizou" value={money(tx.saved_amount)} orange />
          <div className="my-1 h-px bg-off-blue/40" />
          <Row label="Valor final" value={money(tx.final_amount)} big />
          <Row label="Confirmada em" value={fmtDate(tx.confirmed_at)} />
        </div>
        <div className="mt-5 rounded-2xl bg-off-success/10 px-5 py-3 text-sm text-off-success">
          Você economizou <b>{money(tx.saved_amount)}</b> na <b>{tx.establishment_name}</b>.
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

  // ---- pending_validation: dynamic full-screen benefit unlocked ----
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto bg-off-bg px-6 py-8 text-center" data-testid="benefit-screen">
      <div className="animate-benefit-pulse flex items-center gap-2 rounded-full bg-off-success/15 px-5 py-2 text-sm font-bold text-off-success">
        <Sparkles className="h-4 w-4" /> BENEFÍCIO LIBERADO
      </div>

      <div className="mt-6 h-24 w-24 overflow-hidden rounded-full border-4 border-off-orange off-gradient">
        {user?.photo_url || tx.consumer_photo ? <img alt="" src={fileUrl(user?.photo_url || tx.consumer_photo)} className="h-full w-full object-cover" /> :
          <div className="flex h-full w-full items-center justify-center font-display text-3xl font-bold text-white">{(tx.consumer_name || "?")[0]}</div>}
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

      <div className="mt-5 rounded-2xl bg-off-warning/10 px-5 py-3 text-sm text-off-warning">
        Mostre esta tela ao balconista. Ele registrará o valor da compra e confirmará a transação.
      </div>
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
