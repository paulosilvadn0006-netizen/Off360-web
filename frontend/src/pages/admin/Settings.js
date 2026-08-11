import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading } from "@/components/shared";
import { AdminHeader } from "@/pages/admin/_components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, CreditCard, Ticket } from "lucide-react";

const RULES = [
  ["per_confirmed_purchase", "1 bilhete por compra confirmada"],
  ["per_amount", "1 bilhete a cada valor gasto"],
];

export default function Settings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["a-settings"], queryFn: async () => (await api.get("/admin/settings")).data });
  useEffect(() => { if (data && !form) setForm(data); }, [data]); // eslint-disable-line
  if (isLoading || !form) return <Loading />;

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/settings", {
        consumer_plan_price: form.consumer_plan_price === "" || form.consumer_plan_price == null ? null : parseFloat(form.consumer_plan_price),
        merchant_plan_price: form.merchant_plan_price === "" || form.merchant_plan_price == null ? null : parseFloat(form.merchant_plan_price),
        ticket_rule_type: form.ticket_rule_type,
        ticket_rule_value: parseFloat(form.ticket_rule_value) || 1,
      });
      toast.success("Configurações salvas");
    } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="animate-fade-up max-w-2xl">
      <AdminHeader title="Configurações" subtitle="Planos, preços e regras de bilhetes." />

      <div className="off-card p-6">
        <div className="mb-4 flex items-center gap-2 text-off-orange"><CreditCard className="h-5 w-5" /><h2 className="font-display font-bold text-white">Valores das assinaturas</h2></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><Label className="text-gray-300">Plano do consumidor (R$/mês)</Label><Input data-testid="consumer-price" type="number" value={form.consumer_plan_price ?? ""} onChange={(e) => setForm({ ...form, consumer_plan_price: e.target.value })} className="off-input" placeholder="Valor a definir" /></div>
          <div><Label className="text-gray-300">Plano do empresário (R$/mês)</Label><Input data-testid="merchant-price" type="number" value={form.merchant_plan_price ?? ""} onChange={(e) => setForm({ ...form, merchant_plan_price: e.target.value })} className="off-input" placeholder="Valor a definir" /></div>
        </div>
        <p className="mt-2 text-xs text-gray-500">Deixe em branco para manter "Valor a definir".</p>
      </div>

      <div className="mt-4 off-card p-6">
        <div className="mb-4 flex items-center gap-2 text-off-orange"><Ticket className="h-5 w-5" /><h2 className="font-display font-bold text-white">Regra de bilhetes de sorteio</h2></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-gray-300">Tipo de regra</Label>
            <Select value={form.ticket_rule_type} onValueChange={(v) => setForm({ ...form, ticket_rule_type: v })}>
              <SelectTrigger data-testid="ticket-rule" className="off-input"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-off-surface text-white border-off-blue/40">{RULES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-gray-300">{form.ticket_rule_type === "per_amount" ? "Valor por bilhete (R$)" : "Bilhetes por compra"}</Label><Input data-testid="ticket-value" type="number" value={form.ticket_rule_value ?? 1} onChange={(e) => setForm({ ...form, ticket_rule_value: e.target.value })} className="off-input" /></div>
        </div>
      </div>

      <Button data-testid="settings-save" onClick={save} disabled={saving} className="mt-5 h-12 rounded-xl off-gradient px-8 font-semibold text-white"><Save className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "Salvar configurações"}</Button>
    </div>
  );
}
