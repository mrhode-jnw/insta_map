#!/usr/bin/env python3
"""Reiseplan Tag für Tag: cn/itinerary.json → data/itinerary.js (window.ITINERARY).

Prüft, dass jeder Stopp ein Spot ist, ergänzt Hotel-Daten aus data/trip.js und berechnet für
Auto-Etappen ohne Zeitangabe Fahrzeit und Strecke (OSRM, routing.openstreetmap.de; für China
mit Faktor 1,2 und auf 5 Min. gerundet) samt Wegverlauf für die Karte.

  python3 tools/build_itinerary.py
"""
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "cn", "itinerary.json")
OUT = os.path.join(ROOT, "data", "itinerary.js")
CACHE = os.path.join(ROOT, "cn", "itinerary_routes.json")


def load_places():
    ids = {}
    for f, var in (("places.js", "PLACES"), ("china.js", "PLACES_CN")):
        s = open(os.path.join(ROOT, "data", f), encoding="utf-8").read()
        m = re.search(var + r"\s*=\s*(\[.*?\]);\s*\n", s, re.S)
        for p in json.loads(m.group(1)):
            ids[p["id"]] = p
    return ids


def load_hotels():
    s = open(os.path.join(ROOT, "data", "trip.js"), encoding="utf-8").read()
    s = s[s.index("hotels:"):]
    out = {}
    for m in re.finditer(r'\{ name: "([^"]+)", zh: "([^"]*)", lat: ([\d.]+), lng: ([\d.]+),(?: approx: (true),)?\s*'
                         r'address: "([^"]*)", dates: "([^"]*)", room: "([^"]*)"', s):
        n, zh, la, ln, ap, addr, dates, room = m.groups()
        out[n] = {"name": n, "zh": zh, "lat": float(la), "lng": float(ln), "approx": bool(ap),
                  "address": addr, "dates": dates, "room": room, "booked": True}
    return out


def osrm(a, b, cache):
    key = f"{a[0]:.5f},{a[1]:.5f};{b[0]:.5f},{b[1]:.5f}"
    if key not in cache:
        u = (f"https://routing.openstreetmap.de/routed-car/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}"
             "?overview=simplified&geometries=geojson")
        r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "insta-map"}), timeout=60))["routes"][0]
        cache[key] = {"m": r["distance"], "s": r["duration"],
                      "path": [[round(c[1], 5), round(c[0], 5)] for c in r["geometry"]["coordinates"]]}
    return cache[key]


def main():
    src = json.load(open(SRC, encoding="utf-8"))
    places, hotels = load_places(), load_hotels()
    for k, h in src.get("hotels", {}).items():
        hotels[k] = {**hotels.get(k, {}), **h}
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    errors = []
    for day in src["days"]:
        items = day["items"]
        for it in items:  # Koordinaten je Eintrag
            if it["type"] == "stop":
                p = places.get(it["spot"])
                if not p:
                    errors.append(f'{day["date"]}: Spot fehlt: {it["spot"]}')
                    continue
                it["lat"], it["lng"] = p["lat"], p["lng"]
            elif it["type"] == "hotel":
                h = hotels.get(it["name"])
                if not h or "lat" not in h:
                    errors.append(f'{day["date"]}: Hotel unbekannt: {it["name"]}')
                    continue
                it["lat"], it["lng"] = h["lat"], h["lng"]
        for i, it in enumerate(items):  # Auto-Etappen berechnen
            if it["type"] != "move" or it.get("mode") != "car":
                continue
            a = next((x for x in reversed(items[:i]) if "lat" in x), None)
            b = next((x for x in items[i + 1:] if "lat" in x), None)
            if not a or not b:
                continue
            r = osrm((a["lat"], a["lng"]), (b["lat"], b["lng"]), cache)
            it["km"] = round(r["m"] / 1000)
            if "min" not in it:
                it["min"] = max(5, int(round(r["s"] / 60 * 1.2 / 5) * 5))
            it["path"] = r["path"]
    if errors:
        sys.exit("\n".join(errors))
    json.dump(cache, open(CACHE, "w"), separators=(",", ":"))
    used = {it["name"] for d in src["days"] for it in d["items"] if it["type"] == "hotel"}
    data = {"days": src["days"], "hotels": {k: v for k, v in hotels.items() if k in used}}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Reiseplan Tag für Tag – erzeugt von tools/build_itinerary.py aus cn/itinerary.json\n")
        f.write("window.ITINERARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    n = sum(1 for d in src["days"] for it in d["items"] if it["type"] == "stop")
    print(f"✔ {len(src['days'])} Tage, {n} Stopps → data/itinerary.js")


if __name__ == "__main__":
    main()
