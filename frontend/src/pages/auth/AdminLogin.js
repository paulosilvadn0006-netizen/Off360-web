import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth, formatApiError } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";

export default function AdminLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await login(email, password);
      if (u.role !== "admin") {
        toast.error("Acesso restrito ao administrador.");
        setLoading(false);
        return;
      }
      toast.success("Acesso administrativo autorizado.");
      navigate("/admin");
    } catch (err) {
      toast.error(formatApiError(err));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <button onClick={() => navigate("/")} className="mb-6 self-start text-sm text-gray-400 hover:text-white">← Voltar</button>
        <div className="flex flex-col items-center text-center">
          <BrandMark size={72} />
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-off-blue/40 bg-off-surface px-4 py-1.5 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-off-orange" /> Painel Administrativo OFF 360
          </div>
        </div>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <Label className="text-gray-300">E-mail</Label>
            <Input data-testid="admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white" placeholder="admin@off360.com" />
          </div>
          <div>
            <Label className="text-gray-300">Senha</Label>
            <Input data-testid="admin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white" placeholder="••••••••" />
          </div>
          <Button data-testid="admin-submit" type="submit" disabled={loading} className="h-12 w-full rounded-xl off-gradient font-semibold text-white">
            {loading ? "Verificando..." : "Acessar painel"}
          </Button>
        </form>
      </div>
    </div>
  );
}
