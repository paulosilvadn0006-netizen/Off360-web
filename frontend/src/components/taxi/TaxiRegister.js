import React, { useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import PhotoCapture3x4 from "@/components/taxi/PhotoCapture3x4";

export default function TaxiRegister({ onDone }) {
  const [f, setF] = useState({ photo_3x4_url: "", cnh: "", cnh_number: "", cnh_validade: "", ear: false, vehicle_type: "carro", modelo: "", cor: "", placa: "", ano: "", portas: "4" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!f.photo_3x4_url) return toast.error("Capture a foto 3x4.");
    if (!f.cnh_number || !f.cnh_validade) return toast.error("Informe número e validade da CNH.");
    if (!f.ear) return toast.error("É obrigatório possuir EAR na CNH.");
    if (!f.modelo || !f.cor || !f.placa || !f.ano) return toast.error("Preencha os dados do veículo.");
    setBusy(true);
    try {
      await api.post("/taxi/driver/register", {
        photo_3x4_url: f.photo_3x4_url, cnh: f.cnh, cnh_number: f.cnh_number, cnh_validade: f.cnh_validade,
        ear: f.ear, vehicle_type: f.vehicle_type, modelo: f.modelo, cor: f.cor, placa: f.placa,
        ano: parseInt(f.ano, 10), portas: parseInt(f.portas, 10),
      });
      toast.success("Cadastro enviado para análise!");
      onDone && onDone();
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="off-card p-5" data-testid="taxi-register">
      <h2 className="font-display text-lg font-bold text-white">Cadastro 360Taxi</h2>
      <p className="mb-3 text-xs text-gray-400">Operação inicial: Campinas e região.</p>
      <div className="space-y-3">
        <PhotoCapture3x4 value={f.photo_3x4_url} onChange={set("photo_3x4_url")} />
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-gray-300">Nº da CNH</Label><Input data-testid="reg-cnh-number" value={f.cnh_number} onChange={(e) => set("cnh_number")(e.target.value)} className="off-input" /></div>
          <div><Label className="text-gray-300">Validade CNH</Label><Input data-testid="reg-cnh-validade" type="date" value={f.cnh_validade} onChange={(e) => set("cnh_validade")(e.target.value)} className="off-input" /></div>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-off-blue/40 p-3">
          <div><p className="text-sm text-white">EAR (Exerce Atividade Remunerada)</p><p className="text-[11px] text-gray-400">Obrigatório na CNH para transporte de passageiros.</p></div>
          <Switch data-testid="reg-ear" checked={f.ear} onCheckedChange={set("ear")} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-gray-300">Tipo</Label>
            <Select value={f.vehicle_type} onValueChange={set("vehicle_type")}>
              <SelectTrigger data-testid="reg-vehicle-type" className="off-input"><SelectValue /></SelectTrigger>
              <SelectContent className="border-off-blue/40 bg-off-surface text-white"><SelectItem value="carro">🚗 Carro</SelectItem><SelectItem value="moto">🏍️ Moto</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label className="text-gray-300">Portas</Label><Input data-testid="reg-portas" type="number" value={f.portas} onChange={(e) => set("portas")(e.target.value)} className="off-input" /></div>
          <div><Label className="text-gray-300">Modelo</Label><Input data-testid="reg-modelo" value={f.modelo} onChange={(e) => set("modelo")(e.target.value)} placeholder="Honda Civic" className="off-input" /></div>
          <div><Label className="text-gray-300">Cor</Label><Input data-testid="reg-cor" value={f.cor} onChange={(e) => set("cor")(e.target.value)} placeholder="Prata" className="off-input" /></div>
          <div><Label className="text-gray-300">Placa</Label><Input data-testid="reg-placa" value={f.placa} onChange={(e) => set("placa")(e.target.value)} placeholder="ABC1D23" className="off-input" /></div>
          <div><Label className="text-gray-300">Ano fabricação</Label><Input data-testid="reg-ano" type="number" value={f.ano} onChange={(e) => set("ano")(e.target.value)} placeholder="2018" className="off-input" /></div>
        </div>
        <p className="text-[11px] text-gray-500">Regra OFF360: carro com no mínimo 4 portas e no máximo 12 anos de fabricação.</p>
        <Button data-testid="reg-submit" onClick={submit} disabled={busy} className="h-12 w-full rounded-xl off-gradient font-bold text-white">{busy ? "Enviando..." : "Enviar cadastro"}</Button>
      </div>
    </div>
  );
}
