import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

export const ORDER_STATUS = {
  new: { label: "Aguardando confirmação", color: "#9ca3af", blink: false, consumer: "Pedido enviado ao estabelecimento" },
  preparing: { label: "Em preparo", color: "#facc15", blink: true, consumer: "Seu pedido OFF360 está sendo preparado" },
  ready: { label: "Pedido pronto", color: "#fb923c", blink: true, consumer: "Seu pedido OFF360 está pronto" },
  on_the_way: { label: "A caminho", color: "#22c55e", blink: true, consumer: "Seu pedido OFF360 está a caminho" },
  arrived: { label: "Chegou com OFF360", color: "#ef4444", blink: true, consumer: "Sua entrega OFF360 chegou!" },
  delivered: { label: "Entregue", color: "#374151", blink: false, consumer: "Pedido concluído. Obrigado!" },
  cancelled: { label: "Cancelado", color: "#6b7280", blink: false, consumer: "Pedido cancelado" },
};

export default function OrderTracking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: o } = useQuery({
    queryKey: ["order", id],
    queryFn: async () => (await api.get(`/consumer/orders/${id}`)).data,
    refetchInterval: (q) => (["delivered", "cancelled"].includes(q?.state?.data?.status) ? false : 4000),
  });

  const confirmQR = async () => {
    try { await api.post(`/consumer/orders/${id}/confirm-qr`, { validation_token: o.validation_token }); toast.success("Recebimento confirmado!"); qc.invalidateQueries({ queryKey: ["order", id] }); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  if (!o) return <div className="p-8 text-center text-gray-400">Carregando pedido...</div>;
  const meta = ORDER_STATUS[o.status] || ORDER_STATUS.new;
  const canConfirm = (o.mode === "delivery" && o.status === "arrived") || (o.mode === "pickup" && o.status === "ready");

  return (
    <div className="pb-6 animate-fade-up" data-testid="order-tracking">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-gray-400"><ChevronLeft className="h-4 w-4" /> Voltar</button>
      <div className="off-card p-6 text-center">
        <p className="text-xs uppercase tracking-wide text-gray-400">{o.mode === "delivery" ? "Entrega OFF360" : "Retirada OFF360"}</p>
        <h1 className="mt-1 font-display text-xl font-bold text-white">{o.establishment_name}</h1>
        <div className="my-6 flex flex-col items-center gap-3">
          <span data-testid="order-status-dot" className={meta.blink ? "off-blink" : ""}
            style={{ width: 26, height: 26, borderRadius: "9999px", background: meta.color, boxShadow: `0 0 14px ${meta.color}` }} />
          <p className="font-display text-lg font-bold" style={{ color: meta.color }} data-testid="order-status-label">{meta.label}</p>
          <p className="text-sm text-gray-200" data-testid="order-status-msg">{meta.consumer}</p>
        </div>

        {o.payment_method && (
          <p className="text-xs text-gray-400">Pagamento: {o.payment_method === "pix" ? "PIX" : o.payment_method === "card" ? "Cartão" : "Dinheiro"}
            {o.needs_change && o.change_for ? ` · Troco para R$ ${Number(o.change_for).toFixed(2).replace(".", ",")}` : ""}</p>
        )}

        {["preparing", "ready", "on_the_way", "arrived"].includes(o.status) && (
          <div className="mt-4 rounded-xl border border-off-blue/40 bg-off-bg/60 p-4" data-testid="order-validation-box">
            <p className="text-xs text-gray-300">Seu código de confirmação (uso único):</p>
            <p className="mt-1 font-mono text-2xl font-bold text-off-orange" data-testid="order-code">{o.validation_code}</p>
            {canConfirm && (
              <Button data-testid="order-confirm-qr" onClick={confirmQR} className="mt-3 h-12 w-full rounded-xl off-gradient font-semibold text-white">
                Confirmar recebimento (QR/App)
              </Button>
            )}
            {!canConfirm && <p className="mt-2 text-[11px] text-gray-500">Você poderá confirmar quando o pedido chegar/estiver pronto. Ou informe o código acima ao entregador.</p>}
          </div>
        )}
        {o.status === "cancelled" && o.cancel_reason && <p className="mt-3 text-xs text-off-error" data-testid="order-cancel-reason">Motivo: {o.cancel_reason}</p>}
        <p className="mt-5 text-[11px] text-gray-500">O pagamento será realizado diretamente ao estabelecimento na entrega ou retirada. Em breve, você também poderá pagar seus pedidos pelo OFF360.</p>
      </div>
    </div>
  );
}
