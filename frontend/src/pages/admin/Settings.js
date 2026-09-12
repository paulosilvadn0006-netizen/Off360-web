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
import { Save, CreditCard, Ticket, Car } from "lucide-react";

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
    const numOrNull = (v) => (v === "" || v == null ? null : parseFloat(v));
    const cats = form.taxi_categories || {};
    const cleanCats = {};
    ["basic", "select", "premium"].forEach((c) => {
      const x = cats[c] || {};
      cleanCats[c] = {
        base_fare: numOrNull(x.base_fare),
        up_to_2km: numOrNull(x.up_to_2km),
        per_km_extra: numOrNull(x.per_km_extra),
        per_min: numOrNull(x.per_min),
      };
    });
    try {
      await api.put("/admin/settings", {
        consumer_plan_price: form.consumer_plan_price === "" || form.consumer_plan_price == null ? null : parseFloat(form.consumer_plan_price),
        merchant_plan_price: form.merchant_plan_price === "" || form.merchant_plan_price == null ? null : parseFloat(form.merchant_plan_price),
        ticket_rule_type: form.ticket_rule_type,
        ticket_rule_value: parseFloat(form.ticket_rule_value) || 1,
        taxi_categories: cleanCats,
        taxi_max_negotiations: form.taxi_max_negotiations === "" || form.taxi_max_negotiations == null ? null : parseInt(form.taxi_max_negotiations, 10),
      });
      toast.success("Configurações salvas");
    } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };

  const CAT_LABELS = { basic: "Basic", select: "Select", premium: "Premium" };
  const setCat = (cat, field, value) => setForm({ ...form, taxi_categories: { ...(form.taxi_categories || {}), [cat]: { ...((form.taxi_categories || {})[cat] || {}), [field]: value } } });

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

      <div className="mt-4 off-card p-6" data-testid="taxi-settings-card">
        <div className="mb-4 flex items-center gap-2 text-off-orange"><Car className="h-5 w-5" /><h2 className="font-display font-bold text-white">360Taxi — tarifas por categoria</h2></div>
        <div className="space-y-4">
          {["basic", "select", "premium"].map((cat) => {
            const x = (form.taxi_categories || {})[cat] || {};
            return (
              <div key={cat} className="rounded-xl border border-off-blue/30 bg-off-bg/40 p-4" data-testid={`taxi-cat-${cat}`}>
                <p className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-white"><Car className="h-4 w-4 text-black" fill="#111827" /> {CAT_LABELS[cat]}</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><Label className="text-gray-300">Tarifa base (R$)</Label><Input data-testid={`${cat}-base`} type="number" value={x.base_fare ?? ""} onChange={(e) => setCat(cat, "base_fare", e.target.value)} className="off-input" placeholder="Ex: 3.00" /></div>
                  <div><Label className="text-gray-300">Valor até 2 km (R$)</Label><Input data-testid={`${cat}-up2`} type="number" value={x.up_to_2km ?? ""} onChange={(e) => setCat(cat, "up_to_2km", e.target.value)} className="off-input" placeholder="Ex: 6.00" /></div>
                  <div><Label className="text-gray-300">Valor por km adicional (R$)</Label><Input data-testid={`${cat}-perkm`} type="number" value={x.per_km_extra ?? ""} onChange={(e) => setCat(cat, "per_km_extra", e.target.value)} className="off-input" placeholder="Ex: 2.00" /></div>
                  <div><Label className="text-gray-300">Valor por minuto (R$)</Label><Input data-testid={`${cat}-permin`} type="number" value={x.per_min ?? ""} onChange={(e) => setCat(cat, "per_min", e.target.value)} className="off-input" placeholder="Ex: 0.30" /></div>
                </div>
              </div>
            );
          })}
          <div className="max-w-xs"><Label className="text-gray-300">Limite de negociações</Label><Input data-testid="taxi-max-neg" type="number" value={form.taxi_max_negotiations ?? ""} onChange={(e) => setForm({ ...form, taxi_max_negotiations: e.target.value })} className="off-input" placeholder="Ex: 3" /></div>
        </div>
        <p className="mt-2 text-xs text-gray-500">Comissão OFF360 sobre a corrida: <b className="text-off-success">R$ 0,00</b> (o valor vai integralmente ao motorista).</p>
      </div>

      <Button data-testid="settings-save" onClick={save} disabled={saving} className="mt-5 h-12 rounded-xl off-gradient px-8 font-semibold text-white"><Save className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "Salvar configurações"}</Button>
    </div>
  );
}
