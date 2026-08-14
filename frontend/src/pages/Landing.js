import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { User, Store, ArrowRight, Truck } from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();
  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-hidden"
      style={{ background: "linear-gradient(160deg, #020817 0%, #061532 100%)" }}
    >
      {/* Detalhes discretos em azul e laranja nos cantos (curvas inspiradas no logo) */}
      <div className="pointer-events-none absolute -top-24 -right-20 h-72 w-72 rounded-full bg-off-orange/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-24 h-80 w-80 rounded-full bg-off-blue/25 blur-3xl" />
      <div className="pointer-events-none absolute -left-40 top-1/3 h-[560px] w-[560px] rounded-full border border-off-blue/15" />
      <div className="pointer-events-none absolute -right-52 -top-24 h-[520px] w-[520px] rounded-full border border-off-orange/10" />

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-6"
        style={{ paddingTop: "7vh" }}>

        {/* Logo horizontal oficial — elemento principal único, sem card/moldura */}
        <img
          src="/off360-horizontal.png"
          alt="OFF 360 — Conectando você ao que importa"
          data-testid="landing-logo"
          className="w-[86%] max-w-[520px] object-contain sm:w-[72%] md:max-w-[560px] lg:max-w-[660px]"
        />

        {/* Texto de apoio (não repetir o slogan que já está no logo) */}
        <p
          data-testid="landing-support-text"
          className="mt-6 max-w-[85%] text-center text-base leading-relaxed text-gray-300 md:max-w-[520px]"
        >
          Descontos, serviços, eventos e oportunidades perto de você.
        </p>

        {/* Botões */}
        <div className="mt-9 flex w-[88%] max-w-[480px] flex-col gap-4 lg:max-w-[460px]">
          <Button
            data-testid="enter-consumer-btn"
            onClick={() => navigate("/login?role=consumer")}
            className="group flex h-[60px] w-full items-center justify-between rounded-2xl off-gradient px-6 text-base font-semibold text-white shadow-[0_12px_30px_rgba(255,75,18,0.35)] transition-transform active:scale-[0.98] hover:opacity-95"
          >
            <span className="flex items-center gap-3"><User className="h-5 w-5" /> Entrar como consumidor</span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Button>

          <Button
            data-testid="enter-merchant-btn"
            onClick={() => navigate("/login?role=merchant")}
            className="group flex h-[60px] w-full items-center justify-between rounded-2xl border border-off-orange/40 bg-off-surface px-6 text-base font-semibold text-white transition-transform active:scale-[0.98] hover:bg-off-surface/80"
          >
            <span className="flex items-center gap-3"><Store className="h-5 w-5 text-off-orange" /> Entrar como empresário</span>
            <ArrowRight className="h-5 w-5 text-off-orange transition-transform group-hover:translate-x-1" />
          </Button>

          <button
            data-testid="enter-deliverer-btn"
            onClick={() => navigate("/login?role=deliverer")}
            className="group -mt-1 flex items-center justify-center gap-1.5 self-center text-sm font-medium text-gray-400 transition-colors hover:text-off-orange"
          >
            <Truck className="h-4 w-4" /> Sou entregador
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>

          <p className="mt-1 text-center text-sm text-gray-400">
            Novo por aqui?{" "}
            <button data-testid="goto-register-btn" onClick={() => navigate("/register")} className="font-semibold text-off-orange hover:underline">
              Criar conta
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
