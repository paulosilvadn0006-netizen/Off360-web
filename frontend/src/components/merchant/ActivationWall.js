import React from "react";
import { useNavigate } from "react-router-dom";
import { Lock, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";

// Uma empresa está bloqueada enquanto o pagamento de ativação não é confirmado.
export function isLocked(est) {
  return !!(est && est.payment_required);
}

// Overlay/cadeado exibido sobre funcionalidades bloqueadas até a ativação.
export function LockedOverlay({ label = "Disponível após ativação", eid }) {
  const navigate = useNavigate();
  return (
    <div data-testid="locked-overlay" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-off-bg/85 backdrop-blur-sm p-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-off-warning/15 text-off-warning"><Lock className="h-6 w-6" /></div>
      <p className="text-sm font-semibold text-gray-200">{label}</p>
      <Button data-testid="locked-overlay-pay" onClick={() => navigate(`/merchant/activate${eid ? `?eid=${eid}` : ""}`)} className="h-10 rounded-xl off-gradient px-5 text-sm font-semibold text-white">
        <CreditCard className="mr-1.5 h-4 w-4" /> Ir para o pagamento
      </Button>
    </div>
  );
}

// Card de bloqueio em tela cheia (quando a página inteira depende da ativação).
export function ActivationWall({ est }) {
  const navigate = useNavigate();
  return (
    <div data-testid="activation-wall" className="animate-fade-up">
      <div className="mx-auto max-w-lg off-card p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-off-warning/15 text-off-warning"><Lock className="h-8 w-8" /></div>
        <h1 className="mt-4 font-display text-2xl font-bold text-white">Estabelecimento aguardando ativação</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
          {est?.fantasy_name ? <b className="text-white">{est.fantasy_name}</b> : "Seu estabelecimento"} foi cadastrado! Para ativá-lo no OFF360 e liberar todas as funcionalidades, conclua o pagamento de <b className="text-off-orange">R$ 89,90/mês</b>.
        </p>
        <Button data-testid="activation-wall-pay" onClick={() => navigate(`/merchant/activate?eid=${est?.id || ""}`)} className="mt-6 h-12 rounded-xl off-gradient px-8 font-semibold text-white">
          <CreditCard className="mr-2 h-4 w-4" /> Ir para o pagamento
        </Button>
      </div>
    </div>
  );
}
