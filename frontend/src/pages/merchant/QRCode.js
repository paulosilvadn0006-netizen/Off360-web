import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { api } from "@/lib/api";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Maximize2, Download, X, Sun, AlertTriangle } from "lucide-react";

export default function QRCodePage() {
  const { selectedId, establishments } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const [full, setFull] = useState(false);
  const { data, isLoading } = useQuery({ enabled: !!eid, queryKey: ["m-qr", eid], queryFn: async () => (await api.get("/merchant/qr", { params: { establishment_id: eid } })).data });

  const download = () => {
    const canvas = document.querySelector("#off-qr canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `off360-qr-${data.qr_token}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };
  useEffect(() => { if (full) { const p = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = p; }; } }, [full]);
  if (!eid) return <p className="text-gray-400">Selecione um estabelecimento.</p>;
  if (isLoading || !data) return <Loading />;
  const blocked = data.subscription_status !== "active" || data.approval_status !== "approved" || !data.discount_configured;

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Meu QR Code</h1>
      <p className="text-sm text-gray-400">Exiba no balcão para os clientes escanearem.</p>

      {blocked && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-off-warning/40 bg-off-warning/10 p-4 text-off-warning">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="text-sm">{!data.discount_configured ? "Configure o percentual de desconto em \"Estabelecimento\" para liberar as transações." : "Este estabelecimento ainda não está ativo. Aguarde a ativação da assinatura."}</span>
        </div>
      )}

      <div className="mx-auto mt-6 max-w-sm off-card p-6 text-center">
        <div id="off-qr" data-testid="qr-canvas" className={`mx-auto inline-flex rounded-2xl bg-white p-4 ${blocked ? "opacity-40" : ""}`}>
          <QRCodeCanvas value={data.qr_token} size={220} level="H" />
        </div>
        <h2 className="mt-4 font-display text-lg font-bold text-white">{data.fantasy_name}</h2>
        <p className="text-sm text-off-orange">{data.discount_configured ? `${data.discount_percent}% de desconto` : "Desconto não configurado"}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button data-testid="qr-fullscreen" onClick={() => setFull(true)} disabled={blocked} className="h-11 rounded-xl off-gradient font-semibold text-white"><Maximize2 className="mr-2 h-4 w-4" /> Tela cheia</Button>
          <Button data-testid="qr-download" onClick={download} variant="outline" className="h-11 rounded-xl border-off-blue/50 text-white"><Download className="mr-2 h-4 w-4" /> Baixar</Button>
        </div>
      </div>

      {full && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-white" data-testid="qr-fullscreen-view" style={{ filter: "brightness(1.15)" }}>
          <button onClick={() => setFull(false)} className="absolute right-5 top-5 rounded-full bg-black/10 p-2 text-black"><X className="h-6 w-6" /></button>
          <div className="rounded-3xl bg-white p-6 shadow-2xl"><QRCodeCanvas value={data.qr_token} size={300} level="H" /></div>
          <h2 className="mt-6 font-display text-2xl font-extrabold text-off-bg">{data.fantasy_name}</h2>
          <p className="text-lg font-bold text-off-orange">{data.discount_percent}% OFF · OFF 360</p>
          <p className="mt-3 flex items-center gap-1 text-xs text-gray-500"><Sun className="h-3 w-3" /> Brilho aumentado</p>
        </div>
      )}
    </div>
  );
}
