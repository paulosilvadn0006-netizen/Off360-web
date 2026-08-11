import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, fmtDate, EmptyState } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { ScrollText } from "lucide-react";

export default function Audit() {
  const { data, isLoading } = useQuery({ queryKey: ["a-audit"], queryFn: async () => (await api.get("/admin/audit")).data });
  if (isLoading) return <Loading />;

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Auditoria" subtitle="Registro de todas as ações administrativas." />
      {data?.length ? (
        <div className="space-y-2" data-testid="audit-list">
          {data.map((a) => (
            <div key={a.id} className="off-card flex items-start gap-3 p-4">
              <div className="rounded-lg bg-off-orange/15 p-2"><ScrollText className="h-4 w-4 text-off-orange" /></div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{a.action_type} <span className="text-gray-500">· {a.record}</span></p>
                <p className="text-xs text-gray-400">por {a.actor_name} — {fmtDate(a.created_at)}</p>
                {(a.before || a.after) && <p className="mt-1 font-mono text-[10px] text-gray-600">{JSON.stringify(a.after)}</p>}
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState icon={ScrollText} title="Sem registros" subtitle="As ações administrativas aparecerão aqui." />}
    </div>
  );
}
