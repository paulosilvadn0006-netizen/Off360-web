import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadMp } from "@/lib/mpSdk";
import { CreditCard, Plus, Trash2, Loader2 } from "lucide-react";

export default function PassengerCards() {
  const [cards, setCards] = useState(null);
  const [pk, setPk] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ number: "", name: "", exp: "", cvv: "", cpf: "" });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const load = async () => {
    try { const { data } = await api.get("/taxi/passenger/cards"); setCards(data.cards); setPk(data.public_key); }
    catch (err) { toast.error(formatApiError(err)); setCards([]); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!f.number || !f.name || !f.exp || !f.cvv || !f.cpf) return toast.error("Preencha todos os campos do cartão.");
    const [mm, yy] = f.exp.split("/").map((x) => (x || "").trim());
    if (!mm || !yy) return toast.error("Validade no formato MM/AA.");
    setBusy(true);
    try {
      const mp = await loadMp(pk);
      const token = await mp.createCardToken({
        cardNumber: f.number.replace(/\s/g, ""), cardholderName: f.name,
        cardExpirationMonth: mm, cardExpirationYear: yy.length === 2 ? `20${yy}` : yy,
        securityCode: f.cvv, identificationType: "CPF", identificationNumber: f.cpf.replace(/\D/g, ""),
      });
      await api.post("/taxi/passenger/cards", { token: token.id });
      toast.success("Cartão salvo!");
      setF({ number: "", name: "", exp: "", cvv: "", cpf: "" }); setAdding(false); load();
    } catch (err) { toast.error(formatApiError(err, "Não foi possível validar o cartão. Confira os dados.")); }
    finally { setBusy(false); }
  };

  const remove = async (id) => { try { await api.delete(`/taxi/passenger/cards/${id}`); load(); } catch (err) { toast.error(formatApiError(err)); } };

  return (
    <div className="mt-4 off-card p-5" data-testid="passenger-cards">
      <div className="mb-3 flex items-center gap-2 text-off-orange"><CreditCard className="h-5 w-5" /><h3 className="font-display font-bold text-white">Meus cartões de crédito</h3></div>
      {cards === null ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /> : (
        <>
          <div className="space-y-2">
            {cards.length === 0 && !adding && <p className="text-xs text-gray-400">Nenhum cartão salvo. Cadastre para usar nas corridas.</p>}
            {cards.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-off-blue/40 p-3" data-testid={`pcard-${c.id}`}>
                <span className="flex items-center gap-2 text-sm text-white"><CreditCard className="h-4 w-4 text-off-orange" /> {(c.brand || "cartão").toUpperCase()} •••• {c.last_four} <span className="text-[11px] text-gray-400">{c.exp}</span></span>
                <button onClick={() => remove(c.id)} data-testid={`pcard-del-${c.id}`} className="text-gray-500 hover:text-off-error"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          {adding ? (
            <div className="mt-3 space-y-2">
              <Input data-testid="pcard-number" value={f.number} onChange={set("number")} inputMode="numeric" placeholder="Número do cartão" className="off-input" />
              <Input data-testid="pcard-name" value={f.name} onChange={set("name")} placeholder="Nome impresso no cartão" className="off-input" />
              <div className="grid grid-cols-3 gap-2">
                <Input data-testid="pcard-exp" value={f.exp} onChange={set("exp")} placeholder="MM/AA" className="off-input" />
                <Input data-testid="pcard-cvv" value={f.cvv} onChange={set("cvv")} inputMode="numeric" placeholder="CVV" className="off-input" />
                <Input data-testid="pcard-cpf" value={f.cpf} onChange={set("cpf")} inputMode="numeric" placeholder="CPF" className="off-input" />
              </div>
              <div className="flex gap-2">
                <Button data-testid="pcard-save" onClick={save} disabled={busy} className="h-11 flex-1 rounded-xl off-gradient font-bold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar cartão"}</Button>
                <Button variant="outline" onClick={() => setAdding(false)} className="h-11 rounded-xl border-off-blue/40 text-gray-200">Cancelar</Button>
              </div>
            </div>
          ) : (
            <Button data-testid="pcard-add" onClick={() => setAdding(true)} variant="outline" className="mt-3 h-10 w-full rounded-xl border-off-blue/40 text-xs text-gray-200"><Plus className="mr-1 h-4 w-4" /> Adicionar cartão</Button>
          )}
        </>
      )}
    </div>
  );
}
