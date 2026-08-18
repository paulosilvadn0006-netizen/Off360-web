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
import { User, Store, Bike, Car } from "lucide-react";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const taxi = params.get("taxi") === "1";
  const [role, setRole] = useState(taxi ? "deliverer" : (params.get("role") || "consumer"));
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", city: "", neighborhood: "", address_street: "", address_number: "", address_neighborhood: "", address_city: "", address_complement: "", fantasy_name: "", category_id: "", vehicle: "moto", works_fixed: false });
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/categories").then(({ data }) => setCats(data)).catch(() => {}); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const maskPhone = (v) => {
    let d = (v || "").replace(/\D/g, "");
    if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : "";
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await register({ ...form, role });
      if (u.role === "deliverer") {
        try { if (taxi) localStorage.setItem("off360_taxi_intent", "1"); else localStorage.removeItem("off360_taxi_intent"); } catch (_) {}
      }
      toast.success(taxi ? "Cadastro 360Taxi criado!" : "Conta criada com sucesso!");
      navigate(u.role === "merchant" ? "/merchant" : u.role === "deliverer" ? "/deliverer" : "/home");
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
          <h2 className="mt-4 font-display text-2xl font-bold text-white">{taxi ? "Criar conta — 360Taxi" : "Criar conta"}</h2>
        </div>

        {taxi ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-off-surface p-3" data-testid="reg-taxi-identity">
            <Car className="h-5 w-5 text-off-orange" />
            <span className="text-sm font-semibold text-white">🚗 360Taxi · Motorista</span>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-3 gap-2 rounded-2xl bg-off-surface p-1.5">
            <button data-testid="role-consumer" onClick={() => setRole("consumer")}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-colors ${role === "consumer" ? "off-gradient text-white" : "text-gray-400"}`}>
              <User className="h-4 w-4" /> Consumidor
            </button>
            <button data-testid="role-merchant" onClick={() => setRole("merchant")}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-colors ${role === "merchant" ? "off-gradient text-white" : "text-gray-400"}`}>
              <Store className="h-4 w-4" /> Empresário
            </button>
            <button data-testid="role-deliverer" onClick={() => setRole("deliverer")}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-colors ${role === "deliverer" ? "off-gradient text-white" : "text-gray-400"}`}>
              <Bike className="h-4 w-4" /> Entregador
            </button>
          </div>
        )}

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
          {role === "deliverer" && !taxi && (
            <>
              <Field label="Veículo">
                <Select value={form.vehicle} onValueChange={(v) => setForm({ ...form, vehicle: v })}>
                  <SelectTrigger data-testid="reg-vehicle" className="off-input"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent className="bg-off-surface text-white border-off-blue/40">
                    {["moto", "carro", "bicicleta", "outro"].map((v) => <SelectItem key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" data-testid="reg-works-fixed" checked={form.works_fixed} onChange={(e) => setForm({ ...form, works_fixed: e.target.checked })} />
                Trabalha fixo para algum estabelecimento?
              </label>
            </>
          )}
          <Field label="E-mail">
            <Input data-testid="reg-email" type="email" value={form.email} onChange={set("email")} required className="off-input" placeholder="seu@email.com" />
          </Field>
          <Field label="WhatsApp">
            <Input data-testid="reg-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} required className="off-input" placeholder="(11) 99999-9999" inputMode="numeric" maxLength={16} />
          </Field>
          <div className="grid grid-cols-[1fr_88px] gap-3">
            <Field label="Rua / Logradouro"><Input data-testid="reg-street" value={form.address_street} onChange={set("address_street")} className="off-input" placeholder="Ex: Rua das Flores" /></Field>
            <Field label="Nº"><Input data-testid="reg-number" value={form.address_number} onChange={set("address_number")} className="off-input" placeholder="123" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bairro"><Input data-testid="reg-neighborhood" value={form.address_neighborhood} onChange={set("address_neighborhood")} className="off-input" placeholder="Bairro" /></Field>
            <Field label="Cidade"><Input data-testid="reg-city" value={form.address_city} onChange={set("address_city")} className="off-input" placeholder="Cidade" /></Field>
          </div>
          <Field label="Complemento (opcional)"><Input data-testid="reg-complement" value={form.address_complement} onChange={set("address_complement")} className="off-input" placeholder="Apto, bloco, casa, sala, ponto de referência..." /></Field>
          <Field label="Senha">
            <Input data-testid="reg-password" type="password" value={form.password} onChange={set("password")} required minLength={6} className="off-input" placeholder="Mínimo 6 caracteres" />
          </Field>
          <p className="text-xs text-gray-500">Ao criar a conta você concorda com os Termos de Uso e a Política de Privacidade (LGPD).</p>
          <Button data-testid="reg-submit" type="submit" disabled={loading} className="h-12 w-full rounded-xl off-gradient text-base font-semibold text-white transition-transform active:scale-[0.98]">
            {loading ? "Criando..." : "Criar conta"}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-gray-400">
          Já tem conta? <Link to={`/login?role=${role}${taxi ? "&taxi=1" : ""}`} className="font-semibold text-off-orange hover:underline">Entrar</Link>
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
