import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChefHat, Loader2, Volume2, Wifi, WifiOff } from "lucide-react";
import * as kdsAlert from "@/lib/merchantAlert";

const COLS = [
  ["new", "Novos", "preparing", "Iniciar Preparo"],
  ["preparing", "Em preparo", "ready", "Pronto"],
  ["ready", "Prontos", "delivered", "Entregue"],
];

function Center({ children }) {
  return <div className="flex min-h-screen items-center justify-center bg-off-bg p-6 text-center text-gray-300">{children}</div>;
}

export default function Kitchen() {
  const [sp] = useSearchParams();
  const eid = sp.get("loja") || sp.get("token");
  const [soundOn, setSoundOn] = useState(false);
  const prevNew = useRef(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-kitchen", eid],
    enabled: !!eid,
    queryFn: async () => (await api.get(`/presencial/kitchen/${eid}`)).data,
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
    retry: true,
  });
  const board = data?.board || { new: [], preparing: [], ready: [] };

  useEffect(() => {
    if (soundOn && board.new.length > prevNew.current && prevNew.current !== 0) kdsAlert.playChime();
    prevNew.current = board.new.length;
  }, [board.new.length, soundOn]);

  // Wake Lock: mantém a tela do tablet/monitor sempre acesa.
  useEffect(() => {
    let lock = null;
    const acquire = async () => { try { if ("wakeLock" in navigator) lock = await navigator.wakeLock.request("screen"); } catch (_) {} };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); try { lock && lock.release(); } catch (_) {} };
  }, []);

  const enableSound = async () => { await kdsAlert.unlock(); setSoundOn(true); toast.success("Alerta sonoro ativado"); };
  const setStatus = async (it, status) => { try { await api.post(`/presencial/kitchen/${eid}/status`, { comanda_id: it.comanda_id, idx: it.idx, status }); } catch (e) { toast.error(formatApiError(e)); } };

  if (!eid) return <Center>Link inválido. Solicite o link da cozinha ao estabelecimento.</Center>;
  if (isLoading) return <Center><Loader2 className="h-6 w-6 animate-spin text-off-orange" /></Center>;

  return (
    <div className="min-h-screen bg-off-bg p-4" data-testid="kitchen-page">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-off-orange" />
          <div>
            <h1 className="font-display text-xl font-bold text-white">Cozinha{data?.establishment?.fantasy_name ? ` — ${data.establishment.fantasy_name}` : ""}</h1>
            <p className="flex items-center gap-1 text-[11px] text-gray-400" data-testid="kitchen-conn-status">
              {isError ? <><WifiOff className="h-3 w-3 text-off-error" /> Reconectando...</> : <><Wifi className="h-3 w-3 text-off-success" /> Tempo real</>}
            </p>
          </div>
        </div>
        {!soundOn && <Button data-testid="kitchen-enable-sound" onClick={enableSound} className="rounded-xl bg-off-blue text-xs font-semibold text-white"><Volume2 className="mr-1.5 h-4 w-4" /> Ativar som</Button>}
      </div>

      <div className="grid gap-3 md:grid-cols-3" data-testid="kitchen-board">
        {COLS.map(([key, title, next, nextLabel]) => (
          <div key={key} className="off-card p-3">
            <p className="mb-2 font-display text-lg font-bold text-off-orange">{title} ({(board[key] || []).length})</p>
            <div className="space-y-2">
              {(board[key] || []).map((it, i) => (
                <div key={i} className="rounded-lg border border-off-blue/30 bg-off-bg/50 p-2" data-testid={`kitchen-${key}-${i}`}>
                  <p className="text-lg font-semibold text-white">{it.qty || 1}× {it.name}</p>
                  <p className="text-sm text-gray-400">{it.table_name}</p>
                  {it.observations ? <p data-testid={`kitchen-obs-${key}-${i}`} className="mt-1 rounded bg-off-error/25 px-2 py-1 text-sm font-bold uppercase text-off-error">⚠ {it.observations}</p> : null}
                  {(it.addons || []).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(it.addons || []).filter((a) => a?.name).map((a, ai) => (a.price
                        ? <span key={ai} className="rounded bg-off-blue/15 px-1.5 py-0.5 text-[11px] text-gray-300">+ {a.name}</span>
                        : <span key={ai} data-testid={`kitchen-remove-${key}-${i}-${ai}`} className="rounded bg-off-error/25 px-1.5 py-0.5 text-[11px] font-bold uppercase text-off-error">{a.name}</span>))}
                    </div>
                  )}
                  <Button data-testid={`kitchen-action-${key}-${i}`} onClick={() => setStatus(it, next)} className="mt-2 h-10 w-full rounded-lg off-gradient text-sm font-semibold text-white">{nextLabel}</Button>
                </div>
              ))}
              {(board[key] || []).length === 0 && <p className="text-xs text-gray-500">—</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
