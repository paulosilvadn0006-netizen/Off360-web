import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth, formatApiError } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Store } from "lucide-react";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState(params.get("role") || "consumer");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", city: "", neighborhood: "", fantasy_name: "", category_id: "" });
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/categories").then(({ data }) => setCats(data)).catch(() => {}); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await register({ ...form, role });
      toast.success("Conta criada com sucesso!");
      navigate(u.role === "merchant" ? "/merchant" : "/home");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <button onClick={() => navigate("/")} className="mb-6 self-start text-sm text-gray-400 hover:text-white">← Voltar</button>
        <div className="flex flex-col items-center text-center">
          <BrandMark size={72} />
          <h2 className="mt-4 font-display text-2xl font-bold text-white">Criar conta</h2>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-off-surface p-1.5">
          <button data-testid="role-consumer" onClick={() => setRole("consumer")}
            className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors ${role === "consumer" ? "off-gradient text-white" : "text-gray-400"}`}>
            <User className="h-4 w-4" /> Consumidor
          </button>
          <button data-testid="role-merchant" onClick={() => setRole("merchant")}
            className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors ${role === "merchant" ? "off-gradient text-white" : "text-gray-400"}`}>
            <Store className="h-4 w-4" /> Empresário
          </button>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3.5 animate-fade-up">
          <Field label={role === "merchant" ? "Nome do responsável" : "Nome completo"}>
            <Input data-testid="reg-name" value={form.name} onChange={set("name")} required className="off-input" placeholder="Seu nome" />
          </Field>
          {role === "merchant" && (
            <>
              <Field label="Nome fantasia">
                <Input data-testid="reg-fantasy" value={form.fantasy_name} onChange={set("fantasy_name")} required className="off-input" placeholder="Nome do estabelecimento" />
              </Field>
              <Field label="Categoria">
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger data-testid="reg-category" className="off-input"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent className="bg-off-surface text-white border-off-blue/40">
                    {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}
          <Field label="E-mail">
            <Input data-testid="reg-email" type="email" value={form.email} onChange={set("email")} required className="off-input" placeholder="seu@email.com" />
          </Field>
          <Field label="WhatsApp">
            <Input data-testid="reg-phone" value={form.phone} onChange={set("phone")} required className="off-input" placeholder="+55 11 99999-9999" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cidade"><Input value={form.city} onChange={set("city")} className="off-input" placeholder="Cidade" /></Field>
            <Field label="Bairro"><Input value={form.neighborhood} onChange={set("neighborhood")} className="off-input" placeholder="Bairro" /></Field>
          </div>
          <Field label="Senha">
            <Input data-testid="reg-password" type="password" value={form.password} onChange={set("password")} required minLength={6} className="off-input" placeholder="Mínimo 6 caracteres" />
          </Field>
          <p className="text-xs text-gray-500">Ao criar a conta você concorda com os Termos de Uso e a Política de Privacidade (LGPD).</p>
          <Button data-testid="reg-submit" type="submit" disabled={loading} className="h-12 w-full rounded-xl off-gradient text-base font-semibold text-white transition-transform active:scale-[0.98]">
            {loading ? "Criando..." : "Criar conta"}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-gray-400">
          Já tem conta? <Link to={`/login?role=${role}`} className="font-semibold text-off-orange hover:underline">Entrar</Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-gray-300">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
