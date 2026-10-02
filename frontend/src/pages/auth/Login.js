import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth, formatApiError } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Store, Car, User } from "lucide-react";
import { GoogleBtn, startGoogle } from "@/components/auth/Social";

const PROFILES = [
  { key: "merchant", label: "Empresário", icon: Store },
  { key: "deliverer", label: "Motorista", icon: Car },
  { key: "consumer", label: "Consumidor", icon: User },
];
const LABELS = { merchant: "Empresário", deliverer: "Motorista", consumer: "Consumidor" };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const taxi = params.get("taxi") === "1";
  const initial = taxi ? "deliverer" : (params.get("role") || "consumer");
  const [profile, setProfile] = useState(["merchant", "deliverer", "consumer"].includes(initial) ? initial : "consumer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("off360_login_email");
      if (saved) { setEmail(saved); setRemember(true); }
    } catch (_) {}
  }, []);

  const go = (role) => navigate(role === "merchant" ? "/merchant" : role === "deliverer" ? "/deliverer" : role === "admin" ? "/admin" : "/home");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await login(email, password);
      try {
        if (remember) localStorage.setItem("off360_login_email", email);
        else localStorage.removeItem("off360_login_email");
      } catch (_) {}
      if (u.role === "deliverer") {
        try { if (profile === "deliverer" && taxi) localStorage.setItem("off360_taxi_intent", "1"); } catch (_) {}
      }
      if (u.role !== profile) {
        toast(`Sua conta é de ${LABELS[u.role] || "usuário"}. Redirecionando...`);
      } else {
        toast.success("Bem-vindo(a) à OFF 360!");
      }
      go(u.role);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const googleRole = profile;
  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <button onClick={() => navigate("/")} className="mb-6 self-start text-sm text-gray-400 hover:text-white">← Voltar</button>
        <div className="flex flex-col items-center text-center">
          <BrandMark size={84} />
        </div>

        <div className="mt-6">
          <Label className="text-off-orange">Entrar como</Label>
          <div data-testid="login-profile-selector" className="mt-2 grid grid-cols-3 gap-2 rounded-2xl bg-off-surface p-1.5">
            {PROFILES.map((p) => {
              const Icon = p.icon;
              const active = profile === p.key;
              return (
                <button key={p.key} type="button" data-testid={`login-profile-${p.key}`} onClick={() => setProfile(p.key)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2.5 text-xs font-semibold transition-colors ${active ? "off-gradient text-white" : "text-gray-400 hover:text-white"}`}>
                  <Icon className="h-4 w-4" /> {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4 animate-fade-up">
          <div>
            <Label className="text-off-orange">E-mail</Label>
            <Input data-testid="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white placeholder:text-gray-500" placeholder="seu@email.com" />
          </div>
          <div>
            <Label className="text-off-orange">Senha</Label>
            <Input data-testid="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="mt-1.5 h-12 rounded-xl border-off-blue/40 bg-off-surface text-white placeholder:text-gray-500" placeholder="••••••••" />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input data-testid="login-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[#FF7A00]" />
              Lembrar-me
            </label>
            <Link to="/forgot" className="text-sm text-off-orange hover:underline">Esqueci minha senha</Link>
          </div>
          <Button data-testid="login-submit" type="submit" disabled={loading}
            className="h-12 w-full rounded-xl off-gradient text-base font-semibold text-white transition-transform active:scale-[0.98]">
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-gray-500">
          <div className="h-px flex-1 bg-off-blue/30" /> OU CONTINUE COM <div className="h-px flex-1 bg-off-blue/30" />
        </div>
        <div className="grid grid-cols-1 gap-3">
          <GoogleBtn onClick={() => startGoogle(googleRole, taxi)} />
        </div>

        <p className="mt-6 text-center text-sm text-gray-400">
          Não tem conta?{" "}
          <Link data-testid="login-to-register" to={`/register?role=${profile}${taxi ? "&taxi=1" : ""}`} className="font-semibold text-off-orange hover:underline">Cadastre-se</Link>
        </p>
      </div>
    </div>
  );
}
