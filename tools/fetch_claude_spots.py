#!/usr/bin/env python3
"""Geocodiert die Claude-Tipps aus hk/claude_spots.py → hk/claude_geo.json (Nominatim, Fallback Photon)."""
import json
import os
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "hk"))
import build_places as bp  # noqa: E402
from claude_spots import CLAUDE_SPOTS  # noqa: E402

OUT = os.path.join(ROOT, "hk", "claude_geo.json")
BBOX = (113.82, 22.15, 114.45, 22.57)
geo = bp.load_json(OUT, {})
for name, q, *_ in CLAUDE_SPOTS:
    if geo.get(q):
        continue
    res = None
    u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(dict(
        q=q, format="json", limit=1, viewbox=f"{BBOX[0]},{BBOX[3]},{BBOX[2]},{BBOX[1]}", bounded=1))
    try:
        r = json.loads(bp.http_get(u, ua="hk-photospots-personal/1.0"))
        if r:
            res = dict(lat=float(r[0]["lat"]), lon=float(r[0]["lon"]), name=r[0]["display_name"], via="nominatim")
    except Exception as e:  # noqa: BLE001
        print("  nominatim:", e, file=sys.stderr)
    time.sleep(1.2)
    if not res:
        u = "https://photon.komoot.io/api/?" + urllib.parse.urlencode(dict(q=q + ", Hong Kong", limit=1, lat=22.3, lon=114.17))
        try:
            f = json.loads(bp.http_get(u))["features"]
            if f:
                lon, lat = f[0]["geometry"]["coordinates"]
                if BBOX[1] <= lat <= BBOX[3] and BBOX[0] <= lon <= BBOX[2]:
                    p = f[0]["properties"]
                    res = dict(lat=lat, lon=lon, name=", ".join(x for x in [p.get("name"), p.get("street"), p.get("district")] if x), via="photon")
        except Exception as e:  # noqa: BLE001
            print("  photon:", e, file=sys.stderr)
    geo[q] = res
    print(("OK  " if res else "FAIL"), name, "→", res and (round(res["lat"], 5), round(res["lon"], 5), res["name"][:60]))
    bp.save_json(OUT, geo)
