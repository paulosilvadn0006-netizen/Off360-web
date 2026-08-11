import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, SubscriptionBadge, fmtDate } from "@/components/shared";
import { AdminHeader, AdminTable } from "@/pages/admin/_components";

export default function Merchants() {
  const { data, isLoading } = useQuery({ queryKey: ["a-merchants"], queryFn: async () => (await api.get("/admin/merchants")).data });
  if (isLoading) return <Loading />;

  const columns = [
    { key: "name", label: "Responsável", render: (r) => <span className="font-medium text-white">{r.name}</span> },
    { key: "establishment", label: "Estabelecimento", render: (r) => r.establishment?.fantasy_name || "-" },
    { key: "category", label: "Categoria", render: (r) => r.establishment?.category_name || "-" },
    { key: "approval", label: "Aprovação", render: (r) => <SubscriptionBadge status={r.establishment?.approval_status === "approved" ? "active" : r.establishment?.approval_status === "pending" ? "pending" : "inactive"} /> },
    { key: "subscription_status", label: "Assinatura", render: (r) => <SubscriptionBadge status={r.subscription_status} /> },
    { key: "created_at", label: "Cadastro", render: (r) => fmtDate(r.created_at, false) },
  ];

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Empresários" subtitle="Contas de empresários e prestadores." />
      <AdminTable columns={columns} rows={data || []} testid="merchants-table" />
    </div>
  );
}
