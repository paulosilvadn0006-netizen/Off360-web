import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, fmtDate, EmptyState } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { Lock, CheckCircle2, AlertTriangle, CreditCard, QrCode } from "lucide-react";

const money = (v) => (v == null ? "R$ 89,90" : `R$ ${Number(v).toFixed(2).replace(".", ",")}`);

function dueInfo(next_due) {
  if (!next_due) return { label: "—", cls: "text-gray-400" };
  const d = new Date(next_due);
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (isNaN(d.getTime())) return { label: "—", cls: "text-gray-400" };
  const base = fmtDate(next_due);
  if (days < 0) return { label: `${base} (vencido)`, cls: "text-off-error" };
  if (days <= 3) return { label: `${base} (em ${days}d)`, cls: "text-off-warning" };
  return { label: base, cls: "text-gray-300" };
}

function Row({ r }) {
  const due = dueInfo(r.next_due);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-off-blue/30 bg-off-surface p-3" data-testid={`act-row-${r.id}`}>
      <div className="min-w-0">
        <p className="truncate font-display font-bold text-white">{r.fantasy_name || "—"}</p>
        <p className="truncate text-xs text-gray-400">{r.razao_social || "—"} · CNPJ {r.cnpj || "—"} · {r.city || "—"}{r.uf ? `/${r.uf}` : ""}</p>
        <p className="truncate text-[11px] text-gray-500">{r.owner_name || "—"} · {r.owner_email || "—"}</p>
      </div>
      <div className="text-right text-xs">
        <p className="text-gray-400">Mensalidade <b className="text-white">{money(r.plan_price)}</b></p>
        <p className={due.cls}>Vencimento: {due.label}</p>
        {r.payment_method && <p className="text-[11px] text-gray-500">via {r.payment_method === "pix" ? "Pix" : "Cartão"}</p>}
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, cls, rows, testid, empty }) {
  return (
    <div className="mt-5" data-testid={testid}>
      <div className={`mb-2 flex items-center gap-2 ${cls}`}>
        <Icon className="h-4 w-4" />
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">{title} <span className="opacity-70">({rows.length})</span></h2>
      </div>
      {rows.length === 0 ? <p className="rounded-xl border border-off-blue/20 bg-off-bg/40 p-3 text-xs text-gray-500">{empty}</p>
        : <div className="space-y-2">{rows.map((r) => <Row key={r.id} r={r} />)}</div>}
    </div>
  );
}

export default function Activations() {
  const { data, isLoading } = useQuery({ queryKey: ["a-merchant-subs"], queryFn: async () => (await api.get("/admin/merchant-subscriptions")).data, refetchInterval: 20000 });
  if (isLoading || !data) return <Loading />;
  const rows = data.rows || [];
  const awaiting = rows.filter((r) => r.bucket === "awaiting");
  const active = rows.filter((r) => r.bucket === "active");
  const expired = rows.filter((r) => r.bucket === "expired");

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Ativações" subtitle="Quem está aguardando pagamento, quem já ativou e os vencidos (R$ 89,90/mês)." />
      {rows.length === 0 ? (
        <EmptyState icon={QrCode} title="Nenhuma empresa cadastrada" subtitle="Assim que empresários cadastrarem empresas, elas aparecem aqui." />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="off-card p-4" data-testid="act-count-awaiting"><div className="flex items-center gap-2 text-off-warning"><Lock className="h-4 w-4" /><span className="text-[11px] text-gray-400">Aguardando pagamento</span></div><p className="mt-1.5 font-display text-xl font-bold text-white">{data.counts.awaiting}</p></div>
            <div className="off-card p-4" data-testid="act-count-active"><div className="flex items-center gap-2 text-off-success"><CheckCircle2 className="h-4 w-4" /><span className="text-[11px] text-gray-400">Ativos</span></div><p className="mt-1.5 font-display text-xl font-bold text-white">{data.counts.active}</p></div>
            <div className="off-card p-4" data-testid="act-count-expired"><div className="flex items-center gap-2 text-off-error"><AlertTriangle className="h-4 w-4" /><span className="text-[11px] text-gray-400">Vencidos</span></div><p className="mt-1.5 font-display text-xl font-bold text-white">{data.counts.expired}</p></div>
          </div>
          <Section title="Aguardando pagamento" icon={Lock} cls="text-off-warning" rows={awaiting} testid="act-sec-awaiting" empty="Nenhuma empresa aguardando pagamento." />
          <Section title="Ativos" icon={CreditCard} cls="text-off-success" rows={active} testid="act-sec-active" empty="Nenhuma empresa ativa ainda." />
          <Section title="Vencidos" icon={AlertTriangle} cls="text-off-error" rows={expired} testid="act-sec-expired" empty="Nenhuma empresa vencida." />
        </>
      )}
    </div>
  );
}
