import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadDeviceId, getDeviceId } from "@/lib/mpSdk";
import { maskCpf, validCpf } from "@/lib/cnpj";
import { Lock, QrCode, CreditCard, Copy, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

const CARD_KEY = "off360_merchant_card_pref";

export default function Activate() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = new URLSearchParams(useLocation().search);
  const eid = search.get("eid");
  const [tab, setTab] = useState("pix");
  const [cpf, setCpf] = useState("");
  const [pix, setPix] = useState(null);
  const [gen, setGen] = useState(false);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef(null);

  const { data, isLoading } = useQuery({ queryKey: ["m-establishments"], queryFn: async () => (await api.get("/merchant/establishments")).data });
  const est = (data?.establishments || []).find((e) => e.id === eid) || (data?.establishments || [])[0];

  useEffect(() => { loadDeviceId(); }, []);

  const finish = () => {
    qc.invalidateQueries({ queryKey: ["m-establishments"] });
    qc.invalidateQueries({ queryKey: ["m-dashboard"] });
    qc.invalidateQueries({ queryKey: ["m-qr"] });
    toast.success("Pagamento confirmado! Estabelecimento ativado. 🎉");
    navigate("/merchant");
  };

  // Poll do Pix após gerar.
  useEffect(() => {
    if (!pix?.payment_id || !est?.id) return;
    pollRef.current = setInterval(async () => {
      try {
        const { data: st } = await api.get(`/merchant/pay/pix/${pix.payment_id}`, { params: { establishment_id: est.id } });
        if (st.status === "approved") { clearInterval(pollRef.current); finish(); }
      } catch { /* noop */ }
    }, 4000);
    return () => clearInterval(pollRef.current);
  }, [pix?.payment_id, est?.id]); // eslint-disable-line

  // Ao voltar do checkout de cartão (back_url), verifica a assinatura.
  useEffect(() => {
    const pref = (() => { try { return JSON.parse(sessionStorage.getItem(CARD_KEY) || "null"); } catch { return null; } })();
    if (pref?.preapproval_id && pref?.eid && est?.id === pref.eid) {
      (async () => {
        try {
          const { data: st } = await api.get(`/merchant/pay/card/${pref.preapproval_id}`, { params: { establishment_id: est.id } });
          if (st.status === "authorized") { sessionStorage.removeItem(CARD_KEY); finish(); }
        } catch { /* noop */ }
      })();
    }
  }, [est?.id]); // eslint-disable-line

  if (isLoading) return <Loading />;
  if (!est) return <p className="text-gray-400">Nenhum estabelecimento encontrado.</p>;

  if (!est.payment_required) {
    return (
      <div className="animate-fade-up mx-auto max-w-lg off-card p-8 text-center" data-testid="activate-already-active">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-off-success/15 text-off-success"><CheckCircle2 className="h-8 w-8" /></div>
        <h1 className="mt-4 font-display text-2xl font-bold text-white">{est.fantasy_name} está ativo!</h1>
        <p className="mt-2 text-sm text-gray-400">Todas as funcionalidades estão liberadas.</p>
        <Button data-testid="activate-go-dashboard" onClick={() => navigate("/merchant")} className="mt-6 h-11 rounded-xl off-gradient px-6 font-semibold text-white">Ir para o painel</Button>
      </div>
    );
  }

  const genPix = async () => {
    if (!validCpf(cpf)) { toast.error("Informe um CPF válido para gerar o Pix."); return; }
    setGen(true);
    try {
      const { data: r } = await api.post("/merchant/pay/pix", { establishment_id: est.id, cpf, device_id: getDeviceId() });
      setPix(r);
    } catch (err) { toast.error(formatApiError(err) || "Não foi possível gerar o Pix."); } finally { setGen(false); }
  };

  const copyPix = () => { if (pix?.qr_code) { navigator.clipboard?.writeText(pix.qr_code); toast.success("Código Pix copiado!"); } };

  const payCard = async () => {
    try {
      const { data: r } = await api.post("/merchant/pay/card", { establishment_id: est.id });
      if (r.init_point) {
        sessionStorage.setItem(CARD_KEY, JSON.stringify({ preapproval_id: r.preapproval_id, eid: est.id }));
        window.location.href = r.init_point;
      } else toast.error("Não foi possível iniciar o pagamento por cartão.");
    } catch (err) { toast.error(formatApiError(err) || "Não foi possível iniciar o pagamento por cartão."); }
  };

  const recheck = async () => {
    setChecking(true);
    try {
      let ok = false;
      if (pix?.payment_id) {
        const { data: st } = await api.get(`/merchant/pay/pix/${pix.payment_id}`, { params: { establishment_id: est.id } });
        ok = st.status === "approved";
      }
      const pref = (() => { try { return JSON.parse(sessionStorage.getItem(CARD_KEY) || "null"); } catch { return null; } })();
      if (!ok && pref?.preapproval_id) {
        const { data: st } = await api.get(`/merchant/pay/card/${pref.preapproval_id}`, { params: { establishment_id: est.id } });
        ok = st.status === "authorized";
      }
      if (ok) finish(); else toast("Pagamento ainda não confirmado. Assim que o MercadoPago aprovar, liberamos automaticamente.");
    } catch { toast.error("Não foi possível verificar o pagamento agora."); } finally { setChecking(false); }
  };

  return (
    <div className="animate-fade-up mx-auto max-w-lg" data-testid="activate-page">
      <div className="off-card overflow-hidden">
        <div className="border-b border-off-blue/30 bg-off-warning/10 p-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-off-warning/20 text-off-warning"><Lock className="h-7 w-7" /></div>
          <h1 className="mt-3 font-display text-xl font-bold text-white">Seu estabelecimento foi cadastrado!</h1>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-300">Para ativar <b className="text-white">{est.fantasy_name}</b> no OFF360 e liberar todas as funcionalidades, conclua o pagamento de <b className="text-off-orange">R$ 89,90/mês</b>.</p>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-off-bg/60 p-1">
            <button data-testid="activate-tab-pix" onClick={() => setTab("pix")} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${tab === "pix" ? "off-gradient text-white" : "text-gray-400"}`}><QrCode className="h-4 w-4" /> Pix</button>
            <button data-testid="activate-tab-card" onClick={() => setTab("card")} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${tab === "card" ? "off-gradient text-white" : "text-gray-400"}`}><CreditCard className="h-4 w-4" /> Cartão</button>
          </div>

          {tab === "pix" && (
            <div className="mt-4 space-y-3" data-testid="activate-pix">
              {!pix ? (
                <>
                  <label className="block text-xs font-semibold text-gray-300">CPF do responsável (para o Pix)</label>
                  <Input data-testid="activate-cpf" value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} inputMode="numeric" placeholder="000.000.000-00" className="off-input" />
                  <Button data-testid="activate-gen-pix" onClick={genPix} disabled={gen} className="h-12 w-full rounded-xl off-gradient font-semibold text-white">{gen ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando Pix...</> : "Gerar Pix de R$ 89,90"}</Button>
                </>
              ) : (
                <div className="text-center">
                  {pix.qr_code_base64 && <img data-testid="activate-pix-qr" alt="QR Code Pix" src={`data:image/png;base64,${pix.qr_code_base64}`} className="mx-auto h-56 w-56 rounded-xl bg-white p-2" />}
                  <p className="mt-3 text-xs text-gray-400">Escaneie com o app do seu banco ou copie o código abaixo.</p>
                  {pix.qr_code && (
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-off-blue/40 bg-off-bg p-2">
                      <span className="flex-1 truncate text-left text-[11px] text-gray-300">{pix.qr_code}</span>
                      <button data-testid="activate-copy-pix" onClick={copyPix} className="shrink-0 rounded-lg off-gradient px-3 py-1.5 text-xs font-semibold text-white"><Copy className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-off-orange"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando confirmação do pagamento...</p>
                </div>
              )}
            </div>
          )}

          {tab === "card" && (
            <div className="mt-4 space-y-3" data-testid="activate-card">
              <p className="text-sm text-gray-300">Assinatura mensal recorrente de <b className="text-off-orange">R$ 89,90</b> no cartão de crédito. Você será direcionado ao ambiente seguro do Mercado Pago.</p>
              <Button data-testid="activate-pay-card" onClick={payCard} className="h-12 w-full rounded-xl off-gradient font-semibold text-white"><CreditCard className="mr-2 h-4 w-4" /> Pagar com cartão</Button>
            </div>
          )}

          <button data-testid="activate-recheck" onClick={recheck} disabled={checking} className="mt-4 w-full text-center text-xs font-semibold text-gray-400 underline">{checking ? "Verificando..." : "Já concluí o pagamento — verificar agora"}</button>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-gray-500"><ShieldCheck className="h-3.5 w-3.5" /> Pagamento processado com segurança via Mercado Pago · Renovação automática em 30 dias.</p>
        </div>
      </div>
    </div>
  );
}
