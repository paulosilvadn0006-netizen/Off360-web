import React, { useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatApiError } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [form, setForm] = useState({ next: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!token) { toast.error("Link inválido. Solicite a recuperação novamente."); return; }
    if (form.next.length < 6) { toast.error("A nova senha deve ter ao menos 6 caracteres."); return; }
    if (form.next !== form.confirm) { toast.error("A nova senha e a confirmação não conferem."); return; }
    submittingRef.current = true;
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password: form.next });
      toast.success("Senha redefinida com sucesso! Faça login com a nova senha.");
      navigate("/login");
    } catch (err) {
      toast.error(formatApiError(err));
      submittingRef.current = false;
    } finally {
      setLoading(false);
    }
  };

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
