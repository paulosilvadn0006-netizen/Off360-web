import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext, useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { api } from "@/lib/api";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Maximize2, Download, X, Sun, AlertTriangle, Printer, Settings } from "lucide-react";

export default function QRCodePage() {
  const { selectedId, establishments, setSelectedId } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const navigate = useNavigate();
  const [full, setFull] = useState(false);
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
