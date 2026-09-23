import React, { useEffect, useRef, useState } from "react";
import { MapPin, LocateFixed, LocateOff, Loader2 } from "lucide-react";

// Botão reutilizável de GPS: pede permissão, ativa acompanhamento contínuo e
// informa o estado (ativo / negado / indisponível). Chama onUpdate({lat,lng,accuracy})
// a cada nova posição enquanto o componente estiver na tela.
export function LocationButton({ onUpdate, testId = "gps-button", className = "" }) {
  const [status, setStatus] = useState("idle"); // idle | active | denied | unavailable | prompting
  const watchRef = useRef(null);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; });

  const stopWatch = () => {
    if (watchRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current);
    }
    watchRef.current = null;
  };

  const startWatch = () => {
    if (!navigator.geolocation) { setStatus("unavailable"); return; }
    if (watchRef.current != null) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        setStatus("active");
        onUpdateRef.current && onUpdateRef.current({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (err) => {
        stopWatch();
        setStatus(err && err.code === 1 ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  };

  // Se a permissão já foi concedida, ativa automaticamente ao abrir a tela.
  useEffect(() => {
    if (!navigator.geolocation) { setStatus("unavailable"); return; }
    let alive = true;
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then((res) => {
        if (!alive) return;
        if (res.state === "granted") startWatch();
        else if (res.state === "denied") setStatus("denied");
        res.onchange = () => {
          if (res.state === "granted") startWatch();
          else if (res.state === "denied") { stopWatch(); setStatus("denied"); }
        };
      }).catch(() => {});
    }
    return () => { alive = false; stopWatch(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = () => {
    if (!navigator.geolocation) { setStatus("unavailable"); return; }
    setStatus("prompting");
    // getCurrentPosition dispara o prompt de permissão; em seguida mantemos o watch.
    navigator.geolocation.getCurrentPosition(
      (p) => { onUpdateRef.current && onUpdateRef.current({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); startWatch(); setStatus("active"); },
      (err) => { setStatus(err && err.code === 1 ? "denied" : "unavailable"); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const isActive = status === "active";
  const blocked = status === "denied" || status === "unavailable";

  return (
    <div className={className}>
      <button
        type="button"
        data-testid={testId}
        data-gps-status={status}
        onClick={handleClick}
        className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-colors ${
          isActive
            ? "bg-off-success/15 text-off-success ring-1 ring-off-success/40"
            : blocked
              ? "bg-off-error/15 text-off-error ring-1 ring-off-error/40"
              : "off-gradient text-white"
        }`}
      >
        {status === "prompting" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Obtendo localização…</>
        ) : isActive ? (
          <><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-off-success opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-off-success" /></span> GPS ativo — atualizando em tempo real</>
        ) : status === "denied" ? (
          <><LocateOff className="h-4 w-4" /> Permissão negada — toque para tentar</>
        ) : status === "unavailable" ? (
          <><LocateOff className="h-4 w-4" /> GPS indisponível</>
        ) : (
          <><LocateFixed className="h-4 w-4" /> Ativar localização</>
        )}
      </button>
      {status === "denied" && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-off-error" data-testid={`${testId}-denied-hint`}>
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> Localização bloqueada. Ative o GPS e permita o acesso à localização nas configurações do seu dispositivo/navegador.
        </p>
      )}
      {status === "unavailable" && (
        <p className="mt-1.5 text-[11px] text-off-error" data-testid={`${testId}-unavailable-hint`}>
          Seu dispositivo/navegador não oferece GPS. Ative a localização nas configurações e recarregue.
        </p>
      )}
    </div>
  );
}

export default LocationButton;
