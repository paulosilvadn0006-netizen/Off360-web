import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext, useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Maximize2, Download, X, Sun, AlertTriangle, Printer, Settings, Zap, ShieldCheck, Check } from "lucide-react";

export default function QRCodePage() {
  const { selectedId, establishments, setSelectedId } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [full, setFull] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const { data, isLoading } = useQuery({ enabled: !!eid, queryKey: ["m-qr", eid], queryFn: async () => (await api.get("/merchant/qr", { params: { establishment_id: eid } })).data });

  useEffect(() => { if (full) { const p = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = p; }; } }, [full]);
  if (!eid) return <p className="text-gray-400">Selecione um estabelecimento.</p>;
  if (isLoading || !data) return <Loading />;
  const incomplete = !data.registration_complete;
  const noDiscount = !data.discount_configured;
  const notActive = data.subscription_status !== "active" || data.approval_status !== "approved";
  const blocked = incomplete || notActive;

  const highResDataUrl = () => {
    const canvas = document.querySelector("#off-qr-hi canvas");
    return canvas ? canvas.toDataURL("image/png") : null;
  };
  const download = () => {
    const url = highResDataUrl(); if (!url) return;
    const link = document.createElement("a");
    link.download = `off360-qr-${data.fantasy_name.replace(/\s+/g, "-").toLowerCase()}.png`;
    link.href = url; link.click();
  };
  const print = () => {
    const url = highResDataUrl(); if (!url) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>QR Code · ${data.fantasy_name}</title></head><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
      <img src="${url}" style="width:360px;height:360px;image-rendering:pixelated;" />
      <h2 style="margin-top:16px;">${data.fantasy_name}</h2>
      <p style="color:#ff7a00;font-weight:bold;">${data.discount_percent}% OFF · OFF 360</p>
      <script>window.onload=()=>{window.print();}</script></body></html>`);
    w.document.close();
  };

  const mode = data.validation_mode || "controlled";
  const setMode = async (m) => {
    if (m === mode || savingMode) return;
    setSavingMode(true);
    try {
      await api.put(`/merchant/establishment/${eid}`, { validation_mode: m });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["m-qr"] }),
        qc.invalidateQueries({ queryKey: ["m-est"] }),
      ]);
      toast.success(m === "fast" ? "Modo Rápido ativado." : "Modo Controlado ativado.");
    } catch (err) { toast.error(formatApiError(err)); } finally { setSavingMode(false); }
  };

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Meu QR Code</h1>
      <p className="text-sm text-gray-400">Exiba no balcão para os clientes escanearem.</p>

      {blocked && (
        <div className="mt-4 rounded-2xl border border-off-warning/40 bg-off-warning/10 p-4 text-off-warning">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="text-sm">{noDiscount ? "Configure o desconto deste estabelecimento para liberar as transações."
              : incomplete ? "Complete o cadastro do estabelecimento (categoria, endereço e desconto) para liberar o QR Code."
              : "Este estabelecimento ainda não está ativo. Aguarde a ativação da assinatura."}</span>
          </div>
          {(noDiscount || incomplete) && (
            <Button data-testid="qr-configure-discount" onClick={() => { setSelectedId(eid); navigate("/merchant/establishment"); }} className="mt-3 h-10 rounded-xl off-gradient text-sm font-semibold text-white"><Settings className="mr-1.5 h-4 w-4" /> {noDiscount ? "CONFIGURAR DESCONTO" : "CONTINUAR CADASTRO"}</Button>
          )}
        </div>
      )}

      {/* offscreen hi-res canvas for download/print */}
      <div id="off-qr-hi" style={{ position: "absolute", left: -99999, top: 0 }} aria-hidden>
        <QRCodeCanvas value={data.qr_token} size={1024} level="H" bgColor="#FFFFFF" fgColor="#000000" marginSize={4} />
      </div>

      <div className="mx-auto mt-6 max-w-sm off-card p-6 text-center">
        <div id="off-qr" data-testid="qr-canvas" className={`mx-auto inline-flex rounded-2xl bg-white p-4 ${blocked ? "opacity-40" : ""}`}>
          <QRCodeCanvas value={data.qr_token} size={320} level="H" bgColor="#FFFFFF" fgColor="#000000" marginSize={2} />
        </div>
        <h2 className="mt-4 font-display text-lg font-bold text-white">{data.fantasy_name}</h2>
        <p className="text-sm text-off-orange">{data.discount_configured ? `${data.discount_percent}% de desconto` : "Desconto não configurado"}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button data-testid="qr-fullscreen" onClick={() => setFull(true)} disabled={blocked} className="h-11 rounded-xl off-gradient font-semibold text-white"><Maximize2 className="mr-2 h-4 w-4" /> Tela cheia</Button>
          <Button data-testid="qr-download" onClick={download} disabled={blocked} variant="outline" className="h-11 rounded-xl border-off-blue/50 text-white"><Download className="mr-2 h-4 w-4" /> Baixar</Button>
          <Button data-testid="qr-print" onClick={print} disabled={blocked} variant="outline" className="h-11 rounded-xl border-off-blue/50 text-white"><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>
          <Button data-testid="qr-test" onClick={() => setFull(true)} disabled={blocked} variant="outline" className="h-11 rounded-xl border-off-orange/50 text-off-orange"><Sun className="mr-2 h-4 w-4" /> Testar</Button>
        </div>
      </div>

      {/* Configuração do funcionamento do QR Code — mesma config real (validation_mode) */}
      <div className="mx-auto mt-5 max-w-sm off-card p-5" data-testid="qr-mode-card">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-off-orange" />
          <h3 className="font-display text-base font-bold text-white">Funcionamento do QR Code</h3>
        </div>
        <p className="mt-1 text-xs text-gray-400">Escolha como a venda é validada ao escanear este QR Code.</p>
        <div className="mt-4 space-y-3">
          <button
            data-testid="qr-mode-fast"
            onClick={() => setMode("fast")}
            disabled={savingMode}
            className={`w-full rounded-2xl border p-4 text-left transition ${mode === "fast" ? "border-off-orange bg-off-orange/10" : "border-off-blue/40 bg-off-bg/40 hover:border-off-orange/50"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className={`h-5 w-5 ${mode === "fast" ? "text-off-orange" : "text-gray-400"}`} />
                <span className="font-semibold text-white">Modo Rápido</span>
              </div>
              {mode === "fast"
                ? <span data-testid="qr-mode-fast-active" className="inline-flex items-center gap-1 rounded-full bg-off-success px-2 py-0.5 text-[10px] font-bold text-white"><Check className="h-3 w-3" /> ATIVO</span>
                : <span className="text-[10px] font-semibold text-gray-500">Selecionar</span>}
            </div>
            <p className="mt-1.5 text-xs text-gray-300">O estabelecimento informa o valor da compra. O cliente digita o valor no app e mostra o cálculo do desconto para o caixa conferir.</p>
          </button>

          <button
            data-testid="qr-mode-controlled"
            onClick={() => setMode("controlled")}
            disabled={savingMode}
            className={`w-full rounded-2xl border p-4 text-left transition ${mode === "controlled" ? "border-off-orange bg-off-orange/10" : "border-off-blue/40 bg-off-bg/40 hover:border-off-orange/50"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className={`h-5 w-5 ${mode === "controlled" ? "text-off-orange" : "text-gray-400"}`} />
                <span className="font-semibold text-white">Modo Controlado</span>
              </div>
              {mode === "controlled"
                ? <span data-testid="qr-mode-controlled-active" className="inline-flex items-center gap-1 rounded-full bg-off-success px-2 py-0.5 text-[10px] font-bold text-white"><Check className="h-3 w-3" /> ATIVO</span>
                : <span className="text-[10px] font-semibold text-gray-500">Selecionar</span>}
            </div>
            <p className="mt-1.5 text-xs text-gray-300">O estabelecimento digita o valor da compra no app e confirma a venda dentro do app após receber o pagamento.</p>
          </button>
        </div>
        <p className="mt-3 text-[11px] text-gray-500">Esta é a mesma configuração de "Tipo de validação" do cadastro do estabelecimento — alterar aqui reflete lá e vice-versa.</p>
      </div>

      {full && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-white" data-testid="qr-fullscreen-view" style={{ filter: "brightness(1.15)" }}>
          <button onClick={() => setFull(false)} className="absolute right-5 top-5 rounded-full bg-black/10 p-2 text-black"><X className="h-6 w-6" /></button>
          <div className="rounded-3xl bg-white p-6 shadow-2xl"><QRCodeCanvas value={data.qr_token} size={360} level="H" bgColor="#FFFFFF" fgColor="#000000" marginSize={2} /></div>
          <h2 className="mt-6 font-display text-2xl font-extrabold text-off-bg">{data.fantasy_name}</h2>
          <p className="text-lg font-bold text-off-orange">{data.discount_percent}% OFF · OFF 360</p>
          <p className="mt-3 flex items-center gap-1 text-xs text-gray-500"><Sun className="h-3 w-3" /> Brilho aumentado para leitura</p>
        </div>
      )}
    </div>
  );
}
