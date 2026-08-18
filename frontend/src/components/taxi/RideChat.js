import React, { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

export default function RideChat({ rideId, myRole }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const boxRef = useRef(null);
  const { data, refetch } = useQuery({
    queryKey: ["ride-chat", rideId],
    queryFn: async () => (await api.get(`/taxi/rides/${rideId}/messages`)).data,
    refetchInterval: 3000,
  });
  const msgs = data || [];

  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [msgs.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try { await api.post(`/taxi/rides/${rideId}/messages`, { text: t }); setText(""); refetch(); }
    catch (_) {} finally { setSending(false); }
  };

  return (
    <div className="off-card p-4" data-testid="ride-chat">
      <p className="mb-2 text-xs font-semibold text-gray-300">💬 Chat da corrida</p>
      <div ref={boxRef} className="max-h-40 space-y-1.5 overflow-y-auto no-scrollbar" data-testid="ride-chat-messages">
        {msgs.length === 0 && <p className="py-3 text-center text-[11px] text-gray-500">Envie uma mensagem para {myRole === "consumer" ? "o motorista" : "o passageiro"}.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.by_role === myRole ? "justify-end" : "justify-start"}`}>
            <span className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${m.by_role === myRole ? "off-gradient text-white" : "bg-off-bg/70 text-gray-100"}`}>{m.text}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input data-testid="ride-chat-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Mensagem..." className="off-input" />
        <Button data-testid="ride-chat-send" onClick={send} disabled={sending} className="rounded-xl off-gradient text-white"><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
