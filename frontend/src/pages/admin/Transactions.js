import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Loading, money, fmtDate, StatusPill } from "@/components/shared";
import { AdminHeader, AdminTable } from "@/pages/admin/_components";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";

export default function Transactions() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["a-tx", status], queryFn: async () => (await api.get("/admin/transactions", { params: { status: status || undefined } })).data });

  const cancel = async (id) => { await api.post(`/admin/transactions/${id}/cancel`); toast.success("Transação cancelada"); qc.invalidateQueries({ queryKey: ["a-tx"] }); };

  const columns = [
    { key: "transaction_code", label: "Código", render: (r) => <span className="font-mono text-xs text-off-orange">{r.transaction_code}</span> },
    { key: "created_at", label: "Data", render: (r) => fmtDate(r.created_at) },
    { key: "establishment_name", label: "Estabelecimento" },
    { key: "consumer_name", label: "Consumidor" },
    { key: "gross_amount", label: "Bruto", render: (r) => money(r.gross_amount) },
    { key: "final_amount", label: "Final", render: (r) => money(r.final_amount) },
    { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
    { key: "actions", label: "", render: (r) => r.status === "confirmed" || r.status === "awaiting_confirmation" ? <button data-testid={`cancel-tx-${r.id}`} onClick={() => cancel(r.id)} className="text-off-error"><Ban className="h-4 w-4" /></button> : null },
  ];

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Transações" subtitle="Todas as transações da plataforma." />
      <div className="mb-4 flex gap-2">
        {[["", "Todas"], ["confirmed", "Confirmadas"], ["awaiting_confirmation", "Aguardando"], ["cancelled", "Canceladas"]].map(([v, l]) => (
          <Button key={v} onClick={() => setStatus(v)} variant={status === v ? "default" : "outline"} className={`rounded-full ${status === v ? "off-gradient text-white" : "border-off-blue/40 text-gray-300"}`}>{l}</Button>
        ))}
      </div>
      {isLoading ? <Loading /> : <AdminTable columns={columns} rows={data || []} testid="admin-tx-table" />}
    </div>
  );
}
