import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { MailCheck } from "lucide-react";

export default function VerifyEmailPending() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);

  const resend = async () => {
    setSending(true);
    try {
      await api.post("/auth/resend-verification");
      toast.success("E-mail de confirmação reenviado!");
    } catch (e) {
      toast.error("Não foi possível reenviar agora.");
    } finally { setSending(false); }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-off-bg px-6 text-center">
      <div className="w-full max-w-md off-card p-8" data-testid="verify-pending">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-off-orange/15 text-off-orange"><MailCheck className="h-8 w-8" /></div>
        <BrandMark size={52} className="mx-auto mt-4" />
        <h1 className="mt-4 font-display text-2xl font-bold text-white">Verifique seu e-mail para ativar sua conta</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-gray-400">
          Enviamos um link de confirmação para <b className="text-white">{user?.email || "seu e-mail"}</b>. Clique no link para liberar o acesso ao painel.
        </p>
        <Button data-testid="verify-resend" onClick={resend} disabled={sending} className="mt-6 h-11 w-full rounded-xl off-gradient font-semibold text-white">
          {sending ? "Reenviando..." : "Reenviar e-mail de confirmação"}
        </Button>
        <button data-testid="verify-logout" onClick={() => { logout(); navigate("/login"); }} className="mt-3 text-sm text-gray-400 underline">Sair e voltar ao login</button>
      </div>
    </div>
  );
}
