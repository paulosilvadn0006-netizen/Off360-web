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

function pinIcon(maps, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34"><path d="M14 0C6.8 0 1 5.8 1 13c0 9 13 21 13 21s13-12 13-21C27 5.8 21.2 0 14 0z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="14" cy="13" r="5" fill="#fff"/></svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new maps.Size(28, 34),
    anchor: new maps.Point(14, 34),
  };
}

// Formata segundos como "Xm YYs" ou "Ys".
function fmtEta(sec) {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

// Overlay HTML: ícone do carro (PNG preto, vista de cima) girado + bolha de ETA acima.
function makeCarOverlay(maps) {
  class CarOverlay extends maps.OverlayView {
    constructor() {
      super();
      this.pos = null;
      this.heading = 0;
      this.div = null;
    }
    onAdd() {
      const div = document.createElement("div");
      div.style.position = "absolute";
      div.style.transform = "translate(-50%, -50%)";
      div.style.willChange = "left, top";
      div.style.pointerEvents = "none";
      div.innerHTML = `
        <div style="position:relative;width:48px;height:48px;">
          <div class="ct-eta" style="display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);white-space:nowrap;background:#111827;color:#fff;font:800 12px/1.15 Inter,Arial,sans-serif;padding:5px 10px;border-radius:10px;box-shadow:0 4px 10px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18)">
            <span class="ct-eta-txt"></span>
            <span style="position:absolute;top:100%;left:50%;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #111827;"></span>
          </div>
          <img class="ct-car" src="/car-top.png" alt="" style="width:48px;height:48px;display:block;transition:transform .35s ease;filter:drop-shadow(0 4px 6px rgba(0,0,0,.5))"/>
        </div>`;
      this.div = div;
      this.etaBox = div.querySelector(".ct-eta");
      this.etaTxt = div.querySelector(".ct-eta-txt");
      this.carEl = div.querySelector(".ct-car");
      this.getPanes().floatPane.appendChild(div);
    }
    draw() {
      if (!this.div || !this.pos) return;
      const proj = this.getProjection();
      if (!proj) return;
      const p = proj.fromLatLngToDivPixel(new maps.LatLng(this.pos.lat, this.pos.lng));
      if (!p) return;
      this.div.style.left = p.x + "px";
      this.div.style.top = p.y + "px";
      this.carEl.style.transform = `rotate(${Math.round(this.heading)}deg)`;
    }
    setPos(pos, heading) {
      this.pos = pos;
      if (heading != null) this.heading = heading;
      this.draw();
    }
    setEta(text) {
      if (!this.etaBox) return;
      if (text) { this.etaTxt.textContent = text; this.etaBox.style.display = "block"; }
      else this.etaBox.style.display = "none";
    }
    onRemove() {
      if (this.div) { this.div.remove(); this.div = null; }
    }
  }
  return new CarOverlay();
}

// Mapa de rastreamento em tempo real (Google Maps) com ícone de carro preto e ETA ao vivo.
export default function GoogleTrackMap({ geometry, origin, destination, carPos, carVehicleType, etaMin, etaText, height = 260 }) {
  const ref = useRef(null);
  const map = useRef(null);
  const objs = useRef({});
  const car = useRef(null);
  const prev = useRef(null);
  const heading = useRef(0);
  const raf = useRef(null);
  const [failed, setFailed] = useState(false);
  const [sec, setSec] = useState(null);

  // Contador ao vivo: ressincroniza no valor do servidor e decresce 1s por segundo.
  useEffect(() => {
    if (etaMin == null) { setSec(null); return; }
    setSec(Math.max(20, Math.round(etaMin * 60)));
    const t = setInterval(() => setSec((s) => (s == null ? null : Math.max(20, s - 1))), 1000);
    return () => clearInterval(t);
  }, [etaMin]);

  // Atualiza a bolha de ETA no overlay do carro.
  useEffect(() => {
    if (car.current) car.current.setEta(sec != null ? `${fmtEta(sec)} ${etaText || ""}`.trim() : "");
  }, [sec, etaText]);

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
        car.current = makeCarOverlay(maps);
        car.current.setMap(m);
        car.current.setPos(start, 0);
        car.current.setEta(sec != null ? `${fmtEta(sec)} ${etaText || ""}`.trim() : "");
        prev.current = carPos || null;
        const b = new maps.LatLngBounds();
        path.forEach((p) => b.extend(p));
        if (origin) b.extend(origin);
        if (destination) b.extend(destination);
        if (carPos) b.extend(carPos);
        if (!b.isEmpty()) m.fitBounds(b, 60);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (raf.current) cancelAnimationFrame(raf.current);
      if (car.current) { car.current.setMap(null); car.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const maps = window.google && window.google.maps;
    if (!maps || !map.current || !car.current) return;
    if (objs.current.poly && geometry) objs.current.poly.setPath((geometry || []).map(([lat, lng]) => ({ lat, lng })));
    if (!carPos) return;
    const from = prev.current || carPos;
    if (from.lat !== carPos.lat || from.lng !== carPos.lng) heading.current = bearing(from, carPos);
    // Anima suavemente o veículo entre a posição anterior e a nova.
    if (raf.current) cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      car.current.setPos(
        { lat: from.lat + (carPos.lat - from.lat) * k, lng: from.lng + (carPos.lng - from.lng) * k },
        heading.current
      );
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    map.current.panTo(carPos);
    prev.current = carPos;
  }, [carPos && carPos.lat, carPos && carPos.lng, geometry]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return <RouteMap geometry={geometry} origin={origin} destination={destination} carPos={carPos} carVehicleType={carVehicleType} height={height} />;
  }
  return <div ref={ref} data-testid="taxi-google-track-map" className="overflow-hidden rounded-2xl border border-off-blue/40" style={{ height, width: "100%" }} />;
}
