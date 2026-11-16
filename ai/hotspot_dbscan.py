#!/usr/bin/env python3
"""
AetherGrid Spatial Hotspot Detection (DBSCAN + Threshold Analysis)
------------------------------------------------------------------
Detects elevated pollutant clusters using Haversine DBSCAN clustering
across ground monitoring stations, IoT sensors, and modeled spatial grids.

Never infers street-level precision from sparse station observations;
explicitly labels data provenance (observed vs modeled_grid).
"""

import json
import math
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set


DEFAULT_THRESHOLDS = {
    "pm2_5": 25.0,
    "pm10": 50.0,
    "us_aqi": 100.0,
    "eu_aqi": 60.0,
    "no2": 80.0,
    "o3": 100.0,
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def safe_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def classify_severity(val: float, threshold: float) -> str:
    ratio = val / max(1.0, threshold)
    if ratio >= 2.0:
        return "critical"
    if ratio >= 1.35:
        return "high"
    return "moderate"


def dbscan_haversine(points: List[Dict[str, Any]], eps_km: float, min_samples: int) -> List[int]:
    n = len(points)
    labels = [-2] * n  # -2 unvisited, -1 noise, >= 0 cluster id
    cluster_id = 0

    def region_query(idx: int) -> List[int]:
        p = points[idx]
        neighbors = []
        for j in range(n):
            if haversine_km(p["lat"], p["lon"], points[j]["lat"], points[j]["lon"]) <= eps_km:
                neighbors.append(j)
        return neighbors

    for i in range(n):
        if labels[i] != -2:
            continue
        neighbors = region_query(i)
        if len(neighbors) < min_samples:
            labels[i] = -1
            continue

        labels[i] = cluster_id
        queue = list(neighbors)
        visited_in_q: Set[int] = set(neighbors)

        pos = 0
        while pos < len(queue):
            q_idx = queue[pos]
            pos += 1
            if labels[q_idx] == -1:
                labels[q_idx] = cluster_id
            if labels[q_idx] != -2:
                continue
            labels[q_idx] = cluster_id
            q_neighbors = region_query(q_idx)
            if len(q_neighbors) >= min_samples:
                for nb in q_neighbors:
                    if nb not in visited_in_q:
                        visited_in_q.add(nb)
                        queue.append(nb)

        cluster_id += 1

    return labels


def detect_hotspots(payload: Dict[str, Any]) -> Dict[str, Any]:
    pollutant = str(payload.get("pollutant", "pm2_5"))
    threshold = safe_float(payload.get("threshold"))
    if threshold is None:
        threshold = DEFAULT_THRESHOLDS.get(pollutant, 25.0)
    eps_km = float(payload.get("epsKm", 8.5))
    min_samples = int(payload.get("minSamples", 2))
    points = payload.get("points", [])

    elevated: List[Dict[str, Any]] = []
    for p in points:
        lat = safe_float(p.get("lat"))
        lon = safe_float(p.get("lon"))
        val = safe_float(p.get(pollutant))
        if lat is None or lon is None or val is None:
            continue
        if val >= threshold:
            elevated.append(
                {
                    "id": str(p.get("id", "")),
                    "name": str(p.get("name", "Station")),
                    "lat": lat,
                    "lon": lon,
                    "value": val,
                    "sourceType": str(p.get("sourceType", "modeled")),
                    "provider": str(p.get("provider", "Open-Meteo")),
                    "observedAt": str(p.get("observedAt", datetime.now(timezone.utc).isoformat())),
                }
            )

    if not elevated:
        return {
            "status": "ok",
            "algorithm": "Haversine DBSCAN + Threshold Analysis",
            "pollutant": pollutant,
            "threshold": threshold,
            "epsKm": eps_km,
            "minSamples": min_samples,
            "evaluatedPoints": len(points),
            "elevatedPoints": 0,
            "hotspots": [],
            "precisionNotice": "Regional cluster analysis only; sparse station coverage does not imply street-level uniformity.",
        }

    labels = dbscan_haversine(elevated, eps_km=eps_km, min_samples=min_samples)

    clusters: Dict[int, List[Dict[str, Any]]] = {}
    noise_points: List[Dict[str, Any]] = []
    for item, lbl in zip(elevated, labels):
        if lbl == -1:
            noise_points.append(item)
        else:
            clusters.setdefault(lbl, []).append(item)

    hotspots: List[Dict[str, Any]] = []
    for cid, members in clusters.items():
        c_lat = sum(m["lat"] for m in members) / len(members)
        c_lon = sum(m["lon"] for m in members) / len(members)
        max_dist = max(haversine_km(c_lat, c_lon, m["lat"], m["lon"]) for m in members)
        peak_val = max(m["value"] for m in members)
        mean_val = sum(m["value"] for m in members) / len(members)
        sources = sorted(set(m["sourceType"] for m in members))
        providers = sorted(set(m["provider"] for m in members))
        hotspots.append(
            {
                "id": f"cluster-{cid + 1}",
                "clusterType": "dbscan_cluster",
                "label": f"Elevated {pollutant.upper()} Zone #{cid + 1}",
                "pollutant": pollutant,
                "centroidLat": round(c_lat, 5),
                "centroidLon": round(c_lon, 5),
                "radiusKm": round(max(1.2, max_dist + 0.8), 2),
                "peakValue": round(peak_val, 2),
                "meanValue": round(mean_val, 2),
                "threshold": threshold,
                "severity": classify_severity(peak_val, threshold),
                "stationCount": len(members),
                "sourceTypes": sources,
                "providers": providers,
                "isModeledSurface": "observed" not in sources,
                "observedAt": max(m["observedAt"] for m in members),
                "supportingStations": [
                    {
                        "id": m["id"],
                        "name": m["name"],
                        "value": round(m["value"], 2),
                        "sourceType": m["sourceType"],
                        "lat": m["lat"],
                        "lon": m["lon"],
                    }
                    for m in members[:8]
                ],
            }
        )

    # Also include high-severity isolated threshold exceedances so critical single-station spikes are never hidden
    for idx, np_item in enumerate(noise_points):
        if np_item["value"] >= threshold * 1.15 or len(hotspots) == 0:
            hotspots.append(
                {
                    "id": f"exceedance-{idx + 1}",
                    "clusterType": "threshold_exceedance",
                    "label": f"Localized {pollutant.upper()} Exceedance — {np_item['name']}",
                    "pollutant": pollutant,
                    "centroidLat": round(np_item["lat"], 5),
                    "centroidLon": round(np_item["lon"], 5),
                    "radiusKm": 1.5,
                    "peakValue": round(np_item["value"], 2),
                    "meanValue": round(np_item["value"], 2),
                    "threshold": threshold,
                    "severity": classify_severity(np_item["value"], threshold),
                    "stationCount": 1,
                    "sourceTypes": [np_item["sourceType"]],
                    "providers": [np_item["provider"]],
                    "isModeledSurface": np_item["sourceType"] != "observed",
                    "observedAt": np_item["observedAt"],
                    "supportingStations": [
                        {
                            "id": np_item["id"],
                            "name": np_item["name"],
                            "value": round(np_item["value"], 2),
                            "sourceType": np_item["sourceType"],
                            "lat": np_item["lat"],
                            "lon": np_item["lon"],
                        }
                    ],
                }
            )

    hotspots.sort(key=lambda h: h["peakValue"], reverse=True)

    return {
        "status": "ok",
        "algorithm": "Haversine DBSCAN + Threshold Analysis",
        "pollutant": pollutant,
        "threshold": threshold,
        "epsKm": eps_km,
        "minSamples": min_samples,
        "evaluatedPoints": len(points),
        "elevatedPoints": len(elevated),
        "hotspots": hotspots,
        "precisionNotice": "Regional cluster analysis only; sparse station coverage does not imply street-level uniformity.",
    }


def main() -> None:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        result = detect_hotspots(payload)
        sys.stdout.write(json.dumps(result))
    except Exception as exc:
        sys.stdout.write(
            json.dumps(
                {
                    "status": "error",
                    "reason": str(exc),
                    "hotspots": [],
                }
            )
        )


if __name__ == "__main__":
    main()
