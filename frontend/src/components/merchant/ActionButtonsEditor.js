import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ArrowUp, ArrowDown, MessageCircle, ExternalLink, ClipboardList, CalendarClock } from "lucide-react";
import { SERVICE_TYPES, SERVICE_LABEL, DESTINATIONS, DAYS } from "@/lib/requests";

const uid = () => Math.random().toString(36).slice(2, 10);
const EMPTY = () => ({
  id: uid(), enabled: true, label: "", service_type: "agendamento", destination: "internal",
  whatsapp_message: "", external_url: "", valid_days: [], hours_start: "", hours_end: "",
  response_time: "", observations: "", discount_valid: true, requires_prepayment: false,
  delivery_fee: "", areas: "", deadline: "",
});

function DestIcon({ d }) {
  if (d === "whatsapp") return <MessageCircle className="h-4 w-4" />;
  if (d === "external") return <ExternalLink className="h-4 w-4" />;
  return <ClipboardList className="h-4 w-4" />;
}

export default function ActionButtonsEditor({ buttons = [], whatsapp, onChange }) {
  const list = buttons;
  const update = (idx, patch) => onChange(list.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  const add = () => { if (list.length >= 3) return; onChange([...list, EMPTY()]); };
  const remove = (idx) => onChange(list.filter((_, i) => i !== idx));
  const move = (idx, dir) => {
    const j = idx + dir; if (j < 0 || j >= list.length) return;
    const copy = [...list]; [copy[idx], copy[j]] = [copy[j], copy[idx]]; onChange(copy);
  };
  const toggleDay = (idx, day) => {
    const b = list[idx]; const has = (b.valid_days || []).includes(day);
    update(idx, { valid_days: has ? b.valid_days.filter((d) => d !== day) : [...(b.valid_days || []), day] });
  };

  const preview = list.filter((b) => b.enabled && b.label && (b.destination !== "external" || b.external_url) && (b.destination !== "whatsapp" || (whatsapp || "").trim()));

  return (
    <div className="rounded-xl border border-off-blue/40 bg-off-bg/40 p-4" data-testid="action-buttons-section">
      <p className="font-display text-sm font-bold tracking-wide text-off-orange">FORMAS DE ATENDIMENTO</p>
      <p className="mt-1 text-[11px] text-gray-500">Escolha os botões que serão exibidos aos consumidores. Ative somente as opções oferecidas pelo seu estabelecimento.</p>

      <div className="mt-3 space-y-3">
        {list.map((b, idx) => (
          <div key={b.id} className="rounded-xl border border-off-blue/30 bg-off-surface/60 p-3" data-testid={`ab-item-${idx}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-off-orange/20 text-xs font-bold text-off-orange">{idx + 1}</span>
              <div className="flex items-center gap-1 text-xs text-gray-400"><DestIcon d={b.destination} /></div>
              <span className="flex-1 truncate text-sm font-semibold text-white">{b.label || "Novo botão"}</span>
              <button data-testid={`ab-up-${idx}`} onClick={() => move(idx, -1)} className="rounded p-1 text-gray-400 hover:text-white"><ArrowUp className="h-4 w-4" /></button>
              <button data-testid={`ab-down-${idx}`} onClick={() => move(idx, 1)} className="rounded p-1 text-gray-400 hover:text-white"><ArrowDown className="h-4 w-4" /></button>
              <Switch data-testid={`ab-enabled-${idx}`} checked={!!b.enabled} onCheckedChange={(v) => update(idx, { enabled: v })} />
              <button data-testid={`ab-remove-${idx}`} onClick={() => remove(idx)} className="rounded p-1 text-off-error"><Trash2 className="h-4 w-4" /></button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label className="text-gray-300 text-xs">Nome do botão</Label>
                <Input data-testid={`ab-label-${idx}`} value={b.label} onChange={(e) => update(idx, { label: e.target.value })} className="off-input mt-1" placeholder="Ex: Agendar agora" /></div>
              <div><Label className="text-gray-300 text-xs">Tipo de atendimento</Label>
                <Select value={b.service_type} onValueChange={(v) => update(idx, { service_type: v })}>
                  <SelectTrigger data-testid={`ab-type-${idx}`} className="off-input mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-off-blue/40 bg-off-surface text-white">{SERVICE_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label className="text-gray-300 text-xs">Destino do botão</Label>
                <Select value={b.destination} onValueChange={(v) => update(idx, { destination: v })}>
                  <SelectTrigger data-testid={`ab-dest-${idx}`} className="off-input mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-off-blue/40 bg-off-surface text-white">{DESTINATIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label className="text-gray-300 text-xs">Prazo estimado de resposta</Label>
                <Input value={b.response_time} onChange={(e) => update(idx, { response_time: e.target.value })} className="off-input mt-1" placeholder="Ex: até 1 hora" /></div>

              {b.destination === "external" && (
                <div className="sm:col-span-2"><Label className="text-gray-300 text-xs">Link externo (https://)</Label>
                  <Input data-testid={`ab-url-${idx}`} value={b.external_url} onChange={(e) => update(idx, { external_url: e.target.value })} className="off-input mt-1" placeholder="https://..." /></div>
              )}
              {b.destination === "whatsapp" && (
                <div className="sm:col-span-2"><Label className="text-gray-300 text-xs">Mensagem automática do WhatsApp</Label>
                  <Textarea value={b.whatsapp_message} onChange={(e) => update(idx, { whatsapp_message: e.target.value })} className="mt-1 border-off-blue/40 bg-off-bg text-white" placeholder="Complemento da mensagem enviada" />
                  {!(whatsapp || "").trim() && <p className="mt-1 text-[11px] text-off-warning">Preencha o WhatsApp do estabelecimento acima para ativar este botão.</p>}
                </div>
              )}
            </div>

            <div className="mt-3">
              <Label className="text-gray-300 text-xs">Dias disponíveis (vazio = todos)</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {DAYS.map(([v, l]) => {
                  const on = (b.valid_days || []).includes(v);
                  return <button key={v} type="button" data-testid={`ab-day-${idx}-${v}`} onClick={() => toggleDay(idx, v)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${on ? "off-gradient text-white" : "border border-off-blue/40 text-gray-400"}`}>{l}</button>;
                })}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><Label className="text-gray-300 text-xs">Horário inicial</Label><Input type="time" value={b.hours_start} onChange={(e) => update(idx, { hours_start: e.target.value })} className="off-input mt-1" /></div>
              <div><Label className="text-gray-300 text-xs">Horário final</Label><Input type="time" value={b.hours_end} onChange={(e) => update(idx, { hours_end: e.target.value })} className="off-input mt-1" /></div>
              <div><Label className="text-gray-300 text-xs">Taxa de entrega (R$, opcional)</Label><Input type="number" value={b.delivery_fee ?? ""} onChange={(e) => update(idx, { delivery_fee: e.target.value === "" ? "" : parseFloat(e.target.value) })} className="off-input mt-1" placeholder="Opcional" /></div>
              <div><Label className="text-gray-300 text-xs">Prazo para uso (opcional)</Label><Input value={b.deadline} onChange={(e) => update(idx, { deadline: e.target.value })} className="off-input mt-1" placeholder="Ex: 48 horas" /></div>
            </div>
            <div className="mt-3"><Label className="text-gray-300 text-xs">Bairros/regiões atendidos (opcional)</Label><Input value={b.areas} onChange={(e) => update(idx, { areas: e.target.value })} className="off-input mt-1" placeholder="Ex: Centro, Jardins" /></div>
            <div className="mt-3"><Label className="text-gray-300 text-xs">Observações para o consumidor</Label><Textarea value={b.observations} onChange={(e) => update(idx, { observations: e.target.value })} className="mt-1 border-off-blue/40 bg-off-bg text-white" /></div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg bg-off-bg/60 px-3 py-2"><span className="text-sm text-gray-300">Desconto válido nesta modalidade</span><Switch data-testid={`ab-discount-${idx}`} checked={!!b.discount_valid} onCheckedChange={(v) => update(idx, { discount_valid: v })} /></div>
              <div className="flex items-center justify-between rounded-lg bg-off-bg/60 px-3 py-2"><span className="text-sm text-gray-300">Requer pagamento antecipado</span><Switch checked={!!b.requires_prepayment} onCheckedChange={(v) => update(idx, { requires_prepayment: v })} /></div>
            </div>
          </div>
        ))}
      </div>

      {list.length < 3 && (
        <Button data-testid="ab-add" type="button" variant="outline" onClick={add} className="mt-3 w-full rounded-xl border-off-blue/40 text-white"><Plus className="mr-1 h-4 w-4" /> Adicionar botão ({list.length}/3)</Button>
      )}

      {/* Prévia */}
      <div className="mt-4 rounded-xl border border-off-orange/30 bg-off-orange/5 p-3" data-testid="ab-preview">
        <p className="text-[11px] font-semibold text-off-orange">PRÉVIA — como o consumidor verá</p>
        {preview.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {preview.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1.5 rounded-xl off-gradient px-3 py-2 text-sm font-semibold text-white"><DestIcon d={b.destination} /> {b.label}</span>
            ))}
          </div>
        ) : <p className="mt-1 text-xs text-gray-500">Nenhum botão completo ainda. Ative e preencha o nome para exibir aos consumidores.</p>}
      </div>
    </div>
  );
}
