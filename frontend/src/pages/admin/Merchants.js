import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading, money, fmtDate, EmptyState } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Store, CheckCircle2, PauseCircle, Trash2 } from "lucide-react";

export default function Merchants() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["a-merchants"], queryFn: async () => (await api.get("/admin/merchants")).data });
  if (isLoading) return <Loading />;

  const act = async (m, action) => {
    setBusy(m.id);
    try {
      await api.post(`/admin/merchants/${m.id}/${action}`);
      toast.success(action === "activate" ? "Conta empresarial ativada" : "Conta empresarial bloqueada");
      qc.invalidateQueries({ queryKey: ["a-merchants"] });
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(null); }
  };

  const del = async (m) => {
    setBusy(m.id);
    try {
      await api.delete(`/admin/merchants/${m.id}`);
      toast.success("Conta empresarial apagada permanentemente");
      qc.invalidateQueries({ queryKey: ["a-merchants"] });
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(null); }
  };

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Empresários" subtitle="Uma conta por empresário — com suas unidades vinculadas." />
      {data?.length ? (
        <div className="off-card overflow-x-auto" data-testid="merchants-table">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-off-blue/30 text-xs text-gray-400">
              <th className="px-4 py-3">Responsável</th><th className="px-4 py-3">E-mail</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Estabelecimentos</th><th className="px-4 py-3">Ativos</th><th className="px-4 py-3">Mensalidade</th><th className="px-4 py-3">Ações</th>
            </tr></thead>
            <tbody>
              {data.map((m) => {
                const active = m.account_status !== "suspended";
                return (
                  <tr key={m.id} className="border-b border-off-blue/15" data-testid={`merchant-row-${m.id}`}>
                    <td className="px-4 py-3 font-medium text-white">{m.name}</td>
                    <td className="px-4 py-3 text-gray-400">{m.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-off-success/10 text-off-success" : "bg-off-error/10 text-off-error"}`}>{active ? "Ativa" : "Bloqueada"}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{m.establishment_count}</td>
                    <td className="px-4 py-3 text-off-success">{m.active_count}</td>
                    <td className="px-4 py-3 text-gray-300">{m.monthly_total != null ? money(m.monthly_total) : "A definir"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {active ? (
                          <Button data-testid={`suspend-merchant-${m.id}`} disabled={busy === m.id} onClick={() => act(m, "suspend")} variant="outline" className="h-9 rounded-lg border-off-error/50 text-xs font-semibold text-off-error hover:bg-off-error/10"><PauseCircle className="mr-1 h-4 w-4" /> BLOQUEAR</Button>
                        ) : (
                          <Button data-testid={`activate-merchant-${m.id}`} disabled={busy === m.id} onClick={() => act(m, "activate")} className="h-9 rounded-lg bg-off-success text-xs font-semibold text-white hover:bg-off-success/90"><CheckCircle2 className="mr-1 h-4 w-4" /> {m.account_status === "suspended" ? "DESBLOQUEAR" : "ATIVAR CONTA EMPRESARIAL"}</Button>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button data-testid={`delete-merchant-${m.id}`} disabled={busy === m.id} className="h-9 rounded-lg bg-off-error text-xs font-semibold text-white hover:bg-off-error/90"><Trash2 className="mr-1 h-4 w-4" /> DELETAR</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="border-off-error/40 bg-off-surface text-white" data-testid={`delete-merchant-dialog-${m.id}`}>
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">Apagar a conta de {m.name}?</AlertDialogTitle>
                              <AlertDialogDescription className="text-gray-400">
                                Esta ação é <b className="text-off-error">permanente</b>. A conta e <b>todos os estabelecimentos, catálogos, stories, destaques e pedidos</b> deste empresário serão apagados. Não é possível recuperar.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid={`delete-merchant-cancel-${m.id}`} className="border-off-blue/40 bg-transparent text-gray-300 hover:bg-off-bg">Cancelar</AlertDialogCancel>
                              <AlertDialogAction data-testid={`delete-merchant-confirm-${m.id}`} onClick={() => del(m)} className="bg-off-error text-white hover:bg-off-error/90">Sim, apagar permanentemente</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon={Store} title="Nenhum empresário" subtitle="Sem registros." />}
    </div>
  );
}
