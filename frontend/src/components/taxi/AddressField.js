import React, { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { MapPin, Star, X, Loader2, Navigation, Search } from "lucide-react";

// Campo de endereço editável com autocomplete (OSM) + endereços salvos.
export default function AddressField({ testId, icon, placeholder, value, onChange, saved, onSave, onRemoveSaved, onGps, testPoints }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sugg, setSugg] = useState([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const tRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current);
    const term = q.trim();
    if (term.length < 3) { setSugg([]); setLoading(false); return; }
    setLoading(true);
    tRef.current = setTimeout(async () => {
      try { const { data } = await api.get("/taxi/geocode", { params: { q: term } }); setSugg(data || []); }
      catch { setSugg([]); }
      finally { setLoading(false); }
    }, 450);
    return () => { if (tRef.current) clearTimeout(tRef.current); };
  }, [q]);

  const select = (pt) => {
    onChange({ lat: pt.lat, lng: pt.lng, address: pt.address });
    setQ(""); setSugg([]); setOpen(false);
  };

  const isSaved = value && (saved || []).some((s) => Math.abs(s.lat - value.lat) < 1e-4 && Math.abs(s.lng - value.lng) < 1e-4);
  const term = q.trim();

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2">{icon}</span>
        <input
          data-testid={testId}
          value={open ? q : (value?.address || "")}
          onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setOpen(true); setQ(""); }}
          placeholder={placeholder}
          className="off-input w-full pl-9 pr-9"
        />
        {value && onSave && (
          <button type="button" data-testid={`${testId}-save`} onClick={() => onSave(value)} title="Salvar endereço"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2">
            <Star className={`h-4 w-4 ${isSaved ? "fill-off-orange text-off-orange" : "text-gray-400"}`} />
          </button>
        )}
      </div>

      {open && (
        <div data-testid={`${testId}-panel`} className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-off-blue/40 bg-off-surface p-1 shadow-xl">
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
              {!loading && sugg.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">Nenhum endereço encontrado.</p>}
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
