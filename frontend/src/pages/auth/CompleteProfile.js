import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth, formatApiError } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Loader2 } from "lucide-react";

const maskCpf = (v) => (v || "").replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
const maskCep = (v) => (v || "").replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
const maskPhone = (v) => {
  let d = (v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

function Field({ label, children }) {
  return <div><Label className="text-off-orange">{label}</Label><div className="mt-1.5">{children}</div></div>;
}

export default function CompleteProfile() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ cpf: "", phone: "", cep: "", address_street: "", address_neighborhood: "", address_city: "", address_uf: "", address_number: "", address_complement: "" });
  const [loading, setLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const buscarCep = async () => {
    const d = (f.cep || "").replace(/\D/g, "");
    if (d.length !== 8) { toast.error("Informe um CEP válido (8 dígitos)."); return; }
    setCepLoading(true);
    try {
      const j = await (await fetch(`https://viacep.com.br/ws/${d}/json/`)).json();
      if (j.erro) { toast.error("CEP não encontrado."); return; }
      setF((s) => ({ ...s, address_street: j.logradouro || s.address_street, address_neighborhood: j.bairro || s.address_neighborhood, address_city: j.localidade || s.address_city, address_uf: j.uf || s.address_uf }));
      toast.success("Endereço preenchido pelo CEP.");
    } catch (_) { toast.error("Não foi possível buscar o CEP."); } finally { setCepLoading(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: u } = await api.post("/auth/complete-profile", f);
      setUser?.(u);
      toast.success("Cadastro completo! Bem-vindo(a).");
      navigate("/merchant", { replace: true });
    } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-off-bg px-6 py-10">
      <div className="mx-auto flex max-w-xl flex-col" data-testid="complete-profile">
        <div className="flex flex-col items-center text-center">
          <BrandMark size={64} />
          <h1 className="mt-4 font-display text-2xl font-bold text-white">Completar cadastro</h1>
          <p className="mt-1 text-sm text-gray-400">Olá, {user?.name || "empresário"}! Precisamos de alguns dados para liberar seu painel.</p>
        </div>
        <form onSubmit={save} className="mt-6 space-y-3.5 animate-fade-up">
          <Field label="CPF"><Input data-testid="cp-cpf" value={f.cpf} onChange={(e) => setF({ ...f, cpf: maskCpf(e.target.value) })} required className="off-input" placeholder="000.000.000-00" inputMode="numeric" maxLength={14} /></Field>
          <Field label="Telefone / WhatsApp"><Input data-testid="cp-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} required className="off-input" placeholder="(11) 99999-9999" inputMode="numeric" maxLength={16} /></Field>
          <div>
            <Label className="text-off-orange">CEP</Label>
            <div className="mt-1.5 flex gap-2">
              <Input data-testid="cp-cep" value={f.cep} onChange={(e) => setF({ ...f, cep: maskCep(e.target.value) })} className="off-input" placeholder="00000-000" inputMode="numeric" maxLength={9} />
              <Button type="button" data-testid="cp-cep-search" onClick={buscarCep} disabled={cepLoading} className="h-12 shrink-0 rounded-xl off-gradient px-4 font-semibold text-white">{cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="mr-1 h-4 w-4" /> Buscar</>}</Button>
            </div>
          </div>
          <Field label="Logradouro"><Input data-testid="cp-street" value={f.address_street} onChange={set("address_street")} className="off-input" placeholder="Rua / Avenida" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bairro"><Input data-testid="cp-neighborhood" value={f.address_neighborhood} onChange={set("address_neighborhood")} className="off-input" placeholder="Bairro" /></Field>
            <Field label="Número"><Input data-testid="cp-number" value={f.address_number} onChange={set("address_number")} className="off-input" placeholder="123" /></Field>
          </div>
          <div className="grid grid-cols-[1fr_88px] gap-3">
            <Field label="Cidade"><Input data-testid="cp-city" value={f.address_city} onChange={set("address_city")} className="off-input" placeholder="Cidade" /></Field>
            <Field label="UF"><Input data-testid="cp-uf" value={f.address_uf} onChange={(e) => setF({ ...f, address_uf: e.target.value.toUpperCase().slice(0, 2) })} className="off-input" placeholder="SP" maxLength={2} /></Field>
          </div>
          <Field label="Complemento (opcional)"><Input data-testid="cp-complement" value={f.address_complement} onChange={set("address_complement")} className="off-input" placeholder="Apto, bloco..." /></Field>
          <Button data-testid="cp-submit" type="submit" disabled={loading} className="h-12 w-full rounded-xl off-gradient text-base font-semibold text-white">{loading ? "Salvando..." : "Salvar e acessar o painel"}</Button>
        </form>
      </div>
    </div>
  );
}
