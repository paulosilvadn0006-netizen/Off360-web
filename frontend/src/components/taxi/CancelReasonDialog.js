import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_QUICK = [
  "Passageiro não apareceu",
  "Endereço errado",
  "Outro motivo",
];

export default function CancelReasonDialog({ open, onOpenChange, onConfirm, title = "Motivo do cancelamento", confirmLabel = "Confirmar", reasons }) {
  const list = reasons && reasons.length ? reasons : DEFAULT_QUICK;
  const [choice, setChoice] = useState(null);
  const [free, setFree] = useState("");
  const isOther = /outro/i.test(choice || "");
  const reason = isOther ? free.trim() : (choice || "");
  const valid = isOther ? free.trim().length > 0 : !!choice;

  const confirm = () => {
    if (!valid) return;
    onConfirm(reason);
    setChoice(null); setFree("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setChoice(null); setFree(""); } }}>
      <DialogContent className="border-off-blue/40 bg-off-surface text-white" data-testid="cancel-reason-dialog">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {list.map((q, i) => (
            <button key={q} data-testid={`cancel-reason-opt-${i}`}
              onClick={() => setChoice(q)}
              className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${choice === q ? "border-off-orange bg-off-orange/10 text-off-orange" : "border-off-blue/40 text-gray-200 hover:border-off-blue"}`}>
              {q}
            </button>
          ))}
          {isOther && (
            <Textarea data-testid="cancel-reason-free" value={free} onChange={(e) => setFree(e.target.value)} placeholder="Descreva o motivo..." className="off-input min-h-[80px]" />
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 rounded-xl border-off-blue/40 text-gray-200">Voltar</Button>
          <Button data-testid="cancel-reason-confirm" onClick={confirm} disabled={!valid} className="flex-1 rounded-xl bg-off-error font-bold text-white">{confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
