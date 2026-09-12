import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatApiError } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MailCheck } from "lucide-react";

export default function Forgot() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const submittingRef = useRef(false);

  const submit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <button onClick={() => navigate(-1)} className="mb-6 self-start text-sm text-gray-400 hover:text-white">← Voltar</button>
        <div className="flex flex-col items-center text-center">
          <BrandMark size={72} />
          <h2 className="mt-4 font-display text-2xl font-bold text-white">Recuperar senha</h2>
          <p className="mt-2 text-sm text-gray-400">Enviaremos um link de redefinição para o seu e-mail.</p>
        </div>

        {sent ? (
          <div className="mt-8 rounded-2xl border border-off-success/40 bg-off-success/10 p-6 text-center" data-testid="forgot-sent">
            <MailCheck className="mx-auto h-12 w-12 text-off-success" />
            <p className="mt-3 text-sm text-white">Se o e-mail estiver cadastrado, enviamos um link de recuperação para <span className="font-semibold">{email}</span>.</p>
            <p className="mt-2 text-[12px] text-gray-400">Verifique também a caixa de spam. O link expira em 1 hora.</p>
            <Button data-testid="forgot-back-login" onClick={() => navigate("/login")} className="mt-5 h-11 w-full rounded-xl off-gradient font-semibold text-white">Voltar ao login</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <Label className="text-gray-300">E-mail</Label>
              <Input data-testid="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white" placeholder="seu@email.com" />
            </div>
            <Button data-testid="forgot-submit" type="submit" disabled={loading} className="h-12 w-full rounded-xl off-gradient font-semibold text-white">
              {loading ? "Enviando..." : "Enviar link de recuperação"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
