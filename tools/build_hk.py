#!/usr/bin/env python3
"""Baut data/places.js aus der kuratierten Hong-Kong-Liste (hk/spots.py).

hk/spots.py enthält die 86 Posts der Sammlung „Hong Kong“ und die daraus
abgeleiteten Spots (Name, Bezirk, Kategorie, Posts, Hinweis). Koordinaten
kommen aus hk/geocache.json (Nominatim, via hk/geocode.py) oder sind in
spots.py fest eingetragen (ungefähre Positionen).

Fotos und Captions der Posts werden über die öffentliche Embed-Seite geladen
und in images/ bzw. data/cache.json gespeichert.

  python3 tools/build_hk.py
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "hk"))

import build_places as bp  # noqa: E402
from spots import POSTS, S  # noqa: E402

geo = json.load(open(os.path.join(ROOT, "hk", "geocache.json"), encoding="utf-8"))
cache = bp.load_json(bp.CACHE_FILE, {"posts": {}, "geo": {}})


def post_info(i):
    user, kind, code = POSTS[i]
    p = cache["posts"].get(code)
    if not p or not p.get("image"):
        try:
            p = bp.fetch_post(code)
            p["image"] = bp.download_image(code, p.pop("image_src"))
            cache["posts"][code] = p
            bp.save_json(bp.CACHE_FILE, cache)
            time.sleep(3)
        except Exception as e:  # noqa: BLE001
            print(f"  {code}: {e}", file=sys.stderr)
            p = {"caption": "", "image": None}
    return {
        "url": f"https://www.instagram.com/{user}/{kind}/{code}/",
        "username": user,
        "profile_url": f"https://www.instagram.com/{user}/",
        "kind": kind,
        "image": p.get("image"),
        "caption": (p.get("caption") or "")[:400],
    }


posts = {}
for n, i in enumerate(sorted(POSTS), 1):
    print(f"[{n}/{len(POSTS)}] {POSTS[i][2]}")
    posts[i] = post_info(i)

places, used = [], set()
for n, s in enumerate(S):
    if isinstance(s["q"], tuple):
        (lat, lng), approx, addr = s["q"], True, s["district"]
    else:
        g = geo[s["q"]]
        lat, lng, approx, addr = g["lat"], g["lon"], False, g.get("name") or s["q"]
    used.update(s["posts"])
    ps = [posts[i] for i in s["posts"]]
    first = next((p for p in ps if p["image"]), ps[0])
    places.append({
        "id": f"hk-{n}",
        "name": s["name"],
        "district": s["district"],
        "category": s["cat"],
        "note": s.get("note", ""),
        "address": addr,
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "approx": approx,
        # Felder des ersten Posts für Marker-Bild & Kompatibilität
        "image": first["image"],
        "caption": first["caption"],
        "post_url": first["url"],
        "username": first["username"],
        "profile_url": first["profile_url"],
        "posts": ps,
    })

unplaced = [posts[i] for i in sorted(POSTS) if i not in used]

with open(bp.OUT_FILE, "w", encoding="utf-8") as f:
    f.write("// Generiert von tools/build_hk.py aus hk/spots.py – nicht von Hand bearbeiten.\n")
    f.write("window.PLACES = ")
    json.dump(places, f, ensure_ascii=False, indent=1)
    f.write(";\nwindow.UNPLACED_POSTS = ")
    json.dump(unplaced, f, ensure_ascii=False, indent=1)
    f.write(";\n")

print(f"✔ {len(places)} Orte, {len(unplaced)} Posts ohne konkreten Ort → data/places.js")
missing = [p["url"] for p in posts.values() if not p["image"]]
if missing:
    print(f"⚠ {len(missing)} Posts ohne Bild (erneut ausführen):", *missing, sep="\n  ")
