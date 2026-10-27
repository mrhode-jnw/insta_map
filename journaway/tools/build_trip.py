#!/usr/bin/env python3
"""Erzeugt aus journaway/trip.json die Datendateien der Journaway-App:
journaway/data/places.js (Spots), trip.js (Route, Hotels, Infos) und itinerary.js (Tagesablauf).

Aufruf:  python3 journaway/tools/build_trip.py
Neue Reise = trip.json austauschen (gleiche Struktur) und das Skript laufen lassen.
Stopps, die kein Spot sind (Bahnhöfe, Konbini), werden zu Info-Karten im Tagesablauf.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
T = json.load(open(os.path.join(ROOT, "trip.json"), encoding="utf-8"))
CITY = T["cities"]


def js(name, obj):
    path = os.path.join(ROOT, "data", name)
    with open(path, "w", encoding="utf-8") as f:
        f.write("// Erzeugt von journaway/tools/build_trip.py aus trip.json – nicht von Hand bearbeiten.\n")
        f.write(obj)
    print("geschrieben:", path)


def dayid(n):
    return "d%02d" % n


# ---- Spots
places, info_only = [], {}
for sid, s in T["spots"].items():
    if s.get("noMap") or s["kind"] == "station":
        info_only[sid] = s
        continue
    p = {"id": sid, "region": "jp", "name": s["n"], "district": CITY[s["city"]]["name"], "city": s["city"],
         "category": "Food" if s["kind"] == "food" else "", "kind": s["kind"], "note": s["t"], "address": CITY[s["city"]]["name"],
         "lat": s["lat"], "lng": s["lng"], "approx": False}
    if s.get("tip"):
        p["by_claude"] = True
    places.append(p)
used = set()

# ---- Tagesablauf
days = []
for d in T["days"]:
    items = []
    for note in d.get("info", []):
        items.append({"type": "info", "icon": "ℹ️", "text": note})
    for st in d["stops"]:
        sid = st["id"]
        if sid in info_only:
            s = info_only[sid]
            it = {"type": "info", "icon": "🚄" if s["kind"] == "station" else "🍙", "title": s["n"], "text": s["t"]}
            if st.get("time"):
                it["t"] = st["time"]
            if s["kind"] == "station":
                it.update(lat=s["lat"], lng=s["lng"], anchor=True)
            items.append(it)
            continue
        if sid not in T["spots"]:
            sys.exit("Unbekannte Spot-ID: " + sid)
        used.add(sid)
        s = T["spots"][sid]
        it = {"type": "stop", "spot": sid, "lat": s["lat"], "lng": s["lng"]}
        if st.get("time"):
            it["t"] = st["time"]
        if s.get("tip"):
            it["opt"] = True
        else:
            it["plan"] = True
        if st.get("note"):
            it["text"] = st["note"]
        items.append(it)
    if "hotel" in d:
        h = T["hotels"][d["hotel"]]
        items.append({"type": "hotel", "name": h["name"], "label": "Übernachtung", "lat": h["lat"], "lng": h["lng"]})
    days.append({"date": dayid(d["n"]), "n": d["n"], "city": d["city"], "title": d["title"], "teaser": d["teaser"],
                 "text": d["text"], "status": "fest", "items": items})

missing = [k for k in T["spots"] if k not in used and k not in info_only]
if missing:
    print("Hinweis: Spots ohne Tag:", ", ".join(missing))

hotels = {h["name"]: {"name": h["name"], "dates": h["nights"], "lat": h["lat"], "lng": h["lng"], "approx": h.get("approx", False),
                      "address": CITY[h["city"]]["name"], "photos": [h["img"]] if h.get("img") else []} for h in T["hotels"]}

route = []
for city in ("tokyo", "kyoto", "osaka"):
    ds = [d["n"] for d in T["days"] if d["city"] == city]
    h = next(x for x in T["hotels"] if x["city"] == city)
    route.append({"d": "Tag %d–%d" % (min(ds), max(ds)), "name": CITY[city]["name"], "lat": h["lat"], "lng": h["lng"], "r": 40})

trip = {"title": T["title"], "subtitle": T["subtitle"], "nights": T["nights"], "support": T["support"], "included": T["included"],
        "optional": T["optional"], "cities": CITY, "route": route,
        "hotels": [{"name": h["name"], "dates": h["nights"], "lat": h["lat"], "lng": h["lng"], "approx": h.get("approx", False),
                    "address": CITY[h["city"]]["name"], "city": h["city"], "img": h.get("img", "")} for h in T["hotels"]]}

js("places.js", "window.PLACES = " + json.dumps(places, ensure_ascii=False, indent=1) + ";\n")
js("trip.js", "window.TRIP = " + json.dumps(trip, ensure_ascii=False, indent=1) + ";\n")
js("itinerary.js", "window.ITINERARY = " + json.dumps({"days": days, "hotels": hotels, "fixLegs": []}, ensure_ascii=False) + ";\n")
