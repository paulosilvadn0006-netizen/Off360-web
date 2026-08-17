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
const CAR = L.divIcon({
  className: "off-taxi-car",
  html: `<div style="font-size:26px;line-height:1;transform:translateY(-2px);filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))">🚗</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
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

export default function RouteMap({ geometry, origin, destination, carPos, height = 260 }) {
  const geo = geometry && geometry.length ? geometry : [];
  const pts = [];
  if (origin) pts.push([origin.lat, origin.lng]);
  if (destination) pts.push([destination.lat, destination.lng]);
  geo.forEach((g) => pts.push(g));
  const center = pts[0] || [-22.7326, -47.3306];

  return (
    <div className="overflow-hidden rounded-2xl border border-off-blue/40" style={{ height }} data-testid="taxi-route-map">
      <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false} attributionControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {geo.length > 1 && <Polyline positions={geo} pathOptions={{ color: "#FF6A00", weight: 5, opacity: 0.9 }} />}
        {origin && <Marker position={[origin.lat, origin.lng]} icon={ORIGIN} />}
        {destination && <Marker position={[destination.lat, destination.lng]} icon={DEST} />}
        {carPos && <Marker position={[carPos.lat, carPos.lng]} icon={CAR} />}
        <FitBounds points={pts} />
      </MapContainer>
    </div>
  );
}
