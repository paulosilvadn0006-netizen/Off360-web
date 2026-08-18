// WebSocket do 360Taxi: camada de sinal em tempo real. Reconexão automática.
// Ao receber evento, os hooks disparam refetch do react-query (DB = fonte de verdade).
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

function wsUrl() {
  const base = process.env.REACT_APP_BACKEND_URL || "";
  const u = base.replace(/^http/, "ws");
  return `${u}/api/taxi/ws`;
}

let socket = null;
let refCount = 0;
let reconnectTimer = null;
let pingTimer = null;
const listeners = new Set();

function connect() {
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
  try {
    socket = new WebSocket(wsUrl());
  } catch (_) { scheduleReconnect(); return; }
  socket.onopen = () => {
    listeners.forEach((l) => l({ type: "__status", connected: true }));
    clearInterval(pingTimer);
    pingTimer = setInterval(() => { try { socket && socket.readyState === 1 && socket.send("ping"); } catch (_) {} }, 25000);
  };
  socket.onmessage = (ev) => {
    let data = null;
    try { data = JSON.parse(ev.data); } catch (_) { return; }
    listeners.forEach((l) => l(data));
  };
  socket.onclose = () => { listeners.forEach((l) => l({ type: "__status", connected: false })); scheduleReconnect(); };
  socket.onerror = () => { try { socket.close(); } catch (_) {} };
}

function scheduleReconnect() {
  clearInterval(pingTimer);
  if (reconnectTimer || refCount === 0) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; if (refCount > 0) connect(); }, 2500);
}

function subscribe(cb) {
  listeners.add(cb);
  refCount += 1;
  if (refCount === 1) connect();
  return () => {
    listeners.delete(cb);
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      clearInterval(pingTimer);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      try { socket && socket.close(); } catch (_) {}
      socket = null;
    }
  };
}

// Invalida as queryKeys informadas ao receber qualquer evento taxi; retorna se está conectado.
export function useTaxiRealtime(queryKeys = []) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg?.type === "__status") { setConnected(!!msg.connected); return; }
      // Qualquer evento do taxi => refetch das queries relevantes (sem duplicar dados)
      keysRef.current.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    });
    return unsub;
  }, [qc]);
  return connected;
}
