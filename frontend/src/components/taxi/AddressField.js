import React, { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { MapPin, Star, X, Loader2, Navigation, Search } from "lucide-react";

// Campo de endereço editável com autocomplete (OSM) + endereços salvos.
export default function AddressField({ testId, icon, placeholder, value, onChange, saved, onSave, onRemoveSaved, onGps, testPoints, bias, pointLabel }) {
  const [text, setText] = useState(value?.address || "");
  const [open, setOpen] = useState(false);
  const [sugg, setSugg] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(null); // resultado sem número aguardando confirmação
  const [num, setNum] = useState("");
  const wrapRef = useRef(null);
  const tRef = useRef(null);

  // Sincroniza o texto quando o valor é definido por fora (GPS, salvo, local de teste).
  useEffect(() => { setText(value?.address || ""); }, [value?.address]);

  // Fecha o painel ao clicar fora — MAS mantém o texto digitado.
  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Autocomplete (apenas com o painel aberto).
  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current);
    const term = text.trim();
    if (!open || term.length < 3) { setLoading(false); return; }
    setLoading(true);
    tRef.current = setTimeout(async () => {
      try { const { data } = await api.get("/taxi/geocode", { params: { q: term, ...(bias ? { lat: bias.lat, lng: bias.lng } : {}) } }); setSugg(data || []); }
      catch { setSugg([]); }
      finally { setLoading(false); }
    }, 450);
    return () => { if (tRef.current) clearTimeout(tRef.current); };
  }, [text, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const finalize = (p) => {
    onChange({ lat: p.lat, lng: p.lng, address: p.address });
    setText(p.address); setSugg([]); setOpen(false);
  };

  // Resolve coordenadas de uma predição do Google (place_id) quando ainda não tem lat/lng.
  const resolveCoords = async (item) => {
    if (item && item.lat != null && item.lng != null) return item;
    if (item && item.place_id) {
      try {
        const { data } = await api.get("/taxi/place-details", { params: { place_id: item.place_id } });
        if (data && data.lat != null) return { ...item, ...data };
      } catch { /* ignore */ }
    }
    return null;
  };

  const select = async (pt) => {
    const r = await resolveCoords(pt);
    if (!r) { if (bias) finalize({ lat: bias.lat, lng: bias.lng, address: pt.address || text }); return; }
    finalize(r);
    // Se o endereço não tem número, oferece confirmar o número (refinamento opcional).
    setPending(r.has_number === false ? r : null);
    setNum("");
  };

  const confirmManual = async () => {
    const t = text.trim();
    if (t.length < 5) return;
    try {
      const { data } = await api.get("/taxi/geocode", { params: { q: t, ...(bias ? { lat: bias.lat, lng: bias.lng } : {}) } });
      const r = data && data[0] ? await resolveCoords(data[0]) : null;
      if (r) finalize(r);
      else if (bias) finalize({ lat: bias.lat, lng: bias.lng, address: t });
    } catch {
      if (bias) finalize({ lat: bias.lat, lng: bias.lng, address: t });
    }
  };

  const confirmNumber = async () => {
    const n = num.trim();
    if (!n || !pending) return;
    try {
      const { data } = await api.get("/taxi/geocode", { params: { q: `${pending.address}, ${n}`, ...(bias ? { lat: bias.lat, lng: bias.lng } : {}) } });
      const pick = (data || []).find((x) => x.has_number) || (data || [])[0];
      const r = pick ? await resolveCoords(pick) : null;
      finalize(r || { ...pending, address: `${pending.address} - nº ${n}` });
    } catch {
      finalize({ ...pending, address: `${pending.address} - nº ${n}` });
    }
    setPending(null); setNum("");
  };

  const isSaved = value && (saved || []).some((s) => Math.abs(s.lat - value.lat) < 1e-4 && Math.abs(s.lng - value.lng) < 1e-4);
  const term = text.trim();

  return (
    <div ref={wrapRef} className="relative z-[1000]">
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2">{icon}</span>
        <input
          data-testid={testId}
          value={text}
          onChange={(e) => { setText(e.target.value); setPending(null); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || "Digite rua e número, ex: Av. Brasil, 123"}
          className="off-input w-full pl-9 pr-9"
        />
        {value && onSave && (
          <button type="button" data-testid={`${testId}-save`} onClick={() => onSave(value)} title="Salvar endereço"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2">
            <Star className={`h-4 w-4 ${isSaved ? "fill-off-orange text-off-orange" : "text-gray-400"}`} />
          </button>
        )}
      </div>

      {pending && (
        <div data-testid={`${testId}-number-prompt`} className="mt-2 rounded-xl border border-off-orange/50 bg-off-orange/10 p-3">
          <p className="text-[11px] text-off-orange">Este endereço não tem número. Informe o número {pointLabel ? `do ${pointLabel}` : ""} para o motorista chegar ao ponto certo.</p>
          <div className="mt-2 flex gap-2">
            <input data-testid={`${testId}-number-input`} value={num} onChange={(e) => setNum(e.target.value)} inputMode="numeric" placeholder="Número" className="off-input flex-1" />
            <button type="button" data-testid={`${testId}-number-confirm`} onClick={confirmNumber} disabled={!num.trim()} className="rounded-xl off-gradient px-4 text-sm font-semibold text-white disabled:opacity-50">Confirmar</button>
          </div>
          <button type="button" data-testid={`${testId}-number-skip`} onClick={() => { finalize(pending); setPending(null); }} className="mt-2 text-[11px] text-gray-500">Continuar sem número</button>
        </div>
      )}

      {open && (
        <div data-testid={`${testId}-panel`} className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-off-blue/40 bg-off-surface p-1 shadow-xl">
          <p className="px-3 pb-1 pt-2 text-[10px] text-gray-500">💡 Inclua o número da rua para maior precisão. Ex.: <span className="text-gray-400">Av. Brasil, 123, Campinas</span></p>

          {onGps && (
            <button type="button" onClick={() => { onGps(); setOpen(false); }} data-testid={`${testId}-gps`}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-off-bg/60">
              <Navigation className="h-4 w-4 text-off-orange" /> Usar minha localização (GPS)
            </button>
          )}

          {(saved || []).length > 0 && <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Endereços salvos</p>}
          {(saved || []).map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-off-bg/60" data-testid={`${testId}-saved-${s.id}`}>
              <button type="button" onClick={() => select(s)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <Star className="h-3.5 w-3.5 shrink-0 fill-off-orange text-off-orange" />
                <span className="min-w-0">
                  {s.label ? <span className="block truncate text-sm text-white">{s.label}</span> : null}
                  <span className={`block truncate ${s.label ? "text-[11px] text-gray-400" : "text-sm text-white"}`}>{s.address}</span>
                </span>
              </button>
              {onRemoveSaved && <button type="button" onClick={() => onRemoveSaved(s.id)} className="shrink-0 text-gray-500 hover:text-off-error" data-testid={`${testId}-remove-${s.id}`}><X className="h-3.5 w-3.5" /></button>}
            </div>
          ))}

          {(testPoints || []).length > 0 && <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Locais de teste</p>}
          {(testPoints || []).map((p) => (
            <button type="button" key={p.key} onClick={() => select({ lat: p.lat, lng: p.lng, address: p.label })}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-off-bg/60">
              <MapPin className="h-3.5 w-3.5 text-gray-400" /> {p.label}
            </button>
          ))}

          {term.length >= 3 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Resultados</p>
              {loading && <p className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Buscando endereços…</p>}
              {!loading && sugg.length === 0 && (
                <div className="px-3 py-2">
                  <p className="text-sm text-gray-500">Nenhuma sugestão automática.</p>
                  <button type="button" data-testid={`${testId}-manual`} onClick={confirmManual} className="mt-1 rounded-lg off-gradient px-3 py-1.5 text-xs font-semibold text-white">Usar o endereço digitado</button>
                </div>
              )}
              {!loading && sugg.map((s, i) => (
                <button type="button" key={i} data-testid={`${testId}-sugg-${i}`} onClick={() => select(s)}
                  className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-off-bg/60">
                  <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" /> <span className="min-w-0 flex-1">{s.address}</span>
                </button>
              ))}
            </>
          )}
          {term.length > 0 && term.length < 3 && <p className="px-3 py-2 text-xs text-gray-500">Digite pelo menos 3 letras…</p>}
        </div>
      )}
    </div>
  );
}
