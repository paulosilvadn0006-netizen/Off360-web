import React, { useState, useRef, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sparkles, Send, Paperclip, Loader2, CheckCircle2, X, FileText, ImagePlus } from "lucide-react";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

export default function AI360() {
  const { selectedId, establishments } = useOutletContext();
  const eid = selectedId && selectedId !== "all" ? selectedId : establishments?.[0]?.id;
  const qc = useQueryClient();
  const sessionRef = useRef(uid());
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [brandBusy, setBrandBusy] = useState("");
  const scrollRef = useRef(null);

  const uploadBrand = async (type, file) => {
    if (!eid || !file) return;
    setBrandBusy(type);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/upload", fd);
      await api.post("/merchant/ai360/brand", { establishment_id: eid, type, url: data.url });
      toast.success(type === "logo" ? "Logotipo ajustado (1:1 redondo) e salvo!" : "Fachada ajustada (16:9) e salva!");
      qc.invalidateQueries({ queryKey: ["m-establishments"] });
      qc.invalidateQueries({ queryKey: ["m-est", eid] });
    } catch (err) { toast.error(formatApiError(err, "Falha ao processar a foto")); } finally { setBrandBusy(""); }
  };

  useEffect(() => {
    if (!eid) return;
    (async () => {
      try { const { data } = await api.get("/merchant/ai360/history", { params: { establishment_id: eid, session_id: sessionRef.current } }); setMessages(data); } catch { /* noop */ }
    })();
  }, [eid]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, sending]);

  const onAttach = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        const fd = new FormData(); fd.append("file", f);
        const { data } = await api.post("/upload", fd);
        setAttachments((a) => [...a, { url: data.url, name: f.name, isPdf: /pdf$/i.test(f.name) || f.type === "application/pdf" }]);
      }
    } catch (err) { toast.error(formatApiError(err, "Falha ao enviar arquivo")); } finally { setUploading(false); }
  };

  const send = async () => {
    if (!eid) { toast.error("Selecione um estabelecimento no topo."); return; }
    if (!text.trim() && !attachments.length) return;
    const outMsg = { role: "user", content: text.trim() + (attachments.length ? `  [${attachments.length} anexo(s)]` : "") };
    setMessages((m) => [...m, outMsg]);
    const payload = { establishment_id: eid, session_id: sessionRef.current, message: text.trim(), attachments };
    setText(""); setAttachments([]); setSending(true);
    try {
      const { data } = await api.post("/merchant/ai360/chat", payload);
      setMessages((m) => [...m, { role: "assistant", content: data.reply, actions: data.actions || [] }]);
      if ((data.actions || []).length) { qc.invalidateQueries({ queryKey: ["m-est", eid] }); qc.invalidateQueries({ queryKey: ["m-establishments"] }); qc.invalidateQueries({ queryKey: ["m-dashboard"] }); }
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: formatApiError(err, "A IA 360 não conseguiu responder agora. Tente novamente."), actions: [] }]);
    } finally { setSending(false); }
  };

  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div className="animate-fade-up" data-testid="ai360-page">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl off-gradient"><Sparkles className="h-5 w-5 text-white" /></span>
        <div>
          <h1 className="font-display text-2xl font-bold text-white">IA 360</h1>
          <p className="text-sm text-gray-400">Crie e atualize seu cadastro conversando. Envie fotos, PDF do cardápio ou digite.</p>
        </div>
      </div>

      <div className="mt-4 off-card p-4" data-testid="ai360-brand">
        <p className="text-sm font-bold text-white">Fotos da marca</p>
        <p className="mt-0.5 text-[11px] text-gray-400">Envie o logotipo e a fachada — a IA 360 ajusta o formato (logo 1:1 redondo, fachada 16:9) e salva no seu perfil.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label data-testid="brand-logo-btn" className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-off-blue/50 p-4 text-xs text-gray-300 ${brandBusy === "logo" ? "opacity-50" : "hover:border-off-orange"}`}>
            {brandBusy === "logo" ? <Loader2 className="h-5 w-5 animate-spin text-off-orange" /> : <ImagePlus className="h-5 w-5 text-off-orange" />} Logotipo (1:1)
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { uploadBrand("logo", e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <label data-testid="brand-cover-btn" className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-off-blue/50 p-4 text-xs text-gray-300 ${brandBusy === "cover" ? "opacity-50" : "hover:border-off-orange"}`}>
            {brandBusy === "cover" ? <Loader2 className="h-5 w-5 animate-spin text-off-orange" /> : <ImagePlus className="h-5 w-5 text-off-orange" />} Fachada (16:9)
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { uploadBrand("cover", e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      <div className="mt-5 off-card flex h-[62vh] flex-col p-0">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4" data-testid="ai360-messages">
          {messages.length === 0 && (
            <div className="mx-auto mt-8 max-w-md text-center text-sm text-gray-400">
              <Sparkles className="mx-auto h-8 w-8 text-off-orange" />
              <p className="mt-3 font-semibold text-white">Envie seu cardápio, catálogo, PDF, fotos ou conte sobre seu negócio.</p>
              <p className="mt-1 text-xs">Ex.: "Cadastre X-Bacon R$ 32,90 e Coca R$ 6". Ou "coloque 10% de desconto acima de R$ 80".</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`ai360-msg-${m.role}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "off-gradient text-white" : "border border-off-blue/40 bg-off-bg/60 text-gray-100"}`}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {(m.actions || []).length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-white/15 pt-2">
                    {m.actions.map((a, j) => (
                      <div key={j} className="flex items-center gap-1.5 text-[11px] text-off-success"><CheckCircle2 className="h-3.5 w-3.5" /> {a}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && <div className="flex justify-start"><div className="rounded-2xl border border-off-blue/40 bg-off-bg/60 px-3.5 py-2.5 text-sm text-gray-300"><Loader2 className="h-4 w-4 animate-spin text-off-orange" /></div></div>}
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-off-blue/30 p-2" data-testid="ai360-attachments">
            {attachments.map((a, i) => (
              <div key={i} className="relative h-14 w-14 overflow-hidden rounded-lg border border-off-blue/40 bg-off-bg">
                {a.isPdf ? <div className="flex h-full flex-col items-center justify-center text-[9px] text-gray-300"><FileText className="h-5 w-5 text-off-orange" />PDF</div> : <img alt="" src={fileUrl(a.url)} className="h-full w-full object-cover" />}
                <button data-testid={`ai360-att-remove-${i}`} onClick={() => setAttachments((arr) => arr.filter((_, idx) => idx !== i))} className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 border-t border-off-blue/30 p-3">
          <label className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-off-blue/40 text-gray-300 ${uploading ? "opacity-50" : "hover:border-off-blue"}`} data-testid="ai360-attach-btn">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
            <input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={onAttach} />
          </label>
          <textarea data-testid="ai360-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} placeholder="Escreva para a IA 360…" className="off-input max-h-28 flex-1 resize-none py-2.5" />
          <Button data-testid="ai360-send" onClick={send} disabled={sending || uploading} className="h-11 w-11 shrink-0 rounded-xl off-gradient p-0 text-white"><Send className="h-5 w-5" /></Button>
        </div>
      </div>
    </div>
  );
}
