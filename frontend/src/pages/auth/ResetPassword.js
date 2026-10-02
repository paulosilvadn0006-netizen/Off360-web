import React, { useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatApiError } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, XCircle } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [form, setForm] = useState({ next: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [errState, setErrState] = useState(null); // expired | invalid | null
  const submittingRef = useRef(false);
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!token) { setErrState("invalid"); return; }
    if (form.next.length < 6) { toast.error("A nova senha deve ter ao menos 6 caracteres."); return; }
    if (form.next !== form.confirm) { toast.error("A nova senha e a confirmação não conferem."); return; }
    submittingRef.current = true;
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password: form.next });
      toast.success("Senha redefinida com sucesso! Faça login com a nova senha.");
      navigate("/login");
    } catch (err) {
      const status = err?.response?.status;
      if (status === 410) { setErrState("expired"); }
      else if (status === 400) { setErrState("invalid"); }
      else { toast.error(formatApiError(err)); submittingRef.current = false; }
    } finally {
      setLoading(false);
    }
  };

  if (errState) {
    const expired = errState === "expired";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-off-bg px-6 text-center">
        <div className="w-full max-w-md off-card p-8" data-testid="reset-error">
          <BrandMark size={56} className="mx-auto" />
          <div className="mt-6 flex flex-col items-center gap-3">
            {expired
              ? <Clock className="h-12 w-12 text-off-orange" data-testid="reset-expired-icon" />
              : <XCircle className="h-12 w-12 text-off-error" data-testid="reset-invalid-icon" />}
            <h1 className="font-display text-xl font-bold text-white">{expired ? "Link expirado" : "Link inválido ou já utilizado"}</h1>
            <p className="text-sm text-gray-400">
              {expired
                ? "Este link expirou. Solicite um novo link de redefinição de senha."
                : "Link inválido ou já utilizado."}
            </p>
            <Button data-testid="reset-request-new" onClick={() => navigate("/forgot")} className="mt-2 h-11 w-full rounded-xl off-gradient px-6 font-semibold text-white">
              Solicitar novo link
            </Button>
            <button onClick={() => navigate("/login")} className="mt-1 text-sm text-gray-400 underline">Voltar ao login</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <button onClick={() => navigate("/login")} className="mb-6 self-start text-sm text-gray-400 hover:text-white">← Voltar ao login</button>
        <div className="flex flex-col items-center text-center">
          <BrandMark size={72} />
          <h2 className="mt-4 font-display text-2xl font-bold text-white">Nova senha</h2>
          <p className="mt-2 text-sm text-gray-400">Escolha uma nova senha para a sua conta.</p>
        </div>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <Label className="text-gray-300">Nova senha</Label>
            <Input data-testid="reset-new" type="password" value={form.next} onChange={set("next")} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white" placeholder="Nova senha (mín. 6 caracteres)" />
          </div>
          <div>
            <Label className="text-gray-300">Repetir nova senha</Label>
            <Input data-testid="reset-confirm" type="password" value={form.confirm} onChange={set("confirm")} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white" placeholder="Confirme a nova senha" />
          </div>
          <Button data-testid="reset-submit" type="submit" disabled={loading} className="h-12 w-full rounded-xl off-gradient font-semibold text-white">
            {loading ? "Salvando..." : "Redefinir senha"}
          </Button>
        </form>
      </div>
    </div>
  );
}
