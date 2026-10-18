#!/usr/bin/env python3
"""Lesbarer Reiseplan als Markdown → REISEPLAN.md (für Claude-Chats/Cowork per Link).

Liest data/itinerary.js, data/china.js, data/places.js und data/trip.js. Wird von
tools/build_itinerary.py mit aufgerufen; Touren kommen aus map-data, falls erreichbar.
Keine Buchungsnummern o. Ä. – nur, was ohnehin in der App steht.

  python3 tools/build_reiseplan_md.py
"""
import datetime as dt
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "REISEPLAN.md")
WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
MODE = {"car": "🚗 Auto", "walk": "🚶 zu Fuß", "train": "🚄 Zug", "shuttle": "🚌 Bus/Seilbahn", "taxi": "🚕 Taxi", "boat": "⛴ Boot", "flight": "✈️ Flug"}


def js_value(path, var):
    s = open(os.path.join(ROOT, path), encoding="utf-8").read()
    m = re.search(r"window\.%s\s*=\s*" % var, s)
    if not m:
        return None
    return json.JSONDecoder().raw_decode(s[m.end():])[0]


def trip_hotels():
    """data/trip.js ist JS (keine reinen JSON-Schlüssel) → per node auslesen."""
    try:
        out = subprocess.run(["node", "-e", "global.window={};require(process.argv[1]);console.log(JSON.stringify(window.TRIP))",
                              os.path.join(ROOT, "data", "trip.js")], capture_output=True, text=True, check=True).stdout
        return json.loads(out)
    except Exception:
        return {}


def tours():
    for ref in ("origin/map-data", "map-data"):
        try:
            return json.loads(subprocess.run(["git", "-C", ROOT, "show", f"{ref}:data/my-tours.json"],
                                             capture_output=True, text=True, check=True).stdout)
        except Exception:
            continue
    return []


def main():
    it = js_value("data/itinerary.js", "ITINERARY")
    spots = {p["id"]: p for f, v in (("data/china.js", "PLACES_CN"), ("data/places.js", "PLACES")) for p in (js_value(f, v) or [])}
    trip = trip_hotels()
    name = lambda sid: (spots.get(sid) or {}).get("name", sid)
    L = ["# Reiseplan China (Herbst 2026)", "",
         f"_Automatisch erzeugt aus der Foto-Spot-App am {dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime('%d.%m.%Y %H:%M')} (China-Zeit)._",
         "_Legende: ✅ = fester Programmpunkt (Plan der Agentur) · ◻︎ optional = Vorschlag von Claude · Zeiten Ortszeit China._", ""]
    route = trip.get("route") or []
    if route:
        L += ["## Route im Überblick", ""] + [f"- **{r['d']}** – {r['name']}" for r in route] + [""]
    L += ["## Tag für Tag", ""]
    for day in it["days"]:
        d = dt.date.fromisoformat(day["date"])
        L.append(f"### {WD[d.weekday()]} {d.day}.{d.month}. – {day.get('title', '')}" + (f" _({day['status']})_" if day.get("status") else ""))
        L.append("")
        for x in day["items"]:
            t = f"**{x['t']}** " if x.get("t") else ""
            if x["type"] == "stop":
                p = spots.get(x["spot"]) or {}
                mark = "◻︎ optional: " if x.get("opt") else "✅ "
                line = f"- {t}{mark}**{name(x['spot'])}**"
                if p.get("district"):
                    line += f" ({p['district']})"
                if x.get("lightText"):
                    line += f" · Licht: {x['lightText']}"
                if x.get("text"):
                    line += f" – {x['text']}"
                L.append(line)
            elif x["type"] == "hotel":
                h = it["hotels"].get(x["name"], {})
                L.append(f"- {t}🏨 {x.get('label') or 'Unterkunft'}: **{h.get('name', x['name'])}**" + ("" if h.get("booked", True) else " _(noch nicht gebucht)_"))
            elif x["type"] == "info":
                L.append(f"- {t}{x.get('icon', 'ℹ️')} {'◻︎ optional: ' if x.get('opt') else ''}**{x.get('title', '')}**" + (f" – {x['text']}" if x.get("text") else ""))
            elif x["type"] == "move":
                bits = [MODE.get(x["mode"], x["mode"])]
                if x.get("min"):
                    bits.append(f"ca. {x['min']} Min.")
                if x.get("km"):
                    bits.append(f"{x['km']} km")
                L.append(f"  - ↓ {' · '.join(bits)}" + (f" ({x['text']})" if x.get("text") else ""))
        L.append("")
    hs = trip.get("hotels") or []
    if hs:
        L += ["## Unterkünfte", ""]
        for h in hs:
            L.append(f"- **{h['name']}** ({h.get('zh', '')}) – {h.get('dates', '')}" + (f" · Zimmer: {h['room']}" if h.get("room") else ""))
            if h.get("address"):
                L.append(f"  - {h['address']} · [Karte](https://www.google.com/maps/search/?api=1&query={h['lat']},{h['lng']})")
        L.append("")
    tt = tours()
    if tt:
        L += ["## Touren in der App", ""] + [f"- **{t['name']}**: " + " → ".join(name(s) for s in t["stops"]) for t in tt] + [""]
    open(OUT, "w", encoding="utf-8").write("\n".join(L) + "\n")
    print(f"✔ REISEPLAN.md ({len(it['days'])} Tage)")


if __name__ == "__main__":
    main()
