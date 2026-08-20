import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, SubscriptionBadge, money, fmtDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { CreditCard, Info, Trash2 } from "lucide-react";

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
            <div key={e.id} className="flex items-center justify-between rounded-xl bg-off-bg/60 px-4 py-3">
              <div><p className="font-medium text-white">{e.fantasy_name}</p><p className="text-xs text-gray-500">Vencimento: {e.next_due ? fmtDate(e.next_due, false) : "—"}</p></div>
              <div className="flex items-center gap-3"><span className="text-sm text-gray-300">{e.value != null ? money(e.value) : "A definir"}</span><SubscriptionBadge status={e.subscription_status} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-off-blue/40 bg-off-surface p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-off-orange" />
        <p className="text-sm text-gray-300">A cobrança recorrente por <b>Pix</b> e <b>cartão</b> será habilitada em breve. Os valores serão definidos pela administração da OFF 360.</p>
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
