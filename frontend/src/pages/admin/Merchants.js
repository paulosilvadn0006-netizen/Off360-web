import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, money, fmtDate, EmptyState } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { Store } from "lucide-react";

export default function Merchants() {
  const { data, isLoading } = useQuery({ queryKey: ["a-merchants"], queryFn: async () => (await api.get("/admin/merchants")).data });
  if (isLoading) return <Loading />;

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Empresários" subtitle="Uma conta por empresário — com suas unidades vinculadas." />
      {data?.length ? (
        <div className="off-card overflow-x-auto" data-testid="merchants-table">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-off-blue/30 text-xs text-gray-400">
              <th className="px-4 py-3">Responsável</th><th className="px-4 py-3">E-mail</th><th className="px-4 py-3">WhatsApp</th><th className="px-4 py-3">Estabelecimentos</th><th className="px-4 py-3">Ativos</th><th className="px-4 py-3">Mensalidade</th><th className="px-4 py-3">Último acesso</th>
            </tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className="border-b border-off-blue/15">
                  <td className="px-4 py-3 font-medium text-white">{m.name}</td>
                  <td className="px-4 py-3 text-gray-400">{m.email}</td>
                  <td className="px-4 py-3 text-gray-400">{m.phone || "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{m.establishment_count}</td>
                  <td className="px-4 py-3 text-off-success">{m.active_count}</td>
                  <td className="px-4 py-3 text-gray-300">{m.monthly_total != null ? money(m.monthly_total) : "A definir"}</td>
                  <td className="px-4 py-3 text-gray-400">{m.last_access ? fmtDate(m.last_access) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon={Store} title="Nenhum empresário" subtitle="Sem registros." />}
    </div>
  );
}
