import React, { useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Car } from "lucide-react";
import PhotoCapture3x4 from "@/components/taxi/PhotoCapture3x4";
import { DocUpload, SelfieCnh } from "@/components/taxi/TaxiDocs";
import InsuranceMBM from "@/components/taxi/InsuranceMBM";

const CATEGORIES = [
  { id: "basic", label: "Basic", desc: "Categoria de entrada" },
  { id: "select", label: "Select", desc: "Intermediária" },
  { id: "premium", label: "Premium", desc: "Vê também Basic e Select" },
];

const REQUIRED_DOCS = ["cnh_frente", "cnh_verso", "antecedentes", "veiculo", "selfie"];

export default function TaxiRegister({ onDone }) {
  const { user } = useAuth();
  const [f, setF] = useState({ photo_3x4_url: "", cnh: "", cnh_number: "", cnh_validade: "", ear: false, category: "basic", modelo: "", cor: "", placa: "", ano: "", portas: "4" });
  const [docs, setDocs] = useState({});
  const [insAccepted, setInsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const setDoc = (k) => (analysis) => setDocs((s) => ({ ...s, [k]: analysis }));

  const insQ = useQuery({
    queryKey: ["taxi-insurance-status"],
    queryFn: async () => (await api.get("/taxi/driver/status")).data?.insurance || {},
  });
  const insurance = insQ.data || {};
  React.useEffect(() => { if (insurance.accepted) setInsAccepted(true); }, [insurance.accepted]);

  const addressParts = [user?.address_street, user?.address_number, user?.address_neighborhood, user?.address_city].filter((x) => (x || "").trim());
  const driverInfo = {
    name: user?.name || "",
    cnh: f.cnh_number || user?.taxi_cnh_number || "",
    vehicle: [f.modelo, f.cor, f.placa, f.ano].filter(Boolean).join(" ").trim(),
    address: addressParts.join(", "),
  };

  const submit = async () => {
    if (!f.photo_3x4_url) return toast.error("Capture a foto 3x4.");
    if (!f.cnh_number || !f.cnh_validade) return toast.error("Informe número e validade da CNH.");
    if (!f.ear) return toast.error("É obrigatório possuir EAR na CNH.");
    if (!f.modelo || !f.cor || !f.placa || !f.ano) return toast.error("Preencha os dados do veículo.");
    const missing = REQUIRED_DOCS.filter((d) => !docs[d]);
    if (missing.length) return toast.error("Envie todos os documentos e a selfie antes de finalizar.");
    if (!insAccepted) return toast.error("Aceite as condições do Seguro APP MBM para concluir o cadastro.");
    setBusy(true);
    try {
      await api.post("/taxi/driver/register", {
        photo_3x4_url: f.photo_3x4_url, cnh: f.cnh, cnh_number: f.cnh_number, cnh_validade: f.cnh_validade,
        ear: f.ear, category: f.category, modelo: f.modelo, cor: f.cor, placa: f.placa,
        ano: parseInt(f.ano, 10), portas: parseInt(f.portas, 10), insurance_accepted: insAccepted,
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
        <div>
          <Label className="text-gray-300">Categoria do carro</Label>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" data-testid={`reg-cat-${c.id}`} onClick={() => set("category")(c.id)}
                className={`flex flex-col items-center gap-1 rounded-xl border p-3 transition ${f.category === c.id ? "border-off-orange bg-off-orange/10" : "border-off-blue/40 hover:border-off-blue"}`}>
                <Car className="h-6 w-6 text-black" fill="#111827" />
                <span className="text-sm font-bold text-white">{c.label}</span>
                <span className="text-[10px] leading-tight text-gray-400">{c.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-gray-300">Portas</Label><Input data-testid="reg-portas" type="number" value={f.portas} onChange={(e) => set("portas")(e.target.value)} className="off-input" /></div>
          <div><Label className="text-gray-300">Modelo</Label><Input data-testid="reg-modelo" value={f.modelo} onChange={(e) => set("modelo")(e.target.value)} placeholder="Honda Civic" className="off-input" /></div>
          <div><Label className="text-gray-300">Cor</Label><Input data-testid="reg-cor" value={f.cor} onChange={(e) => set("cor")(e.target.value)} placeholder="Prata" className="off-input" /></div>
          <div><Label className="text-gray-300">Placa</Label><Input data-testid="reg-placa" value={f.placa} onChange={(e) => set("placa")(e.target.value)} placeholder="ABC1D23" className="off-input" /></div>
          <div><Label className="text-gray-300">Ano fabricação</Label><Input data-testid="reg-ano" type="number" value={f.ano} onChange={(e) => set("ano")(e.target.value)} placeholder="2018" className="off-input" /></div>
        </div>
        <p className="text-[11px] text-gray-500">Regra OFF360: carro com no mínimo 4 portas e no máximo 12 anos de fabricação.</p>

        <div className="space-y-2 rounded-xl border border-off-blue/30 bg-off-bg/30 p-3">
          <p className="text-xs font-bold text-white">Documentos (obrigatórios)</p>
          <DocUpload docType="cnh_frente" label="CNH — frente" value={docs.cnh_frente} onAnalyzed={setDoc("cnh_frente")} />
          <DocUpload docType="cnh_verso" label="CNH — verso" value={docs.cnh_verso} onAnalyzed={setDoc("cnh_verso")} />
          <DocUpload docType="antecedentes" label="Antecedentes criminais" allowPdf value={docs.antecedentes} onAnalyzed={setDoc("antecedentes")} />
          <DocUpload docType="veiculo" label="Documentação do veículo" allowPdf value={docs.veiculo} onAnalyzed={setDoc("veiculo")} />
          <SelfieCnh value={docs.selfie} onAnalyzed={setDoc("selfie")} />
        </div>

        <InsuranceMBM accepted={insAccepted} onAcceptChange={setInsAccepted} driver={driverInfo} insurance={insurance} onChange={() => insQ.refetch()} />

        <Button data-testid="reg-submit" onClick={submit} disabled={busy} className="h-12 w-full rounded-xl off-gradient font-bold text-white">{busy ? "Enviando..." : "Enviar cadastro"}</Button>
      </div>
    </div>
  );
}
