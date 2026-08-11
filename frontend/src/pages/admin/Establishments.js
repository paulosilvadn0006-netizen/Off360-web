import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading, StatusPill } from "@/components/shared";
import { AdminHeader, AdminTable } from "@/pages/admin/_components";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";

export default function Establishments() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["a-ests", filter], queryFn: async () => (await api.get("/admin/establishments", { params: { status: filter || undefined } })).data });

  const approve = async (id, s) => { try { await api.post(`/admin/establishments/${id}/approve`, { approval_status: s }); toast.success("Atualizado"); qc.invalidateQueries({ queryKey: ["a-ests"] }); } catch (e) { toast.error(formatApiError(e)); } };
  const regenQr = async (id) => { await api.post(`/admin/establishments/${id}/regenerate-qr`); toast.success("QR Code regenerado"); };

  const columns = [
    { key: "fantasy_name", label: "Estabelecimento", render: (r) => <span className="font-medium text-white">{r.fantasy_name}</span> },
    { key: "category_name", label: "Categoria" },
    { key: "neighborhood", label: "Bairro" },
    { key: "discount_percent", label: "Desconto", render: (r) => `${r.discount_percent}%` },
    { key: "approval_status", label: "Status", render: (r) => <StatusPill status={r.approval_status} /> },
    {
      key: "actions", label: "Ações", render: (r) => (
        <div className="flex gap-1">
          {r.approval_status !== "approved" && <button data-testid={`approve-${r.id}`} onClick={() => approve(r.id, "approved")} className="rounded-lg bg-off-success/15 p-1.5 text-off-success"><CheckCircle2 className="h-4 w-4" /></button>}
          {r.approval_status !== "rejected" && <button data-testid={`reject-est-${r.id}`} onClick={() => approve(r.id, "rejected")} className="rounded-lg bg-off-error/15 p-1.5 text-off-error"><XCircle className="h-4 w-4" /></button>}
          <button onClick={() => regenQr(r.id)} className="rounded-lg bg-off-blue/20 p-1.5 text-off-orange"><RefreshCw className="h-4 w-4" /></button>
        </div>
      )
    },
  ];

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Estabelecimentos" subtitle="Aprovação e moderação de estabelecimentos." />
      <div className="mb-4 flex gap-2">
        {[["", "Todos"], ["pending", "Aguardando"], ["approved", "Aprovados"], ["rejected", "Reprovados"]].map(([v, l]) => (
          <Button key={v} data-testid={`est-filter-${v || "all"}`} onClick={() => setFilter(v)} variant={filter === v ? "default" : "outline"} className={`rounded-full ${filter === v ? "off-gradient text-white" : "border-off-blue/40 text-gray-300"}`}>{l}</Button>
        ))}
      </div>
      {isLoading ? <Loading /> : <AdminTable columns={columns} rows={data || []} testid="establishments-table" />}
    </div>
  );
}
