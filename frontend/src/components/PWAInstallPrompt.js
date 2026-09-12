import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, X, Share, PlusSquare } from "lucide-react";

const isIOS = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
  return iOS || iPadOS;
};

const isMobile = () => {
  if (typeof navigator === "undefined") return false;
  return /Android|iPad|iPhone|iPod|Mobile/i.test(navigator.userAgent || "");
};

const isStandalone = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
};

export default function PWAInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    if (installed || !isMobile()) return;

    const iosDevice = isIOS();
    setIos(iosDevice);

    // iOS/Safari não dispara beforeinstallprompt — mostramos as instruções manuais.
    if (iosDevice) {
      const t = setTimeout(() => setShow(true), 1200);
      return () => clearTimeout(t);
    }

    // Android/Chrome: captura o prompt nativo de instalação.
    const onBIP = (e) => { e.preventDefault(); setDeferred(e); setShow(true); };
    window.addEventListener("beforeinstallprompt", onBIP);

    const onInstalled = () => { setInstalled(true); setShow(false); setDeferred(null); };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [installed]);

  // Some automaticamente quando o app passa a rodar instalado (standalone).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(display-mode: standalone)");
    const handler = (e) => { if (e.matches) { setInstalled(true); setShow(false); } };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") { setShow(false); }
    } catch (_) { /* ignore */ }
    setDeferred(null);
  };

  if (installed || !show) return null;

  // ---------- iOS: pop-up com instruções ilustradas ----------
  if (ios) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 p-4 sm:items-center" data-testid="pwa-ios-popup">
        <div className="w-full max-w-sm rounded-2xl border border-off-blue/40 bg-off-surface p-5 shadow-2xl">
          <div className="mb-3 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <img src="/off360-icon.png" alt="OFF360" className="h-10 w-10 rounded-xl" />
              <div>
                <p className="font-display text-base font-bold text-white">Instalar o OFF360</p>
                <p className="text-[11px] text-gray-400">Acesso rápido direto da sua tela inicial.</p>
              </div>
            </div>
            <button data-testid="pwa-ios-close" onClick={() => setShow(false)} className="text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-3 rounded-xl border border-off-blue/30 bg-off-bg/50 p-3 text-sm text-gray-200">
            <p>Para instalar o OFF360:</p>
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-off-blue/20 text-off-blue"><Share className="h-4 w-4" /></span>
              <p className="text-[13px]">1. Toque no botão <span className="font-semibold text-white">Compartilhar</span> (quadrado com uma seta para cima), na barra do Safari.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-off-orange/20 text-off-orange"><PlusSquare className="h-4 w-4" /></span>
              <p className="text-[13px]">2. Depois toque em <span className="font-semibold text-white">Adicionar à Tela de Início</span>.</p>
            </div>
          </div>
          <Button data-testid="pwa-ios-ok" onClick={() => setShow(false)} className="mt-4 h-11 w-full rounded-xl off-gradient font-bold text-white">Entendi</Button>
        </div>
      </div>
    );
  }

  // ---------- Android: banner inferior com botão de instalar ----------
  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] p-3" data-testid="pwa-android-banner">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-off-blue/40 bg-off-surface p-3 shadow-2xl">
        <img src="/off360-icon.png" alt="OFF360" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-white">Instalar o OFF360</p>
          <p className="truncate text-[11px] text-gray-400">Adicione o app à tela inicial do seu celular.</p>
        </div>
        <Button data-testid="pwa-install-btn" onClick={install} className="h-10 shrink-0 rounded-xl off-gradient text-xs font-bold text-white">
          <Download className="mr-1.5 h-4 w-4" /> Instalar o OFF360
        </Button>
        <button data-testid="pwa-android-close" onClick={() => setShow(false)} className="shrink-0 text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
    </div>
  );
}
