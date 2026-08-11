import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { api } from "@/lib/api";
import { Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Maximize2, Download, X, Sun } from "lucide-react";

export default function QRCodePage() {
  const [full, setFull] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["m-qr"], queryFn: async () => (await api.get("/merchant/qr")).data });

  const download = () => {
    const canvas = document.querySelector("#off-qr canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `off360-qr-${data.qr_token}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  useEffect(() => {
    if (full) { const prev = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = prev; }; }
  }, [full]);

  if (isLoading || !data) return <Loading />;

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Meu QR Code</h1>
      <p className="text-sm text-gray-400">Exiba no balcão para os clientes escanearem e validarem a compra.</p>

      <div className="mx-auto mt-6 max-w-sm off-card p-6 text-center">
        <div id="off-qr" data-testid="qr-canvas" className="mx-auto inline-flex rounded-2xl bg-white p-4">
          <QRCodeCanvas value={data.qr_token} size={220} level="H" includeMargin={false} />
        </div>
        <h2 className="mt-4 font-display text-lg font-bold text-white">{data.fantasy_name}</h2>
        <p className="text-sm text-off-orange">{data.discount_percent}% de desconto OFF 360</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button data-testid="qr-fullscreen" onClick={() => setFull(true)} className="h-11 rounded-xl off-gradient font-semibold text-white"><Maximize2 className="mr-2 h-4 w-4" /> Tela cheia</Button>
          <Button data-testid="qr-download" onClick={download} variant="outline" className="h-11 rounded-xl border-off-blue/50 text-white"><Download className="mr-2 h-4 w-4" /> Baixar</Button>
        </div>
      </div>

      {full && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-white" data-testid="qr-fullscreen-view" style={{ filter: "brightness(1.15)" }}>
          <button onClick={() => setFull(false)} className="absolute right-5 top-5 rounded-full bg-black/10 p-2 text-black"><X className="h-6 w-6" /></button>
          <div className="rounded-3xl bg-white p-6 shadow-2xl">
            <QRCodeCanvas value={data.qr_token} size={300} level="H" />
          </div>
          <h2 className="mt-6 font-display text-2xl font-extrabold text-off-bg">{data.fantasy_name}</h2>
          <p className="text-lg font-bold text-off-orange">{data.discount_percent}% OFF · OFF 360</p>
          <p className="mt-3 flex items-center gap-1 text-xs text-gray-500"><Sun className="h-3 w-3" /> Brilho aumentado para leitura</p>
        </div>
      )}
    </div>
  );
}
