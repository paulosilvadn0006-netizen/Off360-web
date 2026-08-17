import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth, formatApiError } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Store, Bike } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const role = params.get("role") || "consumer";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await login(email, password);
      if (role === "consumer" && u.role !== "consumer") {
        toast.error("Esta conta não é de consumidor.");
      } else if (role === "merchant" && u.role !== "merchant") {
        toast.error("Esta conta não é de empresário.");
      } else if (role === "deliverer" && u.role !== "deliverer") {
        toast.error("Esta conta não é de entregador.");
      }
      toast.success("Bem-vindo(a) à OFF 360!");
      navigate(u.role === "merchant" ? "/merchant" : u.role === "deliverer" ? "/deliverer" : u.role === "admin" ? "/admin" : "/home");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const roleIcon = role === "merchant" ? <Store className="h-4 w-4 text-off-orange" /> : role === "deliverer" ? <Bike className="h-4 w-4 text-off-orange" /> : <User className="h-4 w-4 text-off-orange" />;
  const roleLabel = role === "merchant" ? "Área do Empresário" : role === "deliverer" ? "Entregador · 360Taxi" : "Área do Consumidor";
  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <button onClick={() => navigate("/")} className="mb-6 self-start text-sm text-gray-400 hover:text-white">← Voltar</button>
        <div className="flex flex-col items-center text-center">
          <BrandMark size={84} />
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-off-blue/40 bg-off-surface px-4 py-1.5 text-sm font-semibold text-white">
            {roleIcon}
            {roleLabel}
          </div>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4 animate-fade-up">
          <div>
            <Label className="text-gray-300">E-mail ou WhatsApp</Label>
            <Input data-testid="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white placeholder:text-gray-500" placeholder="seu@email.com" />
          </div>
          <div>
            <Label className="text-gray-300">Senha</Label>
            <Input data-testid="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white placeholder:text-gray-500" placeholder="••••••••" />
          </div>
          <div className="text-right">
            <Link to="/forgot" className="text-sm text-off-orange hover:underline">Esqueci minha senha</Link>
          </div>
          <Button data-testid="login-submit" type="submit" disabled={loading}
            className="h-13 h-12 w-full rounded-xl off-gradient text-base font-semibold text-white transition-transform active:scale-[0.98]">
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          Não tem conta?{" "}
          <Link to={`/register?role=${role}`} className="font-semibold text-off-orange hover:underline">Criar conta</Link>
        </p>
      </div>
    </div>
  );
}
