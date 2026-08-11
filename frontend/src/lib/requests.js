// Rótulos e metadados compartilhados de Solicitações e Botões de atendimento.
export const SERVICE_TYPES = [
  ["agendamento", "Agendamento"],
  ["reserva", "Reserva"],
  ["orcamento", "Orçamento"],
  ["entrega", "Entrega"],
  ["retirada", "Retirada"],
  ["encomenda", "Encomenda"],
  ["contato", "Contato / WhatsApp"],
];
export const SERVICE_LABEL = Object.fromEntries(SERVICE_TYPES);

export const DESTINATIONS = [
  ["internal", "Formulário interno da OFF 360"],
  ["whatsapp", "WhatsApp"],
  ["external", "Link externo"],
];

export const DAYS = [
  ["mon", "Seg"], ["tue", "Ter"], ["wed", "Qua"], ["thu", "Qui"], ["fri", "Sex"], ["sat", "Sáb"], ["sun", "Dom"],
];

export const STATUS_META = {
  awaiting: { label: "Aguardando resposta", cls: "text-off-warning bg-off-warning/10" },
  accepted: { label: "Aceito", cls: "text-off-success bg-off-success/10" },
  in_preparation: { label: "Em preparação", cls: "text-off-orange bg-off-orange/10" },
  scheduled: { label: "Agendado", cls: "text-off-orange bg-off-orange/10" },
  ready_pickup: { label: "Pronto para retirada", cls: "text-off-success bg-off-success/10" },
  out_for_delivery: { label: "Saiu para entrega", cls: "text-off-orange bg-off-orange/10" },
  completed: { label: "Concluído", cls: "text-off-success bg-off-success/10" },
  rejected: { label: "Recusado", cls: "text-off-error bg-off-error/10" },
  cancelled: { label: "Cancelado", cls: "text-off-error bg-off-error/10" },
  expired: { label: "Expirado", cls: "text-gray-400 bg-white/10" },
};

// Status intermediários que o empresário pode aplicar (via /status).
export const MERCHANT_STEPS = [
  ["accepted", "Marcar como aceito"],
  ["in_preparation", "Em preparação"],
  ["scheduled", "Agendado"],
  ["ready_pickup", "Pronto para retirada"],
  ["out_for_delivery", "Saiu para entrega"],
];
