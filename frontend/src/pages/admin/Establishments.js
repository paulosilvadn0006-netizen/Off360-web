import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading, StatusPill, SubscriptionBadge, fmtDate, EmptyState } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { MapPin } from "lucide-react";

export default function Establishments() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [confirm, setConfirm] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["a-ests", filter], queryFn: async () => (await api.get("/admin/establishments", { params: { status: filter || undefined } })).data });

  const run = async () => {
    const { row, action } = confirm;
    try {
      if (action === "activate") await api.post(`/admin/establishments/${row.id}/activate`);
      else if (action === "suspend") await api.post(`/admin/establishments/${row.id}/suspend`);
      else if (action === "reject") await api.post(`/admin/establishments/${row.id}/approve`, { approval_status: "rejected" });
      toast.success("Ação realizada");
      qc.invalidateQueries({ queryKey: ["a-ests"] });
    } catch (err) { toast.error(formatApiError(err)); } finally { setConfirm(null); }
  };

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Estabelecimentos" subtitle="Cada unidade vinculada ao seu empresário responsável." />
      <div className="mb-4 flex flex-wrap gap-2">
        {[["", "Todos"], ["pending", "Aguardando"], ["approved", "Aprovados"], ["rejected", "Reprovados"]].map(([v, l]) => (
          <Button key={v} data-testid={`est-filter-${v || "all"}`} onClick={() => setFilter(v)} variant={filter === v ? "default" : "outline"} className={`rounded-full ${filter === v ? "off-gradient text-white" : "border-off-blue/40 text-gray-300"}`}>{l}</Button>
        ))}
      </div>

      {isLoading ? <Loading /> : (data?.length ? (
        <div className="off-card overflow-x-auto" data-testid="establishments-table">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-off-blue/30 text-xs text-gray-400">
              <th className="px-4 py-3">Estabelecimento</th><th className="px-4 py-3">Responsável</th><th className="px-4 py-3">Bairro</th><th className="px-4 py-3">Desconto</th><th className="px-4 py-3">Assinatura</th><th className="px-4 py-3">Cadastro</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3">Ações</th>
            </tr></thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-b border-off-blue/15">
                  <td className="px-4 py-3 font-medium text-white">{e.fantasy_name}</td>
                  <td className="px-4 py-3 text-gray-400">{e.responsible_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-400">{e.neighborhood || "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{e.discount_configured ? `${e.discount_percent}%` : <span className="text-off-warning">Não configurado</span>}</td>
                  <td className="px-4 py-3"><SubscriptionBadge status={e.subscription_status} /></td>
                  <td className="px-4 py-3"><StatusPill status={e.approval_status} /></td>
                  <td className="px-4 py-3 text-gray-400">{e.next_due ? fmtDate(e.next_due, false) : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {e.subscription_status !== "active" && <Button data-testid={`activate-est-${e.id}`} onClick={() => setConfirm({ row: e, action: "activate" })} className="h-8 rounded-lg bg-off-success px-3 text-xs font-semibold text-white hover:bg-off-success/90">Ativar</Button>}
                      {e.subscription_status === "active" && <Button data-testid={`suspend-est-${e.id}`} onClick={() => setConfirm({ row: e, action: "suspend" })} variant="outline" className="h-8 rounded-lg border-off-error/50 px-3 text-xs text-off-error">Suspender</Button>}
                      {e.approval_status !== "rejected" && <Button onClick={() => setConfirm({ row: e, action: "reject" })} variant="outline" className="h-8 rounded-lg border-off-blue/40 px-3 text-xs text-gray-300">Reprovar</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon={MapPin} title="Nenhum estabelecimento" subtitle="Ajuste os filtros." />)}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="border-off-blue/40 bg-off-surface text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.action === "activate" ? "Ativar estabelecimento" : confirm?.action === "suspend" ? "Suspender estabelecimento" : "Reprovar estabelecimento"}</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              {confirm && (<>
                <span className="block">Empresário: <b className="text-white">{confirm.row.responsible_name || "—"}</b></span>
                <span className="block">Estabelecimento: <b className="text-white">{confirm.row.fantasy_name}</b></span>
                <span className="block">Status atual: <b className="text-white">{confirm.row.subscription_status}</b></span>
                <span className="mt-2 block text-xs">{confirm.action === "activate" ? "Ativa a assinatura desta unidade, aprova e libera o QR Code (se o desconto estiver configurado). Afeta apenas este estabelecimento." : confirm.action === "suspend" ? "Impede novas transações apenas deste estabelecimento." : "Marca o cadastro como reprovado."}</span>
              </>)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-off-blue/40 bg-transparent text-white">Cancelar</AlertDialogCancel>
            <AlertDialogAction data-testid="confirm-est-action" onClick={run} className="off-gradient text-white">Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
