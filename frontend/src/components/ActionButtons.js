import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { MessageCircle, ExternalLink, ClipboardList, Clock, Info, AlertTriangle } from "lucide-react";
import { SERVICE_LABEL } from "@/lib/requests";

function Icon({ d }) {
  if (d === "whatsapp") return <MessageCircle className="h-4 w-4" />;
  if (d === "external") return <ExternalLink className="h-4 w-4" />;
  return <ClipboardList className="h-4 w-4" />;
}

// Renderiza os botões de atendimento configurados e trata os três destinos.
export default function ActionButtons({ establishment, storyId, className = "" }) {
  const navigate = useNavigate();
  const buttons = establishment?.action_buttons || [];
  const [internal, setInternal] = useState(null); // botão selecionado p/ formulário interno
  const [external, setExternal] = useState(null); // botão selecionado p/ link externo (confirmação)
  const [form, setForm] = useState({ product_service: "", desired_date: "", desired_time: "", address: "", phone: "", message: "" });
  const [busy, setBusy] = useState(false);

  if (!buttons.length) return null;

  const registerRequest = async (btn, extra = {}) => {
    const { data } = await api.post("/consumer/requests", {
      establishment_id: establishment.id, button_id: btn.id, story_id: storyId || null, ...extra,
    });
    return data;
  };

  const onClick = async (btn) => {
    if (!btn.available) { toast.info(btn.unavailable_message || "Fora do horário de atendimento."); return; }
    if (btn.destination === "internal") { setForm({ product_service: "", desired_date: "", desired_time: "", address: "", phone: "", message: "" }); setInternal(btn); return; }
    if (btn.destination === "external") { setExternal(btn); return; }
    // whatsapp: registra antes de abrir
    setBusy(true);
    try {
      const data = await registerRequest(btn);
      await api.post(`/consumer/requests/${data.id}/track-click`, { kind: "whatsapp", story_id: storyId || null }).catch(() => {});
      if (data.whatsapp_url) window.open(data.whatsapp_url, "_blank", "noopener");
      toast.success("Solicitação registrada. Abrimos o WhatsApp para você.");
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  const submitInternal = async () => {
    setBusy(true);
    try {
      const data = await registerRequest(internal, form);
      toast.success(`Solicitação enviada! Código ${data.code}`);
      setInternal(null);
      navigate("/my-requests");
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  const openExternal = async () => {
    setBusy(true);
    try {
      const data = await registerRequest(external);
      await api.post(`/consumer/requests/${data.id}/track-click`, { kind: "external", story_id: storyId || null }).catch(() => {});
      window.open(external.external_url, "_blank", "noopener");
      setExternal(null);
      toast.success("Solicitação registrada.");
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className={className} data-testid="consumer-action-buttons">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {buttons.map((b) => (
          <button key={b.id} data-testid={`action-btn-${b.service_type}`} disabled={busy} onClick={() => onClick(b)}
            className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition ${b.available ? "off-gradient" : "border border-off-blue/40 bg-off-surface opacity-70"}`}>
            <Icon d={b.destination} /> {b.label}
          </button>
        ))}
      </div>
      {buttons.some((b) => !b.available && b.unavailable_message) && (
        <p className="mt-2 flex items-start gap-1 text-[11px] text-off-warning"><Clock className="mt-0.5 h-3 w-3" /> {buttons.find((b) => !b.available && b.unavailable_message)?.unavailable_message}</p>
      )}

      {/* Formulário interno */}
      <Dialog open={!!internal} onOpenChange={(v) => !v && setInternal(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle>{internal?.label} — {SERVICE_LABEL[internal?.service_type]}</DialogTitle></DialogHeader>
          {internal && (
            <div className="space-y-3">
              {internal.observations && <p className="flex items-start gap-1.5 rounded-lg bg-off-bg/60 p-2 text-xs text-gray-300"><Info className="mt-0.5 h-3 w-3 text-off-orange" /> {internal.observations}</p>}
              {internal.discount_valid && establishment.discount_percent ? <p className="rounded-lg bg-off-orange/10 p-2 text-xs text-off-orange">Desconto de {establishment.discount_percent}% garantido para esta solicitação.</p> : null}
              {internal.requires_prepayment ? <p className="text-[11px] text-off-warning">Este atendimento pode exigir pagamento antecipado.</p> : null}
              <div><Label className="text-gray-300">Produto ou serviço</Label><Input data-testid="req-product" value={form.product_service} onChange={(e) => setForm({ ...form, product_service: e.target.value })} className="off-input mt-1" placeholder="O que você deseja?" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-gray-300">Data desejada</Label><Input data-testid="req-date" type="date" value={form.desired_date} onChange={(e) => setForm({ ...form, desired_date: e.target.value })} className="off-input mt-1" /></div>
                <div><Label className="text-gray-300">Horário</Label><Input data-testid="req-time" type="time" value={form.desired_time} onChange={(e) => setForm({ ...form, desired_time: e.target.value })} className="off-input mt-1" /></div>
              </div>
              {internal.service_type === "entrega" && (
                <div><Label className="text-gray-300">Endereço de entrega</Label><Input data-testid="req-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="off-input mt-1" /></div>
              )}
              <div><Label className="text-gray-300">Telefone/WhatsApp</Label><Input data-testid="req-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="off-input mt-1" placeholder="(00) 00000-0000" /></div>
              <div><Label className="text-gray-300">Mensagem (opcional)</Label><Textarea data-testid="req-message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="mt-1 border-off-blue/40 bg-off-bg text-white" /></div>
              <Button data-testid="req-submit" onClick={submitInternal} disabled={busy} className="h-11 w-full rounded-xl off-gradient font-semibold text-white">{busy ? "Enviando..." : "Enviar solicitação"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Aviso de link externo */}
      <Dialog open={!!external} onOpenChange={(v) => !v && setExternal(null)}>
        <DialogContent className="max-w-sm border-off-blue/40 bg-off-surface text-white">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-off-warning" /> Sair da OFF 360</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-300">Você será direcionado para um serviço externo do estabelecimento. Deseja continuar?</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExternal(null)} className="border-off-blue/40 text-white">Cancelar</Button>
            <Button data-testid="ext-confirm" onClick={openExternal} disabled={busy} className="off-gradient text-white">Continuar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
