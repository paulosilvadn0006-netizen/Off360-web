import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth, formatApiError } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert } from "lucide-react";

export default function AdminChangePassword() {
  const { refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) { toast.error("A confirmação não confere"); return; }
    setLoading(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      await refresh();
      toast.success("Senha atualizada. Acesso liberado.");
      navigate("/admin");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally { setLoading(false); }
  };

  const cancel = async () => { await logout(); navigate("/admin-access"); };

  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <div className="flex flex-col items-center text-center">
          <BrandMark size={96} />
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-off-warning/40 bg-off-warning/10 px-4 py-1.5 text-sm font-semibold text-off-warning">
            <ShieldAlert className="h-4 w-4" /> Troca de senha obrigatória
          </div>
          <p className="mt-3 text-sm text-gray-400">Por segurança, defina uma nova senha para acessar o painel administrativo.</p>
        </div>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <Label className="text-gray-300">Senha temporária atual</Label>
            <Input data-testid="chg-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white" placeholder="••••••••" />
          </div>
          <div>
            <Label className="text-gray-300">Nova senha</Label>
            <Input data-testid="chg-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6}
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white" placeholder="Mínimo 6 caracteres" />
          </div>
          <div>
            <Label className="text-gray-300">Confirmar nova senha</Label>
            <Input data-testid="chg-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white" placeholder="Repita a nova senha" />
          </div>
          <Button data-testid="chg-submit" type="submit" disabled={loading} className="h-12 w-full rounded-xl off-gradient font-semibold text-white">
            {loading ? "Salvando..." : "Definir nova senha e entrar"}
          </Button>
          <button type="button" onClick={cancel} className="w-full text-center text-sm text-gray-500 hover:text-gray-300">Cancelar e sair</button>
        </form>
      </div>
    </div>
  );
}
