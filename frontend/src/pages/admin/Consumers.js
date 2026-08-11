import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { Loading, SubscriptionBadge, money, fmtDate } from "@/components/shared";
import { AdminHeader, AdminTable } from "@/pages/admin/_components";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Eye } from "lucide-react";

const SUB_OPTS = ["active", "pending", "inactive", "expired", "cancelled"];

export default function Consumers() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["a-consumers", q, status], queryFn: async () => (await api.get("/admin/consumers", { params: { q: q || undefined, status: status || undefined } })).data });

  const update = async (id, body, action) => {
    try {
      if (action === "activate") await api.post(`/admin/consumers/${id}/activate`);
      else await api.put(`/admin/consumers/${id}`, body);
      toast.success(action === "activate" ? "Consumidor ativado" : "Atualizado");
      qc.invalidateQueries({ queryKey: ["a-consumers"] }); setSel(null);
    }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const columns = [
    { key: "name", label: "Nome", render: (r) => <span className="font-medium text-white">{r.name}</span> },
    { key: "email", label: "E-mail" },
    { key: "neighborhood", label: "Bairro", render: (r) => `${r.neighborhood || "-"}` },
    { key: "subscription_status", label: "Assinatura", render: (r) => <SubscriptionBadge status={r.subscription_status} /> },
    { key: "total_saved", label: "Economizado", render: (r) => money(r.total_saved) },
    { key: "actions", label: "", render: (r) => <button data-testid={`view-consumer-${r.id}`} onClick={() => setSel(r)} className="text-off-orange"><Eye className="h-4 w-4" /></button> },
  ];

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Consumidores" subtitle="Gestão de contas de consumidores." />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-off-blue/40 bg-off-surface px-3">
          <Search className="h-4 w-4 text-gray-500" />
          <Input data-testid="consumer-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou e-mail" className="h-11 border-0 bg-transparent text-white focus-visible:ring-0" />
        </div>
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="h-11 w-44 rounded-xl border-off-blue/40 bg-off-surface text-white"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent className="bg-off-surface text-white border-off-blue/40">
            <SelectItem value="all">Todos os status</SelectItem>
            {SUB_OPTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <Loading /> : <AdminTable columns={columns} rows={data || []} testid="consumers-table" />}

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-w-md border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle>{sel?.name}</DialogTitle></DialogHeader>
          {sel && (
            <div className="space-y-3 text-sm">
              <Info label="E-mail" value={sel.email} /><Info label="Telefone" value={sel.phone} />
              <Info label="Cidade/Bairro" value={`${sel.city || "-"} / ${sel.neighborhood || "-"}`} />
              <Info label="Total economizado" value={money(sel.total_saved)} />
              <Info label="Total gasto" value={money(sel.total_spent)} />
              <Info label="Bilhetes" value={sel.ticket_count} />
              <Info label="Cadastro" value={fmtDate(sel.created_at, false)} />
              <div>
                <p className="mb-1 text-gray-400">Status da assinatura</p>
                <Select value={sel.subscription_status} onValueChange={(v) => update(sel.id, { subscription_status: v })}>
                  <SelectTrigger data-testid="consumer-sub-select" className="off-input"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-off-surface text-white border-off-blue/40">{SUB_OPTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-2 pt-2">
                <Button data-testid="activate-consumer-btn" onClick={() => update(sel.id, {}, "activate")} className="rounded-xl bg-off-success text-white hover:bg-off-success/90">ATIVAR CONSUMIDOR</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => update(sel.id, { account_status: "active" })} variant="outline" className="rounded-xl border-off-blue/40 text-white">Reativar conta</Button>
                  <Button onClick={() => update(sel.id, { account_status: "suspended" })} variant="outline" className="rounded-xl border-off-error/50 text-off-error">Suspender</Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }) { return (<div className="flex justify-between"><span className="text-gray-400">{label}</span><span className="font-medium text-white">{value}</span></div>); }
