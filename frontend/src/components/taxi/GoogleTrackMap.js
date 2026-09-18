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

// ---- Utilidades de polyline (road snapping) ----
const EARTH_R = 6371000;
function metersBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Distâncias acumuladas (metros) ao longo do caminho.
function buildCum(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + metersBetween(path[i - 1], path[i]);
  return cum;
}
// Projeta p no segmento a-b (aprox. planar local); retorna fração t [0..1] e distância² em m².
function projSegment(p, a, b) {
  const lat0 = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const mx = Math.cos(lat0) * 111320, my = 110540;
  const ax = a.lng * mx, ay = a.lat * my;
  const bx = b.lng * mx, by = b.lat * my;
  const px = p.lng * mx, py = p.lat * my;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t, cy = ay + dy * t;
  const d2 = (px - cx) ** 2 + (py - cy) ** 2;
  return { t, d2 };
}
// Ponto mais próximo do caminho -> distância acumulada (m) e erro (m).
function projectOnPath(path, cum, p) {
  let best = { dist: 0, d2: Infinity };
  for (let i = 0; i < path.length - 1; i++) {
    const { t, d2 } = projSegment(p, path[i], path[i + 1]);
    if (d2 < best.d2) best = { d2, dist: cum[i] + (cum[i + 1] - cum[i]) * t };
  }
  return { dist: best.dist, err: Math.sqrt(best.d2) };
}
// Ponto (e rumo) a uma distância acumulada s (m) ao longo do caminho.
function pointAtDist(path, cum, s) {
  const total = cum[cum.length - 1];
  s = Math.max(0, Math.min(total, s));
  for (let i = 0; i < path.length - 1; i++) {
    if (s <= cum[i + 1] || i === path.length - 2) {
      const seg = cum[i + 1] - cum[i] || 1e-9;
      const t = (s - cum[i]) / seg;
      const a = path[i], b = path[i + 1];
      return { pos: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, heading: bearing(a, b) };
    }
  }
  const a = path[path.length - 2] || path[0], b = path[path.length - 1] || path[0];
  return { pos: b, heading: bearing(a, b) };
}
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

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
  // Road snapping: caminho seguido pelo carro (polyline da rota) + distâncias acumuladas.
  const routePath = useRef(null);
  const routeCum = useRef(null);
  const sPos = useRef(null);        // posição atual do carro em metros ao longo do caminho
  const dirService = useRef(null);
  const lastDirFetch = useRef(0);
  const [failed, setFailed] = useState(false);
  const [sec, setSec] = useState(null);

  // Define/atualiza o caminho seguido e redesenha a polyline no mapa.
  const applyRoutePath = (pts) => {
    if (!pts || pts.length < 2) return;
    routePath.current = pts;
    routeCum.current = buildCum(pts);
    sPos.current = null; // recomeça a projeção na nova rota
    if (objs.current.poly) objs.current.poly.setPath(pts);
  };

  // Busca a rota (nas vias) do carro até o alvo quando não há geometria pronta (fase de pickup).
  const fetchDirRoute = (maps, from, to) => {
    const now = performance.now();
    if (now - lastDirFetch.current < 4000) return; // throttle p/ não estourar quota
    lastDirFetch.current = now;
    if (!dirService.current) dirService.current = new maps.DirectionsService();
    dirService.current.route(
      { origin: from, destination: to, travelMode: maps.TravelMode.DRIVING },
      (res, status) => {
        if (status === "OK" && res.routes && res.routes[0] && res.routes[0].overview_path) {
          const pts = res.routes[0].overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
          applyRoutePath(pts);
        }
      }
    );
  };

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
        const g = (geometry || []).map(([lat, lng]) => ({ lat, lng }));
        objs.current.poly = new maps.Polyline({ path: g, strokeColor: "#FF6A00", strokeWeight: 5, strokeOpacity: 0.95, map: m });
        if (origin) objs.current.o = new maps.Marker({ position: origin, map: m, icon: pinIcon(maps, "#22c55e") });
        if (destination) objs.current.d = new maps.Marker({ position: destination, map: m, icon: pinIcon(maps, "#ef4444") });
        car.current = makeCarOverlay(maps);
        car.current.setMap(m);
        car.current.setPos(start, 0);
        car.current.setEta(sec != null ? `${fmtEta(sec)} ${etaText || ""}`.trim() : "");
        prev.current = carPos || null;
        // Rota a seguir: geometria pronta (viagem) ou rota do carro->passageiro (pickup).
        if (g.length >= 2) applyRoutePath(g);
        else if (origin && carPos) fetchDirRoute(maps, carPos, origin);
        const b = new maps.LatLngBounds();
        g.forEach((p) => b.extend(p));
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
    if (!maps || !map.current || !car.current || !carPos) return;

    // Quando a geometria da viagem chega/muda, passa a segui-la.
    if (geometry && geometry.length >= 2) {
      const g = geometry.map(([lat, lng]) => ({ lat, lng }));
      if (!routePath.current || routePath.current.length !== g.length) applyRoutePath(g);
    } else if (origin) {
      // Pickup sem geometria: garante a rota nas vias e refaz se o carro sair dela.
      if (!routePath.current) fetchDirRoute(maps, carPos, origin);
      else {
        const pr = projectOnPath(routePath.current, routeCum.current, carPos);
        if (pr.err > 140) fetchDirRoute(maps, carPos, origin);
      }
    }

    const from = prev.current || carPos;
    if (raf.current) cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const dur = 900;

    const path = routePath.current, cum = routeCum.current;
    const snap = path && cum && cum[cum.length - 1] > 0;
    let a0 = 0, a1 = 0;
    if (snap) {
      a0 = sPos.current != null ? sPos.current : projectOnPath(path, cum, from).dist;
      a1 = projectOnPath(path, cum, carPos).dist;
      sPos.current = a1;
    } else if (from.lat !== carPos.lat || from.lng !== carPos.lng) {
      heading.current = bearing(from, carPos);
    }

    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = easeInOut(k);
      if (snap) {
        const s = a0 + (a1 - a0) * e;
        const { pos, heading: h } = pointAtDist(path, cum, s);
        car.current.setPos(pos, h);
      } else {
        car.current.setPos(
          { lat: from.lat + (carPos.lat - from.lat) * e, lng: from.lng + (carPos.lng - from.lng) * e },
          heading.current
        );
      }
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
