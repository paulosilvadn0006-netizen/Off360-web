import React, { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [state, setState] = useState("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    if (!token) { setState("error"); return; }
    (async () => {
      try {
        const { data: u } = await api.post("/auth/verify-email", { token });
        await refresh?.();
        setState("ok");
        setTimeout(() => navigate(u.role === "merchant" ? "/merchant" : "/home", { replace: true }), 1800);
      } catch (e) { setState("error"); }
    })();
  }, []); // eslint-disable-line

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-off-bg px-6 text-center">
      <div className="w-full max-w-md off-card p-8" data-testid="verify-email">
        <BrandMark size={56} className="mx-auto" />
        {state === "loading" && <div className="mt-6 flex flex-col items-center gap-3 text-gray-300"><Loader2 className="h-8 w-8 animate-spin text-off-orange" /><p>Confirmando seu e-mail...</p></div>}
        {state === "ok" && (
          <div className="mt-6 flex flex-col items-center gap-3" data-testid="verify-ok">
            <CheckCircle2 className="h-12 w-12 text-off-success" />
            <h1 className="font-display text-2xl font-bold text-white">E-mail confirmado!</h1>
            <p className="text-sm text-gray-400">Sua conta está ativa. Redirecionando ao painel...</p>
          </div>
        )}
        {state === "error" && (
          <div className="mt-6 flex flex-col items-center gap-3" data-testid="verify-error">
            <XCircle className="h-12 w-12 text-off-error" />
            <h1 className="font-display text-xl font-bold text-white">Link inválido ou expirado</h1>
            <p className="text-sm text-gray-400">Entre e solicite um novo e-mail de confirmação.</p>
            <Button onClick={() => navigate("/login")} className="mt-2 h-11 rounded-xl off-gradient px-6 font-semibold text-white">Ir para o login</Button>
          </div>
        )}
      </div>
    </div>
  );
}
