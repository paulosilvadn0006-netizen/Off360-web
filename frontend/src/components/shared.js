import React from "react";

export function SubscriptionBadge({ status }) {
  const map = {
    active: { label: "Assinatura ativa", cls: "text-off-success bg-off-success/10 border-off-success/30" },
    pending: { label: "Pendente", cls: "text-off-warning bg-off-warning/10 border-off-warning/30" },
    inactive: { label: "Inativa", cls: "text-off-error bg-off-error/10 border-off-error/30" },
    expired: { label: "Vencida", cls: "text-off-error bg-off-error/10 border-off-error/30" },
    cancelled: { label: "Cancelada", cls: "text-off-error bg-off-error/10 border-off-error/30" },
  };
  const s = map[status] || map.pending;
  return (
    <span data-testid="subscription-badge" className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${s.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export function StatusPill({ status }) {
  const map = {
    confirmed: { label: "Confirmada", cls: "text-off-success bg-off-success/10" },
    awaiting_confirmation: { label: "Aguardando", cls: "text-off-warning bg-off-warning/10" },
    initiated: { label: "Iniciada", cls: "text-off-warning bg-off-warning/10" },
    cancelled: { label: "Cancelada", cls: "text-off-error bg-off-error/10" },
    contested: { label: "Contestada", cls: "text-off-error bg-off-error/10" },
    approved: { label: "Aprovado", cls: "text-off-success bg-off-success/10" },
    rejected: { label: "Reprovado", cls: "text-off-error bg-off-error/10" },
  };
  const s = map[status] || { label: status, cls: "text-gray-300 bg-white/10" };
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export function money(v) {
  return `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(iso, withTime = true) {
  if (!iso) return "-";
  const d = new Date(iso);
  const opts = withTime
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" };
  return d.toLocaleString("pt-BR", opts);
}

export function Loading({ label = "Carregando..." }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-gray-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-off-blue border-t-off-orange" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-off-blue/30 bg-off-surface/60 py-12 px-6 text-center">
      {Icon && <Icon className="h-10 w-10 text-off-orange/70" />}
      <p className="font-display text-lg font-semibold text-white">{title}</p>
      {subtitle && <p className="max-w-xs text-sm text-gray-400">{subtitle}</p>}
    </div>
  );
}
