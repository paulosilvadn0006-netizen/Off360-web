import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import * as Icons from "lucide-react";
import { Plus } from "lucide-react";

export default function Categories() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", icon: "Store", order: 0, status: "active" });
  const { data, isLoading } = useQuery({ queryKey: ["a-cats"], queryFn: async () => (await api.get("/admin/categories")).data });

  const save = async () => {
    try { await api.post("/admin/categories", form); toast.success("Categoria criada"); setOpen(false); setForm({ name: "", icon: "Store", order: 0, status: "active" }); qc.invalidateQueries({ queryKey: ["a-cats"] }); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const toggle = async (c) => { await api.put(`/admin/categories/${c.id}`, { ...c, status: c.status === "active" ? "inactive" : "active" }); qc.invalidateQueries({ queryKey: ["a-cats"] }); };

  if (isLoading) return <Loading />;

  return (
    <div className="animate-fade-up">
      <AdminHeader title="Categorias" subtitle="Categorias exibidas para os consumidores.">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="cat-new-btn" className="rounded-xl off-gradient font-semibold text-white"><Plus className="mr-1 h-4 w-4" /> Nova categoria</Button></DialogTrigger>
          <DialogContent className="max-w-sm border-off-blue/40 bg-off-surface text-white">
            <DialogHeader><DialogTitle>Nova categoria</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-gray-300">Nome</Label><Input data-testid="cat-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="off-input" /></div>
              <div><Label className="text-gray-300">Ícone (lucide)</Label><Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="off-input" placeholder="Ex: Store, Coffee, Car" /></div>
              <div><Label className="text-gray-300">Ordem</Label><Input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: parseInt(e.target.value) || 0 })} className="off-input" /></div>
              <Button data-testid="cat-save" onClick={save} className="w-full rounded-xl off-gradient font-semibold text-white">Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </AdminHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="categories-grid">
        {(data || []).map((c) => {
          const Icon = Icons[c.icon] || Icons.Store;
          return (
            <div key={c.id} className="off-card flex items-center justify-between p-4">
              <div className="flex items-center gap-3"><div className="rounded-xl bg-off-orange/15 p-2"><Icon className="h-5 w-5 text-off-orange" /></div><span className="font-medium text-white">{c.name}</span></div>
              <Switch checked={c.status === "active"} onCheckedChange={() => toggle(c)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
