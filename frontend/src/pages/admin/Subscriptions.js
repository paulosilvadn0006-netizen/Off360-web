import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading, SubscriptionBadge, money, fmtDate, EmptyState } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Search, Layers } from "lucide-react";

export default function Subscriptions() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [confirm, setConfirm] = useState(null); // {row, action}
  const { data, isLoading } = useQuery({
    queryKey: ["a-subs", q, type, status],
    queryFn: async () => (await api.get("/admin/subscriptions", { params: { q: q || undefined, type: type === "all" ? undefined : type, status: status === "all" ? undefined : status } })).data,
  });

  const doAction = async () => {
    const { row, action } = confirm;
    try {
      if (row.kind === "consumer") {
        if (action === "activate") await api.post(`/admin/consumers/${row.id}/activate`);
        else await api.put(`/admin/consumers/${row.id}`, { subscription_status: "suspended", account_status: "suspended" });
      } else {
        if (action === "activate") await api.post(`/admin/establishments/${row.id}/activate`);
        else await api.post(`/admin/establishments/${row.id}/suspend`);
      }
      toast.success(action === "activate" ? "Ativado com sucesso" : "Suspenso com sucesso");
      qc.invalidateQueries({ queryKey: ["a-subs"] });
    } catch (err) { toast.error(formatApiError(err)); } finally { setConfirm(null); }
  };

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Assinaturas" subtitle="Consumidores e estabelecimentos — dados reais do banco." />
      {!data?.prices_configured && (
        <div className="mb-4 rounded-2xl border border-off-warning/40 bg-off-warning/10 p-3 text-sm text-off-warning">Valores dos planos ainda não definidos. Configure em <b>Configurações</b>. Exibindo "A definir".</div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-off-blue/40 bg-off-surface px-3">
          <Search className="h-4 w-4 text-gray-500" />
          <Input data-testid="sub-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar assinante, e-mail ou empresário" className="h-11 border-0 bg-transparent text-white focus-visible:ring-0" />
        </div>
        <Select value={type} onValueChange={setType}><SelectTrigger data-testid="sub-type" className="h-11 w-48 rounded-xl border-off-blue/40 bg-off-surface text-white"><SelectValue /></SelectTrigger>
          <SelectContent className="border-off-blue/40 bg-off-surface text-white"><SelectItem value="all">Todos os tipos</SelectItem><SelectItem value="consumer">Consumidores</SelectItem><SelectItem value="establishment">Estabelecimentos</SelectItem></SelectContent></Select>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-11 w-40 rounded-xl border-off-blue/40 bg-off-surface text-white"><SelectValue /></SelectTrigger>
          <SelectContent className="border-off-blue/40 bg-off-surface text-white">{["all", "active", "pending", "suspended", "expired", "cancelled", "inactive"].map((s) => <SelectItem key={s} value={s}>{s === "all" ? "Todos os status" : s}</SelectItem>)}</SelectContent></Select>
      </div>

      {isLoading ? <Loading /> : (data?.rows?.length ? (
        <div className="off-card overflow-x-auto" data-testid="subscriptions-table">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-off-blue/30 text-xs text-gray-400">
              <th className="px-4 py-3">Assinante</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Empresário</th><th className="px-4 py-3">Contato</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3">Valor</th><th className="px-4 py-3">Ações</th>
            </tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.kind + r.id} className="border-b border-off-blue/15">
                  <td className="px-4 py-3 font-medium text-white">{r.subscriber_name}</td>
                  <td className="px-4 py-3 text-gray-300">{r.kind === "consumer" ? "Consumidor" : "Estabelecimento"}</td>
                  <td className="px-4 py-3 text-gray-400">{r.merchant_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-400">{r.email}</td>
                  <td className="px-4 py-3"><SubscriptionBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-gray-400">{r.next_due ? fmtDate(r.next_due, false) : "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{r.value != null ? money(r.value) : "A definir"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {r.status !== "active" && <Button data-testid={`sub-activate-${r.id}`} onClick={() => setConfirm({ row: r, action: "activate" })} className="h-8 rounded-lg bg-off-success px-3 text-xs font-semibold text-white hover:bg-off-success/90">Ativar</Button>}
                      {r.status === "active" && <Button data-testid={`sub-suspend-${r.id}`} onClick={() => setConfirm({ row: r, action: "suspend" })} variant="outline" className="h-8 rounded-lg border-off-error/50 px-3 text-xs text-off-error">Suspender</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon={Layers} title="Nenhuma assinatura" subtitle="Ajuste os filtros." />)}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="border-off-blue/40 bg-off-surface text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.action === "activate" ? "Ativar assinatura" : "Suspender assinatura"}</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              {confirm && (<>
                <span className="block">Tipo: <b className="text-white">{confirm.row.kind === "consumer" ? "Consumidor" : "Estabelecimento"}</b></span>
                <span className="block">Assinante: <b className="text-white">{confirm.row.subscriber_name}</b></span>
                {confirm.row.merchant_name && <span className="block">Empresário: <b className="text-white">{confirm.row.merchant_name}</b></span>}
                <span className="block">Status atual: <b className="text-white">{confirm.row.status}</b> → Novo: <b className="text-white">{confirm.action === "activate" ? "active" : "suspended"}</b></span>
                <span className="mt-2 block text-xs">{confirm.action === "activate" ? "Libera scanner/QR Code e transações e define novo vencimento." : "Impede novas transações desta assinatura. Não afeta as demais unidades."}</span>
              </>)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-off-blue/40 bg-transparent text-white">Cancelar</AlertDialogCancel>
            <AlertDialogAction data-testid="confirm-action" onClick={doAction} className="off-gradient text-white">Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
