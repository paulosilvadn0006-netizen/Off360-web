import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Utensils, Camera, CheckCircle2 } from "lucide-react";

function Center({ children }) {
  return <div className="flex min-h-screen items-center justify-center bg-off-bg p-6 text-center text-gray-300">{children}</div>;
}

export default function WaiterInvite() {
  const [sp] = useSearchParams();
  const eid = sp.get("loja");
  const { data, isLoading, error } = useQuery({ queryKey: ["invite", eid], enabled: !!eid, queryFn: async () => (await api.get(`/presencial/invite/${eid}`)).data });
  const [f, setF] = useState({ name: "", login: "", password: "", phone: "" });
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!eid) return <Center>Link inválido. Solicite um novo convite ao estabelecimento.</Center>;
  if (isLoading) return <Center><Loader2 className="h-6 w-6 animate-spin text-off-orange" /></Center>;
  if (error || !data) return <Center>Estabelecimento não encontrado. Verifique o link do convite.</Center>;

  const e = data.establishment;
  const onPhoto = (file) => { if (!file) return; setPhoto(file); setPreview(URL.createObjectURL(file)); };
  const submit = async () => {
    if (!f.name.trim() || !f.login.trim() || f.password.length < 4) { toast.error("Preencha nome, login e senha (mínimo 4 caracteres)"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("establishment_id", eid); fd.append("name", f.name.trim());
      fd.append("login", f.login.trim()); fd.append("password", f.password);
      fd.append("phone", f.phone.trim());
      if (photo) fd.append("file", photo);
      await api.post("/presencial/waiter/register", fd);
      setDone(true);
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };

  if (done) return (
    <Center>
      <div data-testid="invite-done" className="max-w-sm">
        <CheckCircle2 className="mx-auto h-14 w-14 text-off-success" />
        <p className="mt-3 text-lg font-bold text-white">Cadastro enviado!</p>
        <p className="mt-1 text-sm text-gray-400">Aguarde a aprovação de <b className="text-white">{e.fantasy_name}</b>. Assim que liberado, é só entrar em <b className="text-gray-200">{window.location.origin}/garcom</b> com seu login e senha.</p>
      </div>
    </Center>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-off-bg p-6" data-testid="waiter-invite">
      <div className="w-full max-w-sm off-card p-6">
        <div className="flex items-center gap-2">
          {e.logo_url ? <img alt="" src={fileUrl(e.logo_url)} className="h-11 w-11 rounded-xl object-cover" /> : <span className="flex h-11 w-11 items-center justify-center rounded-xl off-gradient"><Utensils className="h-5 w-5 text-white" /></span>}
          <div><h1 className="font-display text-lg font-bold text-white">{e.fantasy_name}</h1><p className="text-xs text-off-orange">Cadastro de garçom</p></div>
        </div>
        <p className="mt-3 text-xs text-gray-400">Preencha seus dados para entrar na equipe. Seu acesso é liberado após a aprovação do estabelecimento.</p>

        <div className="mt-4 flex justify-center">
          <label data-testid="invite-photo-btn" className="relative h-24 w-24 cursor-pointer overflow-hidden rounded-full border-2 border-off-orange">
            {preview ? <img alt="" src={preview} className="h-full w-full object-cover" /> : <span className="flex h-full w-full flex-col items-center justify-center bg-off-surface text-off-orange"><Camera className="h-6 w-6" /><span className="mt-1 text-[9px]">Foto 3x4</span></span>}
            <input type="file" accept="image/*" capture="user" className="hidden" onChange={(ev) => { onPhoto(ev.target.files?.[0]); ev.target.value = ""; }} />
          </label>
        </div>

        <div className="mt-4 space-y-3">
          <Input data-testid="invite-name" value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} placeholder="Seu nome" className="off-input" />
          <Input data-testid="invite-login" value={f.login} onChange={(ev) => setF({ ...f, login: ev.target.value })} placeholder="Login (para acessar o painel)" className="off-input" />
          <Input data-testid="invite-phone" value={f.phone} onChange={(ev) => setF({ ...f, phone: ev.target.value })} placeholder="WhatsApp com DDD (para aviso de aprovação)" inputMode="tel" className="off-input" />
          <Input data-testid="invite-password" type="password" value={f.password} onChange={(ev) => setF({ ...f, password: ev.target.value })} placeholder="Senha (mínimo 4 caracteres)" className="off-input" />
          <Button data-testid="invite-submit" onClick={submit} disabled={busy} className="h-12 w-full rounded-xl off-gradient font-bold text-white">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Enviar cadastro"}</Button>
        </div>
      </div>
    </div>
  );
}
