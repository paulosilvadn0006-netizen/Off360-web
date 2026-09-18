import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { api, uploadFile, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, MessageCircle, Upload, Loader2, FileText, RefreshCw, CheckCircle2, Clock, AlertTriangle, XCircle } from "lucide-react";

const BROKER_WHATSAPP = "5567992410977";
const INSURANCE_PRICE = "R$ 130,37 (cento e trinta reais e trinta e sete centavos) por ano";

const POLICY_STATUS = {
  aguardando: { t: "Aguardando análise", c: "text-off-orange", Icon: Clock },
  aprovada: { t: "Aprovada", c: "text-off-success", Icon: CheckCircle2 },
  correcao: { t: "Necessita correção", c: "text-off-orange", Icon: AlertTriangle },
  reprovada: { t: "Reprovada", c: "text-off-error", Icon: XCircle },
  vencida: { t: "Vencida", c: "text-off-error", Icon: XCircle },
};

function buildBrokerMessage(driver) {
  const lines = [
    "Olá, Rayssa! Gostaria de contratar o Seguro APP MBM para concluir meu cadastro no 360Taxi.",
    "",
    "Dados do motorista:",
    `Nome completo: ${driver.name || "-"}`,
    `CNH: ${driver.cnh || "-"}`,
    `Documento do veículo: ${driver.vehicle || "-"}`,
  ];
  if (driver.address) lines.push(`Endereço: ${driver.address}`);
  lines.push("", `Valor do seguro: ${INSURANCE_PRICE}.`, "", "Aguardo as orientações para contratação.");
  return lines.join("\n");
}

export default function InsuranceMBM({ accepted, onAcceptChange, driver, insurance, onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const ins = insurance || {};
  const st = POLICY_STATUS[ins.status] || null;

  const toggleAccept = async (checked) => {
    onAcceptChange(checked);
    if (checked) {
      setSaving(true);
      try { await api.post("/taxi/insurance/accept", { accepted: true }); }
      catch (err) { toast.error(formatApiError(err, "Falha ao registrar o aceite.")); onAcceptChange(false); }
      finally { setSaving(false); }
    }
  };

  const openWhatsApp = () => {
    const msg = encodeURIComponent(buildBrokerMessage(driver));
    window.open(`https://wa.me/${BROKER_WHATSAPP}?text=${msg}`, "_blank");
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadFile(file);
      await api.post("/taxi/insurance/policy", { file_url: up.url, filename: file.name });
      toast.success("Apólice enviada para análise.");
      onChange && onChange();
    } catch (err) { toast.error(formatApiError(err, "Falha ao enviar a apólice.")); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const fileHref = ins.policy_url
    ? (ins.policy_url.startsWith("http") ? ins.policy_url : `${process.env.REACT_APP_BACKEND_URL}${ins.policy_url}`)
    : null;

  return (
    <div className="space-y-3 rounded-xl border border-off-orange/50 bg-off-orange/5 p-4" data-testid="insurance-mbm">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-off-orange" />
        <div>
          <p className="font-display text-sm font-bold text-white">SEGURO APP MBM</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-off-orange">Etapa obrigatória para conclusão do cadastro</p>
        </div>
      </div>

      <p className="text-xs text-gray-300">
        Para concluir seu cadastro no 360Taxi, é obrigatório contratar o Seguro APP MBM e anexar a respectiva apólice.
      </p>
      <div className="rounded-lg border border-off-blue/30 bg-off-bg/40 p-3 text-xs text-gray-300">
        <p className="mb-1 font-semibold text-white">Coberturas informadas:</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>R$ 100.000,00 para morte</li>
          <li>R$ 100.000,00 para invalidez</li>
          <li>R$ 30.000,00 para despesas com medicamentos, hospitalares e odontológicas</li>
        </ul>
        <p className="mt-2 font-semibold text-white">Valor: <span className="text-off-orange">R$ 130,37 por ano</span></p>
        <p className="text-[11px] text-gray-400">(cento e trinta reais e trinta e sete centavos por ano)</p>
        <p className="mt-2 text-[10px] text-gray-500">As coberturas e condições do seguro estão sujeitas à apólice e às condições oficiais do produto.</p>
      </div>

      {/* Aceite obrigatório */}
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-off-blue/40 bg-off-bg/30 p-3" data-testid="insurance-accept-label">
        <Checkbox data-testid="insurance-accept" checked={!!accepted} disabled={saving} onCheckedChange={toggleAccept} className="mt-0.5 border-off-orange data-[state=checked]:bg-off-orange" />
        <span className="text-[11px] leading-snug text-gray-200">
          Li, compreendi e estou de acordo com as condições acima e autorizo o prosseguimento desta etapa do meu cadastro.
        </span>
      </label>

      {accepted && (
        <>
          {/* Contato da corretora */}
          <div className="rounded-lg border border-off-blue/40 bg-off-bg/40 p-3" data-testid="insurance-broker">
            <p className="text-xs font-bold text-white">CONTRATE SEU SEGURO APP MBM</p>
            <p className="mt-1 text-[11px] text-gray-300">Corretora: <span className="font-semibold text-white">Rayssa Mirin — Corretora MBM</span></p>
            <p className="text-[11px] text-gray-300">WhatsApp: <span className="font-semibold text-white">(67) 99241-0977</span></p>
            <Button data-testid="insurance-whatsapp-btn" onClick={openWhatsApp} className="mt-2 h-11 w-full rounded-xl bg-[#25D366] font-bold text-white hover:bg-[#20bd5a]">
              <MessageCircle className="mr-2 h-4 w-4" /> FALE COM A CORRETORA PELO WHATSAPP
            </Button>
          </div>

          {/* Anexo da apólice — imediatamente abaixo do contato da corretora */}
          <div className="rounded-lg border border-off-blue/40 bg-off-bg/40 p-3" data-testid="insurance-policy">
            <p className="text-xs font-bold text-white">ANEXE SUA APÓLICE DO SEGURO APP MBM</p>
            <p className="mt-1 text-[11px] text-gray-400">Após contratar o seguro com a corretora, anexe aqui sua apólice para análise.</p>

            {ins.policy_url ? (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2 rounded-lg bg-off-surface px-3 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-off-orange" />
                  <a href={fileHref} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[11px] text-off-success" data-testid="insurance-policy-file">
                    ✓ {ins.policy_filename || "apólice enviada"}
                  </a>
                </div>
                {st && (
                  <div className={`flex items-center gap-1.5 text-[11px] font-bold ${st.c}`} data-testid="insurance-policy-status">
                    <st.Icon className="h-3.5 w-3.5" /> {st.t}
                  </div>
                )}
                {ins.status === "aprovada" && ins.policy_expires_at && (
                  <p className="text-[10px] text-gray-400" data-testid="insurance-policy-expiry">Apólice válida até {new Date(ins.policy_expires_at).toLocaleDateString("pt-BR")} (renovação anual)</p>
                )}
                {ins.review_note && <p className="text-[10px] text-gray-400">Obs. da análise: {ins.review_note}</p>}
                <Button data-testid="insurance-policy-redo" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy} className="rounded-lg border-off-blue/40 text-gray-200">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="mr-1 h-4 w-4" /> Substituir arquivo</>}
                </Button>
              </div>
            ) : (
              <Button data-testid="insurance-policy-btn" onClick={() => fileRef.current?.click()} disabled={busy} className="mt-2 h-11 w-full rounded-xl off-gradient font-bold text-white">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="mr-2 h-4 w-4" /> ANEXAR APÓLICE</>}
              </Button>
            )}
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/jpg,image/png" className="hidden" onChange={onFile} />
          </div>
        </>
      )}
    </div>
  );
}
