import React, { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/googleMaps";
import RouteMap from "@/components/taxi/RouteMap";

// Estilo escuro para combinar com o tema do app.
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0b1220" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1220" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a93a6" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1c2537" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0b1220" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2a3550" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1a2f" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

// Rumo (bearing) entre dois pontos, para girar o ícone do veículo.
function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Ícone do veículo (carro ou moto), vista de cima, girado conforme o rumo.
function vehicleIcon(maps, type, heading) {
  const inner =
    type === "moto"
      ? `<rect x="18" y="9" width="8" height="26" rx="4" fill="#FF6A00" stroke="#fff" stroke-width="2"/><circle cx="22" cy="13" r="2.5" fill="#0b1220"/><circle cx="22" cy="31" r="2.5" fill="#0b1220"/>`
      : `<rect x="13" y="7" width="18" height="30" rx="7" fill="#FF6A00" stroke="#fff" stroke-width="2"/><rect x="16" y="11" width="12" height="8" rx="2" fill="#0b1220" opacity="0.85"/><rect x="16" y="26" width="12" height="7" rx="2" fill="#0b1220" opacity="0.6"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><g transform="rotate(${Math.round(heading || 0)} 22 22)">${inner}</g></svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new maps.Size(44, 44),
    anchor: new maps.Point(22, 22),
  };
}

function pinIcon(maps, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34"><path d="M14 0C6.8 0 1 5.8 1 13c0 9 13 21 13 21s13-12 13-21C27 5.8 21.2 0 14 0z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="14" cy="13" r="5" fill="#fff"/></svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new maps.Size(28, 34),
    anchor: new maps.Point(14, 34),
  };
}

// Mapa de rastreamento em tempo real (Google Maps). Mesmas props do RouteMap.
export default function GoogleTrackMap({ geometry, origin, destination, carPos, carVehicleType, height = 260 }) {
  const ref = useRef(null);
  const map = useRef(null);
  const objs = useRef({});
  const prev = useRef(null);
  const heading = useRef(0);
  const raf = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !ref.current) return;
        const start = carPos || origin || destination || { lat: -22.7326, lng: -47.3306 };
        const m = new maps.Map(ref.current, {
          center: start, zoom: 15, disableDefaultUI: true, zoomControl: true,
          gestureHandling: "greedy", clickableIcons: false, styles: DARK_STYLE,
        });
        map.current = m;
        const path = (geometry || []).map(([lat, lng]) => ({ lat, lng }));
        objs.current.poly = new maps.Polyline({ path, strokeColor: "#FF6A00", strokeWeight: 5, strokeOpacity: 0.95, map: m });
        if (origin) objs.current.o = new maps.Marker({ position: origin, map: m, icon: pinIcon(maps, "#22c55e") });
        if (destination) objs.current.d = new maps.Marker({ position: destination, map: m, icon: pinIcon(maps, "#ef4444") });
        objs.current.veh = new maps.Marker({ position: start, map: m, icon: vehicleIcon(maps, carVehicleType, 0), zIndex: 999 });
        prev.current = carPos || null;
        const b = new maps.LatLngBounds();
        path.forEach((p) => b.extend(p));
        if (origin) b.extend(origin);
        if (destination) b.extend(destination);
        if (carPos) b.extend(carPos);
        if (!b.isEmpty()) m.fitBounds(b, 44);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (raf.current) cancelAnimationFrame(raf.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const maps = window.google && window.google.maps;
    if (!maps || !map.current || !objs.current.veh) return;
    if (objs.current.poly && geometry) objs.current.poly.setPath((geometry || []).map(([lat, lng]) => ({ lat, lng })));
    if (!carPos) return;
    const from = prev.current || carPos;
    if (from.lat !== carPos.lat || from.lng !== carPos.lng) heading.current = bearing(from, carPos);
    objs.current.veh.setIcon(vehicleIcon(maps, carVehicleType, heading.current));
    // Anima suavemente o veículo entre a posição anterior e a nova.
    if (raf.current) cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      objs.current.veh.setPosition({
        lat: from.lat + (carPos.lat - from.lat) * k,
        lng: from.lng + (carPos.lng - from.lng) * k,
      });
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    map.current.panTo(carPos);
    prev.current = carPos;
  }, [carPos && carPos.lat, carPos && carPos.lng, carVehicleType, geometry]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return <RouteMap geometry={geometry} origin={origin} destination={destination} carPos={carPos} carVehicleType={carVehicleType} height={height} />;
  }
  return <div ref={ref} data-testid="taxi-google-track-map" className="overflow-hidden rounded-2xl border border-off-blue/40" style={{ height, width: "100%" }} />;
}
