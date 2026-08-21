"""Camada de geocoding/roteamento DESACOPLADA do 360Taxi.
Provider: Google Maps Platform (Geocoding API + Directions API).
Fallback de rota: Haversine (linha reta * fator de via) caso a API falhe.
Trocar de provider = mudar apenas este arquivo, sem tocar no módulo taxi.
"""
import os
import math
import requests

GOOGLE_KEY = os.environ.get("GOOGLE_MAPS_API_KEY")
GMAPS = "https://maps.googleapis.com/maps/api"
ROAD_FACTOR = 1.3        # aproxima distância de via a partir da linha reta (fallback)
AVG_SPEED_KMH = 30.0     # velocidade média urbana para ETA no fallback


def _has_number(components):
    """True se o endereço tiver número (street_number) nos componentes do Google."""
    for c in components or []:
        if "street_number" in (c.get("types") or []):
            return True
    return False


def geocode(query, limit=6, lat=None, lng=None):
    """Autocomplete de endereços (Google Places Autocomplete).
    Retorna predições SEM coordenadas: [{address, place_id, has_number, lat:None, lng:None}].
    As coordenadas são resolvidas via place_details() ao selecionar uma predição."""
    q = (query or "").strip()
    if len(q) < 3 or not GOOGLE_KEY:
        return []
    params = {"input": q, "key": GOOGLE_KEY, "language": "pt-BR", "components": "country:br"}
    if lat is not None and lng is not None:
        params["location"] = f"{lat},{lng}"
        params["radius"] = 30000  # viés de proximidade (metros)
    try:
        resp = requests.get(f"{GMAPS}/place/autocomplete/json", params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") not in ("OK", "ZERO_RESULTS"):
            return []
        out = []
        for p in (data.get("predictions") or [])[:limit]:
            types = p.get("types") or []
            has_num = any(t in types for t in ("street_address", "premise", "subpremise"))
            out.append({"address": p.get("description"), "place_id": p.get("place_id"),
                        "has_number": has_num, "lat": None, "lng": None})
        return out
    except Exception:
        return []


def place_details(place_id):
    """Resolve coordenadas + endereço formatado de um place_id (Google Place Details)."""
    if not place_id or not GOOGLE_KEY:
        return None
    try:
        resp = requests.get(f"{GMAPS}/place/details/json", params={
            "place_id": place_id, "key": GOOGLE_KEY, "language": "pt-BR",
            "fields": "geometry,formatted_address,address_component",
        }, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "OK":
            return None
        r = data.get("result") or {}
        loc = ((r.get("geometry") or {}).get("location")) or {}
        if "lat" not in loc or "lng" not in loc:
            return None
        return {"address": r.get("formatted_address"),
                "lat": float(loc["lat"]), "lng": float(loc["lng"]),
                "has_number": _has_number(r.get("address_components"))}
    except Exception:
        return None


def reverse_geocode(lat, lng):
    """Endereço textual a partir de coordenadas. Provider: Google Geocoding."""
    if not GOOGLE_KEY:
        return ""
    try:
        resp = requests.get(
            f"{GMAPS}/geocode/json",
            params={"latlng": f"{lat},{lng}", "key": GOOGLE_KEY, "language": "pt-BR"},
            timeout=8,
        )
        resp.raise_for_status()
        results = resp.json().get("results") or []
        return results[0].get("formatted_address") or "" if results else ""
    except Exception:
        return ""


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _haversine_route(origin, dest):
    km = haversine_km(origin["lat"], origin["lng"], dest["lat"], dest["lng"]) * ROAD_FACTOR
    dur_min = (km / AVG_SPEED_KMH) * 60.0
    return {
        "distance_km": round(km, 3),
        "duration_min": round(dur_min, 1),
        "geometry": [[origin["lat"], origin["lng"]], [dest["lat"], dest["lng"]]],
        "provider": "haversine",
    }


def _decode_polyline(s):
    """Decodifica polyline codificada do Google em [[lat, lng], ...]."""
    coords, index, lat, lng = [], 0, 0, 0
    length = len(s or "")
    while index < length:
        result, shift = 0, 0
        while True:
            b = ord(s[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        lat += ~(result >> 1) if (result & 1) else (result >> 1)
        result, shift = 0, 0
        while True:
            b = ord(s[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        lng += ~(result >> 1) if (result & 1) else (result >> 1)
        coords.append([lat / 1e5, lng / 1e5])
    return coords


def route(origin, dest):
    """origin/dest: {"lat":..,"lng":..}. Retorna distance_km, duration_min, geometry [[lat,lng]...], provider.
    Provider: Google Directions. Fallback: Haversine."""
    if GOOGLE_KEY:
        try:
            resp = requests.get(f"{GMAPS}/directions/json", params={
                "origin": f"{origin['lat']},{origin['lng']}",
                "destination": f"{dest['lat']},{dest['lng']}",
                "mode": "driving", "language": "pt-BR", "region": "br",
                "key": GOOGLE_KEY,
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if data.get("status") == "OK" and data.get("routes"):
                rt = data["routes"][0]
                leg = rt["legs"][0]
                geom = _decode_polyline((rt.get("overview_polyline") or {}).get("points"))
                if not geom:
                    geom = [[origin["lat"], origin["lng"]], [dest["lat"], dest["lng"]]]
                return {
                    "distance_km": round(leg["distance"]["value"] / 1000.0, 3),
                    "duration_min": round(leg["duration"]["value"] / 60.0, 1),
                    "geometry": geom,
                    "provider": "google",
                }
        except Exception:
            pass
    return _haversine_route(origin, dest)
