#!/usr/bin/env python3
"""Wetter- und Sichtprognose für die Stopps im Reiseplan → data/forecast.json.

Für jeden Stopp aus data/itinerary.js (fest und optional), dessen Tag heute oder später liegt
(höchstens 16 Tage voraus), holt das Skript von Open-Meteo die Werte zur geplanten Uhrzeit:
Wetter, Wolken (tief/mittel/hoch), Regen, Luftfeuchte, Wind, Sichtweite und – bis 5 Tage voraus –
Luftqualität (US-AQI, PM2,5). Daraus entsteht eine einfache Sicht-Einschätzung (klar … sehr diesig)
und ein Hinweis aufs Licht (Chance auf Farbe bei Sonnenauf-/-untergang).

  python3 tools/build_forecast.py            # schreibt data/forecast.json
  python3 tools/build_forecast.py --print    # zusätzlich Übersicht ausgeben

Die Datei gehört in den Branch map-data (die App liest sie von dort, ohne Neubau der Seite).
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ITIN = os.path.join(ROOT, "data", "itinerary.js")
OUT = os.path.join(ROOT, "data", "forecast.json")
TZ = dt.timezone(dt.timedelta(hours=8))
HOURLY = ("weather_code,temperature_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,"
          "precipitation_probability,precipitation,relative_humidity_2m,wind_speed_10m,visibility")
DEFAULT_H = {"sunrise": 6, "dawn": 6, "golden": 8, "sunset": 17, "blue": 18, "night": 19, "midday": 12, "day": 10, "indoor": 12}


def get(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "insta-map-forecast"})
        return json.load(urllib.request.urlopen(req, timeout=60))
    except Exception:  # z. B. TLS hinter einem Proxy: curl kennt dessen Zertifikate
        return json.loads(subprocess.run(["curl", "-sSf", "--max-time", "90", url], capture_output=True, check=True, text=True).stdout)


def start_hour(it):
    m = re.match(r"\s*(\d{1,2}):(\d{2})", it.get("t") or "")
    if m:
        return int(m.group(1)) + (1 if int(m.group(2)) >= 40 else 0)
    return DEFAULT_H.get(it.get("light"), 10)


def haze(vis_km, pm25, rh):
    s = 0
    if vis_km is not None:
        s += 2 if vis_km < 5 else 1 if vis_km < 10 else 0
    if pm25 is not None:
        s += 2 if pm25 > 35 else 1 if pm25 > 15 else 0
    if rh is not None:
        s += 2 if rh >= 92 else 1 if rh >= 82 else 0
    return s, ("klar" if s == 0 else "leicht diesig" if s <= 2 else "diesig" if s <= 4 else "sehr diesig / Nebel")


def sky(light, low, mid, high, total, rain):
    if rain and rain >= 1:
        return "Regen"
    if light in ("sunrise", "sunset", "dawn", "blue", "golden"):
        if low is not None and low >= 70:
            return "tiefe Wolkendecke – wenig Farbe"
        if (mid or 0) + (high or 0) >= 30 and (low or 0) < 50:
            return "Chance auf Farbe am Himmel"
        if total is not None and total < 15:
            return "klarer Himmel"
    if total is not None:
        return "sonnig" if total < 25 else "teils bewölkt" if total < 70 else "bewölkt"
    return ""


def main():
    s = open(ITIN, encoding="utf-8").read()
    data = json.loads(s[s.index("=") + 1:].strip().rstrip(";"))
    today = dt.datetime.now(TZ).date()
    last = today + dt.timedelta(days=15)
    stops = []  # (date, hour, light, spot, lat, lng)
    for day in data["days"]:
        d = dt.date.fromisoformat(day["date"])
        if not today <= d <= last:
            continue
        for it in day["items"]:
            if it["type"] == "stop" and "lat" in it:
                stops.append((day["date"], start_hour(it), it.get("light", ""), it["spot"], it["lat"], it["lng"]))
    out = {"updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "Open-Meteo", "stops": {}}
    if not stops:
        json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
        print("Keine kommenden Stopps im Reiseplan.")
        return
    # gleiche Gegend (≈ 5 km) nur einmal abfragen
    locs = {}
    for st in stops:
        locs.setdefault((round(st[4] / .05) * .05, round(st[5] / .05) * .05), None)
    keys = list(locs)
    lat = ",".join(f"{k[0]:.2f}" for k in keys)
    lng = ",".join(f"{k[1]:.2f}" for k in keys)
    days = (max(dt.date.fromisoformat(x[0]) for x in stops) - today).days + 1
    wx = get(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&hourly={HOURLY}"
             f"&timezone=Asia%2FShanghai&forecast_days={min(16, days + 1)}")
    aq = get(f"https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lng}"
             f"&hourly=us_aqi,pm2_5&timezone=Asia%2FShanghai&forecast_days=5")
    if isinstance(wx, dict):
        wx = [wx]
    if isinstance(aq, dict):
        aq = [aq]
    for k, w, a in zip(keys, wx, aq):
        locs[k] = (w["hourly"], a["hourly"])
    for date, h, light, spot, la, ln in stops:
        w, a = locs[(round(la / .05) * .05, round(ln / .05) * .05)]
        t = f"{date}T{h:02d}:00"
        if t not in w["time"]:
            continue
        i = w["time"].index(t)
        val = lambda name, src=w: (src[name][src["time"].index(t)] if t in src["time"] else None)
        vis = w["visibility"][i]
        vis_km = round(vis / 1000, 1) if vis is not None else None
        pm = val("pm2_5", a)
        aqi = val("us_aqi", a)
        score, htxt = haze(vis_km, pm, w["relative_humidity_2m"][i])
        rain = w["precipitation"][i]
        if date in out["stops"].get(spot, {}):  # zweimal am selben Tag: der erste Besuch zählt
            continue
        out["stops"].setdefault(spot, {})[date] = {
            "h": h, "code": w["weather_code"][i], "temp": round(w["temperature_2m"][i]),
            "cloud": w["cloud_cover"][i], "low": w["cloud_cover_low"][i], "mid": w["cloud_cover_mid"][i], "high": w["cloud_cover_high"][i],
            "pp": w["precipitation_probability"][i], "rain": rain, "rh": w["relative_humidity_2m"][i],
            "wind": round(w["wind_speed_10m"][i]), "vis": vis_km,
            "aqi": round(aqi) if aqi is not None else None, "pm25": round(pm) if pm is not None else None,
            "haze": score, "hazeText": htxt,
            "sky": sky(light, w["cloud_cover_low"][i], w["cloud_cover_mid"][i], w["cloud_cover_high"][i], w["cloud_cover"][i], rain),
        }
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    n = sum(len(v) for v in out["stops"].values())
    print(f"✔ Prognose für {n} Stopps ({len(out['stops'])} Spots, {len(keys)} Orte) → data/forecast.json")
    if "--print" in sys.argv:
        for date, h, light, spot, *_ in sorted(stops):
            f = out["stops"].get(spot, {}).get(date)
            if f:
                print(f"{date} {h:02d}h {spot[:40]:40} {f['temp']}°C Wolken {f['cloud']}% Regen {f['pp']}% "
                      f"Sicht {f['vis']} km AQI {f['aqi']} → {f['hazeText']}; {f['sky']}")


if __name__ == "__main__":
    main()
