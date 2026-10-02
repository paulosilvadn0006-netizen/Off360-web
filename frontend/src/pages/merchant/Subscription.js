import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, SubscriptionBadge, money, fmtDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { CreditCard, Info, Trash2, Download, AlertTriangle, RefreshCw, XCircle } from "lucide-react";

const subDays = (e) => {
  if (e.payment_required || !e.next_due) return null;
  const d = Math.ceil((new Date(e.next_due).getTime() - Date.now()) / 86400000);
  return isNaN(d) ? null : d;
};

const downloadReceipt = async (e) => {
  try {
    const res = await api.get("/merchant/receipt", { params: { establishment_id: e.id }, responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = `comprovante-off360-${(e.fantasy_name || "estabelecimento").replace(/\s+/g, "-").toLowerCase()}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  } catch (err) { toast.error(formatApiError(err) || "Comprovante disponível somente após a ativação."); }
};

function CardManager({ e }) {
  const qc = useQueryClient();
  const { data: card, isLoading } = useQuery({ queryKey: ["m-card", e.id], queryFn: async () => (await api.get("/merchant/card", { params: { establishment_id: e.id } })).data });
  const [busy, setBusy] = useState(false);
  if (isLoading || !card?.has_card) return null;

  const swap = async () => {
    setBusy(true);
    try {
      const { data: r } = await api.post("/merchant/pay/card", { establishment_id: e.id });
      if (r.init_point) window.location.href = r.init_point;
      else { toast.error("Não foi possível iniciar a troca de cartão."); setBusy(false); }
    } catch (err) { toast.error(formatApiError(err)); setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await api.post("/merchant/card/cancel", { establishment_id: e.id });
      toast.success("Renovação automática cancelada.");
      qc.invalidateQueries({ queryKey: ["m-card", e.id] });
      qc.invalidateQueries({ queryKey: ["m-sub"] });
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 rounded-xl border border-off-blue/30 bg-off-surface/60 p-3" data-testid={`card-manager-${e.id}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-white"><CreditCard className="h-4 w-4 text-off-orange" /> Cartão de renovação automática</div>
      <div className="mt-1.5 text-xs text-gray-400">
        {card.last_four ? <>Cartão terminado em <b className="text-gray-200">•••• {card.last_four}</b></> : "Cartão vinculado"}
        {card.payment_method_id ? ` · ${card.payment_method_id}` : ""}
        {card.status ? ` · ${card.status === "authorized" ? "ativo" : card.status}` : ""}
      </div>
      {card.last_charge_failed && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-off-error/40 bg-off-error/10 p-2 text-[11px] text-off-error" data-testid={`card-failed-${e.id}`}>
          <AlertTriangle className="h-3.5 w-3.5" /> A última cobrança falhou. Troque o cartão para evitar o bloqueio.
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <Button data-testid={`card-swap-${e.id}`} onClick={swap} disabled={busy} size="sm" className="h-8 rounded-lg off-gradient text-xs font-semibold text-white"><RefreshCw className="mr-1 h-3.5 w-3.5" /> Trocar cartão</Button>
        <Button data-testid={`card-cancel-${e.id}`} onClick={cancel} disabled={busy} size="sm" variant="outline" className="h-8 rounded-lg border-off-error/40 text-xs text-off-error"><XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar renovação</Button>
      </div>
    </div>
  );
}

export default function Subscription() {
  const { data, isLoading } = useQuery({ queryKey: ["m-sub"], queryFn: async () => (await api.get("/merchant/subscription")).data });
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  if (isLoading || !data) return <Loading />;

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.delete("/merchant/account");
      toast.success("Sua conta foi encerrada e apagada.");
      setUser(false);
      navigate("/");
    } catch (err) {
      toast.error(formatApiError(err, "Não foi possível encerrar a conta. Tente novamente."));
      setDeleting(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Assinatura</h1>

      <div className="mt-5 off-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="rounded-xl off-gradient p-3"><CreditCard className="h-6 w-6 text-white" /></div><div><p className="font-display font-bold text-white">Plano por estabelecimento</p><p className="text-sm text-gray-400">Uma assinatura mensal para cada unidade ativa</p></div></div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div><p className="text-xs text-gray-400">Valor por unidade</p><p className="font-display text-lg font-bold text-white">{data.price_per_establishment != null ? money(data.price_per_establishment) : "A definir"}</p></div>
          <div><p className="text-xs text-gray-400">Unidades ativas</p><p className="font-display text-lg font-bold text-white">{data.active_count}/{data.count}</p></div>
          <div><p className="text-xs text-gray-400">Mensalidade total</p><p className="font-display text-lg font-bold text-off-orange">{data.monthly_total != null ? money(data.monthly_total) : "A definir"}</p></div>
        </div>
      </div>

      <div className="mt-4 off-card p-5">
        <h2 className="mb-3 font-display font-bold text-white">Composição por estabelecimento</h2>
        <div className="space-y-2">
          {data.establishments.map((e) => (
            <div key={e.id} className="rounded-xl bg-off-bg/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div><p className="font-medium text-white">{e.fantasy_name}</p><p className="text-xs text-gray-500">Vencimento: {e.next_due ? fmtDate(e.next_due, false) : "—"}{subDays(e) != null && <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${subDays(e) < 0 ? "bg-off-error/15 text-off-error" : subDays(e) <= 3 ? "bg-off-warning/15 text-off-warning" : "bg-off-blue/20 text-gray-300"}`}>{subDays(e) < 0 ? `Tolerância · ${Math.max(0, 2 + subDays(e))}d` : `Renova em ${subDays(e)}d`}</span>}</p></div>
                <div className="flex items-center gap-3">
                  {e.activated && <Button data-testid={`receipt-${e.id}`} onClick={() => downloadReceipt(e)} size="sm" variant="outline" className="h-8 rounded-lg border-off-blue/50 text-xs text-white"><Download className="mr-1 h-3.5 w-3.5" /> Comprovante</Button>}
                  <span className="text-sm text-gray-300">{e.value != null ? money(e.value) : "A definir"}</span>
                  <SubscriptionBadge status={e.subscription_status} />
                </div>
              </div>
              <CardManager e={e} />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-off-blue/40 bg-off-surface p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-off-orange" />
        <p className="text-sm text-gray-300">A renovação automática no <b>cartão</b> é cobrada a cada 30 dias. Você pode <b>trocar o cartão</b> ou <b>cancelar a renovação</b> a qualquer momento acima. Pagamentos por <b>Pix</b> são renovados manualmente.</p>
      </div>

      <div className="mt-6 off-card border border-off-error/40 p-5" data-testid="danger-zone">
        <h2 className="flex items-center gap-2 font-display font-bold text-off-error"><Trash2 className="h-5 w-5" /> Encerrar conta</h2>
        <p className="mt-2 text-sm text-gray-400">Ao encerrar, sua conta empresarial e <b>todos os seus estabelecimentos, catálogos, stories, destaques e pedidos</b> serão apagados permanentemente. Esta ação não pode ser desfeita.</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button data-testid="delete-account-btn" disabled={deleting} className="mt-4 h-11 rounded-xl bg-off-error font-semibold text-white hover:bg-off-error/90"><Trash2 className="mr-2 h-4 w-4" /> {deleting ? "Encerrando..." : "Encerrar e apagar minha conta"}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-off-error/40 bg-off-surface text-white" data-testid="delete-account-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">Encerrar e apagar sua conta?</AlertDialogTitle>
              <AlertDialogDescription className="text-gray-400">
                Esta ação é <b className="text-off-error">permanente</b>. Todos os seus estabelecimentos e dados vinculados serão apagados e você será desconectado. Não é possível recuperar depois.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="delete-account-cancel" className="border-off-blue/40 bg-transparent text-gray-300 hover:bg-off-bg">Cancelar</AlertDialogCancel>
              <AlertDialogAction data-testid="delete-account-confirm" onClick={deleteAccount} className="bg-off-error text-white hover:bg-off-error/90">Sim, apagar tudo</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
