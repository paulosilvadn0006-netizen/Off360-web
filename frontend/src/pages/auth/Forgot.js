import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatApiError } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Forgot() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
      toast.success("Se o e-mail existir, enviaremos um link de recuperação.");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <button onClick={() => navigate(-1)} className="mb-6 self-start text-sm text-gray-400 hover:text-white">← Voltar</button>
        <div className="flex flex-col items-center text-center">
          <BrandMark size={72} />
          <h2 className="mt-4 font-display text-2xl font-bold text-white">Recuperar senha</h2>
          <p className="mt-2 text-sm text-gray-400">Informe seu e-mail e enviaremos um link de recuperação.</p>
        </div>
        {sent ? (
          <div className="mt-8 rounded-2xl border border-off-success/30 bg-off-success/10 p-5 text-center text-off-success">
            Verifique seu e-mail para redefinir a senha.
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <Label className="text-gray-300">E-mail</Label>
              <Input data-testid="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white" placeholder="seu@email.com" />
            </div>
            <Button data-testid="forgot-submit" type="submit" className="h-12 w-full rounded-xl off-gradient font-semibold text-white">Enviar link</Button>
          </form>
        )}
      </div>
    </div>
  );
}
