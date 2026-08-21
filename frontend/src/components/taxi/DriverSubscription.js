import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, QrCode, ShieldCheck, AlertTriangle, Copy, Loader2 } from "lucide-react";

const fmtDate = (s) => {
  if (!s) return "-";
  try { return new Date(s).toLocaleDateString("pt-BR"); } catch { return "-"; }
};

export default function DriverSubscription() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["taxi-subscription"], queryFn: async () => (await api.get("/taxi/subscription")).data, refetchInterval: 30000 });
  const [busy, setBusy] = useState(false);
  const [pixOpen, setPixOpen] = useState(false);
  const [cpf, setCpf] = useState("");
  const [pix, setPix] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  if (!data) return null;
  const vencida = data.status_assinatura === "Vencido";
  const dias = data.dias_restantes ?? 0;

  const subscribeCard = async () => {
    setBusy(true);
    try {
      const { data: res } = await api.post("/taxi/subscription/card");
      if (res.init_point) { window.open(res.init_point, "_blank", "noopener"); toast.success("Abrimos o Mercado Pago para você autorizar o cartão. Os 30 dias grátis já estão ativos."); }
      else toast.error("Não foi possível iniciar a assinatura. Tente novamente.");
    } catch (err) { toast.error(formatApiError(err, "Falha ao iniciar assinatura no cartão.")); }
    finally { setBusy(false); }
  };

  const startPoll = (paymentId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data: st } = await api.get(`/taxi/subscription/pix/${paymentId}`);
        if (st.status === "approved") {
          clearInterval(pollRef.current);
          toast.success("Pagamento aprovado! Assinatura renovada por 30 dias.");
          setPixOpen(false); setPix(null);
          qc.invalidateQueries({ queryKey: ["taxi-subscription"] });
        }
      } catch (e) { /* ignore */ }
    }, 4000);
  };

  const payPix = async () => {
    setBusy(true);
    try {
      const { data: res } = await api.post("/taxi/subscription/pix", { cpf });
      setPix(res);
      if (res.payment_id) startPoll(res.payment_id);
    } catch (err) { toast.error(formatApiError(err, "Falha ao gerar o Pix.")); }
    finally { setBusy(false); }
  };

  const copyPix = async () => { try { await navigator.clipboard.writeText(pix.qr_code); toast.success("Código Pix copiado!"); } catch { toast.error("Não foi possível copiar."); } };

  return (
    <div className={`mb-4 rounded-2xl border p-4 ${vencida ? "border-off-error/50 bg-off-error/10" : "border-off-blue/40 bg-off-surface"}`} data-testid="taxi-driver-subscription">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {vencida ? <AlertTriangle className="h-5 w-5 text-off-error" /> : <ShieldCheck className="h-5 w-5 text-off-success" />}
          <div>
            <p className="font-display text-sm font-bold text-white">Assinatura 360Taxi</p>
            <p className="text-[11px] text-gray-400" data-testid="taxi-sub-status">
              {vencida
                ? "Vencida — renove para voltar a aceitar corridas."
                : `${data.status_assinatura} · vence em ${fmtDate(data.data_vencimento)} (${dias} dia${dias === 1 ? "" : "s"})`}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${vencida ? "bg-off-error/20 text-off-error" : "bg-off-success/15 text-off-success"}`}>{data.status_assinatura}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button data-testid="taxi-sub-card-btn" onClick={subscribeCard} disabled={busy} className="h-10 rounded-xl bg-off-blue text-xs font-semibold text-white hover:bg-off-blue/90">
          <CreditCard className="mr-1.5 h-4 w-4" /> Cartão (30 dias grátis)
        </Button>
        <Button data-testid="taxi-sub-pix-btn" onClick={() => { setPix(null); setPixOpen(true); }} disabled={busy} variant="outline" className="h-10 rounded-xl border-off-orange/50 text-xs font-semibold text-off-orange hover:bg-off-orange/10">
          <QrCode className="mr-1.5 h-4 w-4" /> Renovar via Pix
        </Button>
      </div>

      <Dialog open={pixOpen} onOpenChange={(o) => { setPixOpen(o); if (!o && pollRef.current) clearInterval(pollRef.current); }}>
        <DialogContent className="border-off-blue/40 bg-off-surface text-white" data-testid="taxi-pix-dialog">
          <DialogHeader><DialogTitle className="text-white">Renovar por Pix — R$ {Number(data.amount || 0).toFixed(2).replace(".", ",")}</DialogTitle></DialogHeader>
          {!pix ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">Renove seu acesso por mais 30 dias corridos a partir da aprovação do pagamento.</p>
              <Input data-testid="taxi-pix-cpf" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="CPF (opcional)" className="off-input" />
              <Button data-testid="taxi-pix-generate" onClick={payPix} disabled={busy} className="h-11 w-full rounded-xl bg-off-orange font-semibold text-white hover:bg-off-orange/90">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />} Gerar QR Code Pix
              </Button>
            </div>
          ) : (
            <div className="space-y-3 text-center">
              {pix.qr_code_base64 && <img data-testid="taxi-pix-qr" alt="QR Code Pix" src={`data:image/png;base64,${pix.qr_code_base64}`} className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />}
              <p className="text-[11px] text-gray-400">Aguardando pagamento… a tela atualiza sozinha quando aprovado.</p>
              <textarea data-testid="taxi-pix-code" readOnly value={pix.qr_code || ""} className="h-20 w-full rounded-lg border border-off-blue/40 bg-off-bg p-2 text-[11px] text-gray-300" />
              <Button data-testid="taxi-pix-copy" onClick={copyPix} className="h-10 w-full rounded-xl bg-off-blue font-semibold text-white hover:bg-off-blue/90"><Copy className="mr-2 h-4 w-4" /> Copiar Pix Copia e Cola</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
