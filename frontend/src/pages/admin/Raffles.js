import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading, fmtDate, StatusPill } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Gift } from "lucide-react";

export default function Raffles() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", prize: "", draw_date: "", rules: "", status: "active" });
  const { data, isLoading } = useQuery({ queryKey: ["a-raffles"], queryFn: async () => (await api.get("/admin/raffles")).data });

  const save = async () => {
    try {
      const payload = { ...form, draw_date: form.draw_date ? new Date(form.draw_date).toISOString() : new Date().toISOString() };
      await api.post("/admin/raffles", payload);
      toast.success("Sorteio criado (o anterior ativo foi encerrado)");
      setOpen(false); setForm({ name: "", prize: "", draw_date: "", rules: "", status: "active" });
      qc.invalidateQueries({ queryKey: ["a-raffles"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (isLoading) return <Loading />;

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Sorteios" subtitle="Gerencie campanhas e prêmios (tudo editável).">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="raffle-new-btn" className="rounded-xl off-gradient font-semibold text-white"><Plus className="mr-1 h-4 w-4" /> Novo sorteio</Button></DialogTrigger>
          <DialogContent className="max-w-md border-off-blue/40 bg-off-surface text-white">
            <DialogHeader><DialogTitle>Novo sorteio</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-gray-300">Nome</Label><Input data-testid="raffle-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="off-input" placeholder="Ex: Sorteio de R$ 200 do bairro" /></div>
              <div><Label className="text-gray-300">Prêmio</Label><Input data-testid="raffle-prize" value={form.prize} onChange={(e) => setForm({ ...form, prize: e.target.value })} className="off-input" placeholder="Ex: R$ 200 em compras" /></div>
              <div><Label className="text-gray-300">Data do sorteio</Label><Input data-testid="raffle-date" type="date" value={form.draw_date} onChange={(e) => setForm({ ...form, draw_date: e.target.value })} className="off-input" /></div>
              <div><Label className="text-gray-300">Regulamento</Label><Textarea value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} className="border-off-blue/40 bg-off-bg text-white" /></div>
              <Button data-testid="raffle-save" onClick={save} className="w-full rounded-xl off-gradient font-semibold text-white">Publicar sorteio</Button>
            </div>
          </DialogContent>
        </Dialog>
      </AdminHeader>

      <div className="space-y-3" data-testid="raffles-list">
        {(data || []).map((r) => (
          <div key={r.id} className="off-card flex items-center justify-between p-5">
            <div className="flex items-center gap-3"><div className="rounded-xl off-gradient p-3"><Gift className="h-5 w-5 text-white" /></div>
              <div><p className="font-semibold text-white">{r.name}</p><p className="text-sm text-gray-400">{r.prize} · {fmtDate(r.draw_date, false)}</p></div>
            </div>
            <StatusPill status={r.status === "active" ? "approved" : "cancelled"} />
          </div>
        ))}
      </div>
    </div>
  );
}
