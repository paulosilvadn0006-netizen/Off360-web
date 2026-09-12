import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const pinIcon = (emoji, bg) =>
  L.divIcon({
    className: "off-taxi-pin",
    html: `<div style="font-size:22px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))">${emoji}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

const ORIGIN = pinIcon("📍");
const DEST = pinIcon("🏁");
// Ícone de carro preto bem definido (vista de cima) em SVG.
const carSvg = (star) => `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 48 48">
  <rect x="13" y="6" width="22" height="36" rx="9" fill="#111827" stroke="#ffffff" stroke-width="2"/>
  <rect x="16" y="10" width="16" height="7" rx="3" fill="#9fd0ff"/>
  <rect x="16" y="30" width="16" height="7" rx="3" fill="#5f7896"/>
  ${star ? '<text x="38" y="12" font-size="16">⭐</text>' : ''}
</svg>`;
const CAR = L.divIcon({
  className: "off-taxi-car",
  html: `<div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))">${carSvg(false)}</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});
const vehIcon = () => CAR;
const favIcon = () =>
  L.divIcon({
    className: "off-taxi-fav",
    html: `<div style="position:relative;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))">${carSvg(true)}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    try {
      const b = L.latLngBounds(points);
      map.fitBounds(b, { padding: [30, 30], maxZoom: 16 });
    } catch (_) {}
  }, [points, map]);
  return null;
}

export default function RouteMap({ geometry, origin, destination, carPos, carVehicleType, drivers, height = 260 }) {
  const geo = geometry && geometry.length ? geometry : [];
  const nearby = drivers || [];
  const pts = [];
  if (origin) pts.push([origin.lat, origin.lng]);
  if (destination) pts.push([destination.lat, destination.lng]);
  geo.forEach((g) => pts.push(g));
  nearby.forEach((d) => pts.push([d.lat, d.lng]));
  const center = pts[0] || [-22.7326, -47.3306];

  return (
    <div className="overflow-hidden rounded-2xl border border-off-blue/40" style={{ height }} data-testid="taxi-route-map">
      <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false} attributionControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {geo.length > 1 && <Polyline positions={geo} pathOptions={{ color: "#FF6A00", weight: 5, opacity: 0.9 }} />}
        {origin && <Marker position={[origin.lat, origin.lng]} icon={ORIGIN} />}
        {destination && <Marker position={[destination.lat, destination.lng]} icon={DEST} />}
        {nearby.map((d, i) => <Marker key={`dv${i}`} position={[d.lat, d.lng]} icon={d.favorite ? favIcon() : vehIcon()} />)}
        {carPos && <Marker position={[carPos.lat, carPos.lng]} icon={vehIcon()} />}
        <FitBounds points={pts} />
      </MapContainer>
    </div>
  );
}
