import React from "react";
import { useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { User, Store, ArrowRight } from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();
  return (
    <div className="relative min-h-screen overflow-hidden bg-off-bg">
      <div className="pointer-events-none absolute -top-40 -right-32 h-96 w-96 rounded-full bg-off-orange/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-off-blue/40 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="animate-fade-up">
            <BrandMark size={116} />
          </div>
          <h1 className="mt-8 animate-fade-up font-display text-4xl font-extrabold tracking-tight text-white" style={{ animationDelay: "60ms" }}>
            OFF <span className="off-gradient-text">360</span>
          </h1>
          <p className="mt-3 animate-fade-up font-display text-lg font-semibold text-white" style={{ animationDelay: "120ms" }}>
            Conectando <span className="off-gradient-text">você</span> ao que importa
          </p>
          <p className="mt-3 max-w-xs animate-fade-up text-sm text-gray-400" style={{ animationDelay: "180ms" }}>
            Descontos, serviços, eventos e oportunidades perto de você.
          </p>
        </div>

        <div className="space-y-3 pb-6">
          <Button
            data-testid="enter-consumer-btn"
            onClick={() => navigate("/login?role=consumer")}
            className="group h-14 w-full justify-between rounded-2xl off-gradient text-base font-semibold text-white shadow-[0_10px_30px_rgba(255,75,18,0.35)] transition-transform active:scale-[0.98] hover:opacity-95"
          >
            <span className="flex items-center gap-3"><User className="h-5 w-5" /> Entrar como consumidor</span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Button>

          <Button
            data-testid="enter-merchant-btn"
            onClick={() => navigate("/login?role=merchant")}
            variant="outline"
            className="group h-14 w-full justify-between rounded-2xl border-off-blue/60 bg-off-surface/70 text-base font-semibold text-white transition-transform active:scale-[0.98] hover:bg-off-surface"
          >
            <span className="flex items-center gap-3"><Store className="h-5 w-5 text-off-orange" /> Entrar como empresário</span>
            <ArrowRight className="h-5 w-5 text-off-orange transition-transform group-hover:translate-x-1" />
          </Button>

          <div className="pt-2 text-center text-sm text-gray-400">
            Novo por aqui?{" "}
            <button data-testid="goto-register-btn" onClick={() => navigate("/register")} className="font-semibold text-off-orange hover:underline">
              Criar conta
            </button>
          </div>
          <div className="text-center">
            <button data-testid="goto-admin-btn" onClick={() => navigate("/admin-access")} className="text-xs text-gray-600 hover:text-gray-400">
              Acesso administrativo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
