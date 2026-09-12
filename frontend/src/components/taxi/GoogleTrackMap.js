import React, { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/googleMaps";
import RouteMap from "@/components/taxi/RouteMap";

// Estilo claro e legível para o mapa durante a corrida.
const LIGHT_STYLE = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
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

// Ícone de carro (vista de cima), preto e bem definido, girado conforme o rumo.
function vehicleIcon(maps, type, heading) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <g transform="rotate(${Math.round(heading || 0)} 24 24)">
      <ellipse cx="24" cy="26" rx="12" ry="17" fill="#000" opacity="0.18"/>
      <rect x="13" y="6" width="22" height="36" rx="9" fill="#111827" stroke="#ffffff" stroke-width="2"/>
      <rect x="15.5" y="9" width="17" height="9" rx="4" fill="#0b1220"/>
      <rect x="16" y="10" width="16" height="7" rx="3" fill="#9fd0ff" opacity="0.9"/>
      <rect x="15.5" y="29" width="17" height="9" rx="4" fill="#0b1220"/>
      <rect x="16" y="30" width="16" height="7" rx="3" fill="#5f7896" opacity="0.7"/>
      <rect x="11.5" y="14" width="3" height="7" rx="1.5" fill="#111827"/>
      <rect x="33.5" y="14" width="3" height="7" rx="1.5" fill="#111827"/>
      <rect x="11.5" y="27" width="3" height="7" rx="1.5" fill="#111827"/>
      <rect x="33.5" y="27" width="3" height="7" rx="1.5" fill="#111827"/>
    </g></svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new maps.Size(48, 48),
    anchor: new maps.Point(24, 24),
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
          gestureHandling: "greedy", clickableIcons: false, styles: LIGHT_STYLE,
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
