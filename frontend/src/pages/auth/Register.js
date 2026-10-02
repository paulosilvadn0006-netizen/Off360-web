import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth, formatApiError } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Store, Car, Search, Loader2 } from "lucide-react";
import { GoogleBtn, FacebookBtn, startGoogle } from "@/components/auth/Social";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const YEARS = Array.from({ length: 90 }, (_, i) => `${new Date().getFullYear() - 16 - i}`);
const DAYS = Array.from({ length: 31 }, (_, i) => `${i + 1}`);

const maskCpf = (v) => (v || "").replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
const validCpf = (v) => {
  const d = (v || "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const i of [9, 10]) {
    let s = 0;
    for (let j = 0; j < i; j++) s += parseInt(d[j]) * (i + 1 - j);
    let r = (s * 10) % 11;
    if (r === 10) r = 0;
    if (r !== parseInt(d[i])) return false;
  }
  return true;
};
const maskCep = (v) => (v || "").replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
const maskPhone = (v) => {
  let d = (v || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

function Field({ label, children }) {
  return <div><Label className="text-off-orange">{label}</Label><div className="mt-1.5">{children}</div></div>;
}

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const taxi = params.get("taxi") === "1";
  const [role, setRole] = useState(taxi ? "deliverer" : (params.get("role") || "consumer"));
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "", cpf: "", bd: "", bm: "", by: "", cep: "", address_street: "", address_neighborhood: "", address_city: "", address_uf: "", address_number: "", address_complement: "", fantasy_name: "", category_id: "", vehicle: "moto", works_fixed: false });
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => { api.get("/categories").then(({ data }) => setCats(data)).catch(() => {}); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const buscarCep = async () => {
    const d = (form.cep || "").replace(/\D/g, "");
    if (d.length !== 8) { toast.error("Informe um CEP válido (8 dígitos)."); return; }
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const j = await res.json();
      if (j.erro) { toast.error("CEP não encontrado."); return; }
      setForm((s) => ({ ...s, address_street: j.logradouro || s.address_street, address_neighborhood: j.bairro || s.address_neighborhood, address_city: j.localidade || s.address_city, address_uf: j.uf || s.address_uf }));
      toast.success("Endereço preenchido pelo CEP.");
    } catch (_) { toast.error("Não foi possível buscar o CEP."); } finally { setCepLoading(false); }
  };

  const submitMerchant = async () => {
    if (!form.name || !form.email) { toast.error("Preencha nome e e-mail."); return; }
    if (!validCpf(form.cpf)) { toast.error("CPF inválido. Verifique os 11 dígitos."); return; }
    if ((form.password || "").length < 8) { toast.error("A senha deve ter no mínimo 8 caracteres."); return; }
    if (form.password !== form.confirm) { toast.error("As senhas não conferem."); return; }
    const birth_date = form.by && form.bm && form.bd ? `${form.by}-${String(form.bm).padStart(2, "0")}-${String(form.bd).padStart(2, "0")}` : "";
    await doRegister({
      name: form.name, email: form.email, password: form.password, cpf: form.cpf, role: "merchant",
      birth_date, cep: form.cep, address_street: form.address_street, address_neighborhood: form.address_neighborhood,
      address_city: form.address_city, address_uf: form.address_uf, address_number: form.address_number, address_complement: form.address_complement,
    });
  };

  const doRegister = async (payload) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      const u = await register(payload);
      if (u.role === "deliverer") { try { if (taxi) localStorage.setItem("off360_taxi_intent", "1"); } catch (_) {} }
      toast.success("Cadastro efetuado com sucesso");
      navigate(u.role === "merchant" ? "/merchant" : u.role === "deliverer" ? "/deliverer" : "/home");
    } catch (err) {
      toast.error(formatApiError(err));
      submittingRef.current = false;
    } finally { setLoading(false); }
  };

  const submitOther = async (e) => {
    e.preventDefault();
    if (role === "consumer" && !validCpf(form.cpf)) { toast.error("CPF inválido. Verifique os 11 dígitos."); return; }
    await doRegister({ ...form, role });
  };

  const socialRow = (
    <>
      <div className="my-6 flex items-center gap-3 text-xs text-gray-500">
        <div className="h-px flex-1 bg-off-blue/30" /> OU CONTINUE COM <div className="h-px flex-1 bg-off-blue/30" />
      </div>
      <div className="grid grid-cols-2 gap-3"><GoogleBtn onClick={() => startGoogle(role, taxi)} /><FacebookBtn /></div>
      <p className="mt-6 text-center text-sm text-gray-400">
        Já tem conta? <Link data-testid="register-to-login" to={`/login?role=${role}${taxi ? "&taxi=1" : ""}`} className="font-semibold text-off-orange hover:underline">Entrar</Link>
      </p>
    </>
  );

  const roleTabs = !taxi && (
    <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-off-surface p-1.5">
      <button data-testid="role-consumer" onClick={() => setRole("consumer")} className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-colors ${role === "consumer" ? "off-gradient text-white" : "text-gray-400"}`}><User className="h-4 w-4" /> Consumidor</button>
      <button data-testid="role-merchant" onClick={() => setRole("merchant")} className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-colors ${role === "merchant" ? "off-gradient text-white" : "text-gray-400"}`}><Store className="h-4 w-4" /> Empresário</button>
    </div>
  );

  // ===== MERCHANT: layout em 2 colunas =====
  if (role === "merchant") {
    return (
      <div className="min-h-screen bg-off-bg px-6 py-10">
        <div className="mx-auto flex max-w-3xl flex-col">
          <button onClick={() => navigate("/")} className="mb-6 self-start text-sm text-gray-400 hover:text-white">← Voltar</button>
          <div className="flex flex-col items-center text-center"><BrandMark size={72} /><h2 className="mt-4 font-display text-2xl font-bold text-white">Criar conta — Empresário</h2></div>
          {roleTabs}
          <form onSubmit={(e) => { e.preventDefault(); submitMerchant(); }} className="mt-6 animate-fade-up">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3.5">
                <h3 className="font-display text-sm font-bold uppercase tracking-wide text-off-orange">Dados pessoais</h3>
                <Field label="Nome Completo"><Input data-testid="reg-name" value={form.name} onChange={set("name")} required className="off-input" placeholder="Seu nome completo" /></Field>
                <Field label="E-mail"><Input data-testid="reg-email" type="email" value={form.email} onChange={set("email")} required className="off-input" placeholder="seu@email.com" /></Field>
                <Field label="CPF"><Input data-testid="reg-cpf" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })} required className="off-input" placeholder="000.000.000-00" inputMode="numeric" maxLength={14} /></Field>
                <Field label="Senha"><Input data-testid="reg-password" type="password" value={form.password} onChange={set("password")} required minLength={8} className="off-input" placeholder="Mínimo 8 caracteres" /></Field>
                <Field label="Confirmar Senha"><Input data-testid="reg-confirm" type="password" value={form.confirm} onChange={set("confirm")} required minLength={8} className="off-input" placeholder="Repita a senha" /></Field>
              </div>
              <div className="space-y-3.5">
                <h3 className="font-display text-sm font-bold uppercase tracking-wide text-off-orange">Endereço e nascimento</h3>
                <div>
                  <Label className="text-off-orange">Data de Nascimento</Label>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    <Select value={form.bd} onValueChange={(v) => setForm({ ...form, bd: v })}>
                      <SelectTrigger data-testid="reg-birth-day" className="off-input"><SelectValue placeholder="Dia" /></SelectTrigger>
                      <SelectContent className="max-h-56 bg-off-surface text-white border-off-blue/40">{DAYS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={form.bm} onValueChange={(v) => setForm({ ...form, bm: v })}>
                      <SelectTrigger data-testid="reg-birth-month" className="off-input"><SelectValue placeholder="Mês" /></SelectTrigger>
                      <SelectContent className="max-h-56 bg-off-surface text-white border-off-blue/40">{MONTHS.map((m, i) => <SelectItem key={m} value={`${i + 1}`}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={form.by} onValueChange={(v) => setForm({ ...form, by: v })}>
                      <SelectTrigger data-testid="reg-birth-year" className="off-input"><SelectValue placeholder="Ano" /></SelectTrigger>
                      <SelectContent className="max-h-56 bg-off-surface text-white border-off-blue/40">{YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-off-orange">CEP</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Input data-testid="reg-cep" value={form.cep} onChange={(e) => setForm({ ...form, cep: maskCep(e.target.value) })} className="off-input" placeholder="00000-000" inputMode="numeric" maxLength={9} />
                    <Button type="button" data-testid="reg-cep-search" onClick={buscarCep} disabled={cepLoading} className="h-12 shrink-0 rounded-xl off-gradient px-4 font-semibold text-white">{cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="mr-1 h-4 w-4" /> Buscar</>}</Button>
                  </div>
                </div>
                <Field label="Logradouro"><Input data-testid="reg-street" value={form.address_street} onChange={set("address_street")} className="off-input" placeholder="Rua / Avenida" /></Field>
                <Field label="Bairro"><Input data-testid="reg-neighborhood" value={form.address_neighborhood} onChange={set("address_neighborhood")} className="off-input" placeholder="Bairro" /></Field>
                <div className="grid grid-cols-[1fr_88px] gap-2">
                  <Field label="Cidade"><Input data-testid="reg-city" value={form.address_city} onChange={set("address_city")} className="off-input" placeholder="Cidade" /></Field>
                  <Field label="UF"><Input data-testid="reg-uf" value={form.address_uf} onChange={(e) => setForm({ ...form, address_uf: e.target.value.toUpperCase().slice(0, 2) })} className="off-input" placeholder="SP" maxLength={2} /></Field>
                </div>
                <div className="grid grid-cols-[110px_1fr] gap-2">
                  <Field label="Número"><Input data-testid="reg-number" value={form.address_number} onChange={set("address_number")} className="off-input" placeholder="123" /></Field>
                  <Field label="Complemento"><Input data-testid="reg-complement" value={form.address_complement} onChange={set("address_complement")} className="off-input" placeholder="Apto, bloco..." /></Field>
                </div>
              </div>
            </div>
            <Button data-testid="reg-submit" type="submit" disabled={loading} className="mt-6 h-12 w-full rounded-xl off-gradient text-base font-semibold text-white transition-transform active:scale-[0.98]">{loading ? "Criando..." : "Cadastrar"}</Button>
          </form>
          {socialRow}
        </div>
      </div>
    );
  }

  // ===== CONSUMER / DELIVERER: layout existente =====
  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col">
        <button onClick={() => navigate("/")} className="mb-6 self-start text-sm text-gray-400 hover:text-white">← Voltar</button>
        <div className="flex flex-col items-center text-center"><BrandMark size={72} /><h2 className="mt-4 font-display text-2xl font-bold text-white">{taxi ? "Criar conta — 360Taxi" : "Criar conta"}</h2></div>
        {taxi ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-off-surface p-3" data-testid="reg-taxi-identity"><Car className="h-5 w-5 text-off-orange" /><span className="text-sm font-semibold text-white">🚗 360Taxi · Motorista</span></div>
        ) : roleTabs}
        <form onSubmit={submitOther} className="mt-6 space-y-3.5 animate-fade-up">
          <Field label="Nome completo"><Input data-testid="reg-name" value={form.name} onChange={set("name")} required className="off-input" placeholder="Seu nome" /></Field>
          {role === "deliverer" && !taxi && (
            <>
              <Field label="Veículo">
                <Select value={form.vehicle} onValueChange={(v) => setForm({ ...form, vehicle: v })}>
                  <SelectTrigger data-testid="reg-vehicle" className="off-input"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent className="bg-off-surface text-white border-off-blue/40">{["moto", "carro", "bicicleta", "outro"].map((v) => <SelectItem key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" data-testid="reg-works-fixed" checked={form.works_fixed} onChange={(e) => setForm({ ...form, works_fixed: e.target.checked })} /> Trabalha fixo para algum estabelecimento?</label>
            </>
          )}
          <Field label="E-mail"><Input data-testid="reg-email" type="email" value={form.email} onChange={set("email")} required className="off-input" placeholder="seu@email.com" /></Field>
          <Field label="WhatsApp"><Input data-testid="reg-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} required className="off-input" placeholder="(11) 99999-9999" inputMode="numeric" maxLength={16} /></Field>
          {role === "consumer" && <Field label="CPF"><Input data-testid="reg-cpf" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })} required className="off-input" placeholder="000.000.000-00" inputMode="numeric" maxLength={14} /></Field>}
          <div className="grid grid-cols-[1fr_88px] gap-3">
            <Field label="Rua / Logradouro"><Input data-testid="reg-street" value={form.address_street} onChange={set("address_street")} className="off-input" placeholder="Ex: Rua das Flores" /></Field>
            <Field label="Nº"><Input data-testid="reg-number" value={form.address_number} onChange={set("address_number")} className="off-input" placeholder="123" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bairro"><Input data-testid="reg-neighborhood" value={form.address_neighborhood} onChange={set("address_neighborhood")} className="off-input" placeholder="Bairro" /></Field>
            <Field label="Cidade"><Input data-testid="reg-city" value={form.address_city} onChange={set("address_city")} className="off-input" placeholder="Cidade" /></Field>
          </div>
          <Field label="Complemento (opcional)"><Input data-testid="reg-complement" value={form.address_complement} onChange={set("address_complement")} className="off-input" placeholder="Apto, bloco, casa..." /></Field>
          <Field label="Senha"><Input data-testid="reg-password" type="password" value={form.password} onChange={set("password")} required minLength={6} className="off-input" placeholder="Mínimo 6 caracteres" /></Field>
          <p className="text-xs text-gray-500">Ao criar a conta você concorda com os Termos de Uso e a Política de Privacidade (LGPD).</p>
          <Button data-testid="reg-submit" type="submit" disabled={loading} className="h-12 w-full rounded-xl off-gradient text-base font-semibold text-white transition-transform active:scale-[0.98]">{loading ? "Criando..." : "Criar conta"}</Button>
        </form>
        {socialRow}
      </div>
    </div>
  );
}
