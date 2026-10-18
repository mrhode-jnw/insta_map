#!/usr/bin/env python3
"""Rundgänge (Sightseeing zu Fuß) → data/walks.js (window.WALKS).

Quelle: cn/walks.json – je Rundgang Titel, Einleitung, Tipps und Stationen (name, name_cn, lat, lng, approx, text).
Fußwege zwischen den Stationen per OSRM (Profil „foot“, routing.openstreetmap.de), Cache cn/walks_routes.json.
Liegen die Stationen abseits des OSM-Wegenetzes (Dörfer sind oft nicht kartiert, Einrasten > 60 m), wird die
direkte Linie gezeichnet und die Länge ×1,3 geschätzt.

  python3 tools/build_walks.py
"""
import json
import math
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "cn", "walks.json")
CACHE = os.path.join(ROOT, "cn", "walks_routes.json")
OUT = os.path.join(ROOT, "data", "walks.js")
OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/{},{};{},{}?overview=full&geometries=geojson"


def dist(a, b):
    r = math.pi / 180
    x = (b[1] - a[1]) * r * math.cos((a[0] + b[0]) / 2 * r)
    y = (b[0] - a[0]) * r
    return 6371000 * math.hypot(x, y)


def leg(a, b, cache):
    k = f"{a[0]:.5f},{a[1]:.5f};{b[0]:.5f},{b[1]:.5f}"
    if k not in cache:
        try:
            with urllib.request.urlopen(OSRM.format(a[1], a[0], b[1], b[0]), timeout=20) as r:
                j = json.load(r)
            rt, wp = j["routes"][0], j["waypoints"]
            if max(w.get("distance", 0) for w in wp) <= 60 and rt["distance"] <= 4 * dist(a, b) + 150:
                cache[k] = {"m": round(rt["distance"]), "path": [[round(y, 6), round(x, 6)] for x, y in rt["geometry"]["coordinates"]]}
            else:
                cache[k] = None
        except Exception as e:  # offline: nicht cachen, direkte Linie
            print("  OSRM:", e)
            return None
    return cache[k]


def main():
    walks = json.load(open(SRC, encoding="utf-8"))
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    for w in walks:
        total, legs = 0, []
        st = w["stops"]
        for a, b in zip(st, st[1:]):
            A, B = (a["lat"], a["lng"]), (b["lat"], b["lng"])
            r = leg(A, B, cache)
            if r:
                legs.append({"path": r["path"], "m": r["m"], "osm": True})
                total += r["m"]
            else:
                m = round(dist(A, B) * 1.3)
                legs.append({"path": [list(A), list(B)], "m": m, "osm": False})
                total += m
        w["legs"], w["km"] = legs, round(total / 1000, 1)
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Generiert von tools/build_walks.py aus cn/walks.json – Rundgänge (Sightseeing zu Fuß).\n")
        f.write("window.WALKS = " + json.dumps(walks, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"✔ {len(walks)} Rundgänge → data/walks.js", [(w["place"], len(w["stops"]), w["km"]) for w in walks])


if __name__ == "__main__":
    main()
