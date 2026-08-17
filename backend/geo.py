"""Camada de roteamento DESACOPLADA do 360Taxi.
Provider padrão: OSRM público (router.project-osrm.org). Fallback: Haversine (linha reta * fator de via).
Trocar de provider/hospedar OSRM próprio = mudar apenas OSRM_BASE_URL ou este arquivo, sem tocar no módulo taxi.
"""
import os
import math
import requests

OSRM_BASE = (os.environ.get("OSRM_BASE_URL") or "https://router.project-osrm.org").rstrip("/")
ROAD_FACTOR = 1.3        # aproxima distância de via a partir da linha reta
AVG_SPEED_KMH = 30.0     # velocidade média urbana para ETA no fallback


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


def route(origin, dest):
    """origin/dest: {"lat":..,"lng":..}. Retorna distance_km, duration_min, geometry [[lat,lng]...], provider."""
    try:
        url = f"{OSRM_BASE}/route/v1/driving/{origin['lng']},{origin['lat']};{dest['lng']},{dest['lat']}"
        resp = requests.get(url, params={"overview": "full", "geometries": "geojson"}, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return _haversine_route(origin, dest)
        rt = data["routes"][0]
        geom = [[c[1], c[0]] for c in rt["geometry"]["coordinates"]]  # OSRM = [lng,lat]
        return {
            "distance_km": round(rt["distance"] / 1000.0, 3),
            "duration_min": round(rt["duration"] / 60.0, 1),
            "geometry": geom,
            "provider": "osrm",
        }
    except Exception:
        return _haversine_route(origin, dest)
