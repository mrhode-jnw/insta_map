#!/usr/bin/env python3
"""Welche Orte braucht der Fakten-Nachschub als Nächstes?

    python3 unnuetzes_wissen/tools/next_places.py [--days 4] [--date YYYY-MM-DD]

Liest den Reiseplan (data/trip.js im Repo-Root) und ordnet jede Station dem nächsten Ort
aus taxonomy.json zu. Ausgabe als JSON: für heute bis heute+N Tage die Orts-ID, die Stationen
(Recherche-Hinweise) und wie viele Fakten der Ort schon hat – knappste zuerst.
Datum in Asia/Shanghai, weil die Reise dort stattfindet.
"""
import json, math, pathlib, re, sys, datetime, zoneinfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
TAX = json.loads((ROOT / "data" / "taxonomy.json").read_text())
IDX = json.loads((ROOT / "data" / "index.json").read_text())
TRIP = (ROOT.parent / "data" / "trip.js").read_text()


def km(a, b, c, d):
    r = math.radians
    return 6371 * 2 * math.asin(math.sqrt(math.sin(r(c - a) / 2) ** 2 + math.cos(r(a)) * math.cos(r(c)) * math.sin(r(d - b) / 2) ** 2))


def route():
    for m in re.finditer(r'\{\s*d:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+)', TRIP.split("hotels:")[0]):
        d, name, lat, lng = m.group(1), m.group(2), float(m.group(3)), float(m.group(4))
        dm = re.match(r"^(\d{1,2})\.(?:(\d{1,2})\.)?(?:\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.)?$", d)
        if not dm:
            continue
        sm, em = dm.group(2) or dm.group(4), dm.group(4) or dm.group(2)
        yield (int(sm), int(dm.group(1))), (int(em), int(dm.group(3) or dm.group(1))), name, lat, lng


def place_of(lat, lng):
    best = min(TAX["places"], key=lambda p: km(lat, lng, p["lat"], p["lon"]))
    return best["id"] if km(lat, lng, best["lat"], best["lon"]) <= best.get("radiusKm", 30) * 1.5 else None


def main():
    args = sys.argv[1:]
    days = int(args[args.index("--days") + 1]) if "--days" in args else 4
    today = (datetime.date.fromisoformat(args[args.index("--date") + 1]) if "--date" in args
             else datetime.datetime.now(zoneinfo.ZoneInfo("Asia/Shanghai")).date())
    counts = {p["place"]: p["count"] for p in IDX["packs"] if p.get("place")}
    out = {}
    for i in range(days):
        day = today + datetime.timedelta(days=i)
        key = (day.month, day.day)
        for start, end, name, lat, lng in route():
            if start <= key <= end:
                pid = place_of(lat, lng)
                if not pid:
                    continue
                e = out.setdefault(pid, {"place": pid, "name": next(p["name"] for p in TAX["places"] if p["id"] == pid),
                                         "facts": counts.get(pid, 0), "first_day": day.isoformat(), "stops": []})
                if name not in e["stops"]:
                    e["stops"].append(name)
    res = sorted(out.values(), key=lambda e: (e["facts"], e["first_day"]))
    print(json.dumps({"today": today.isoformat(), "places": res}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
