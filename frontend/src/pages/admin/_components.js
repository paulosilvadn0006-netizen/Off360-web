import React from "react";

export function MetricCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="off-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        {Icon && <Icon className={`h-4 w-4 ${accent || "text-off-orange"}`} />}
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

export function AdminTable({ columns, rows, testid }) {
  return (
    <div className="off-card overflow-x-auto" data-testid={testid}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-off-blue/30 text-xs text-gray-400">
            {columns.map((c) => <th key={c.key} className="whitespace-nowrap px-4 py-3 font-semibold">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i} className="border-b border-off-blue/15 hover:bg-off-blue/10">
              {columns.map((c) => <td key={c.key} className="whitespace-nowrap px-4 py-3 text-gray-200">{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-500">Nenhum registro.</p>}
    </div>
  );
}

export function AdminHeader({ title, subtitle, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-2xl font-bold text-white">{title}</h1>{subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}</div>
      {children}
    </div>
  );
}
