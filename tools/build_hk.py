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
import re
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "hk"))

import build_places as bp  # noqa: E402
import slides as sl  # noqa: E402
from spots import POSTS, S  # noqa: E402

POP_FILE = os.path.join(ROOT, "hk", "popularity.json")  # Beliebtheit 1–5 aus Web-Recherche
popularity = json.load(open(POP_FILE, encoding="utf-8")) if os.path.exists(POP_FILE) else {}
geo = json.load(open(os.path.join(ROOT, "hk", "geocache.json"), encoding="utf-8"))
cache = bp.load_json(bp.CACHE_FILE, {"posts": {}, "geo": {}})
ctx = cache.get("ctx", {})  # von tools/fetch_slides.py


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
        "caption": ((ctx.get(code) or {}).get("caption") or p.get("caption") or "")[:600],
    }


posts = {}
for n, i in enumerate(sorted(POSTS), 1):
    print(f"[{n}/{len(POSTS)}] {POSTS[i][2]}")
    posts[i] = post_info(i)

usage = {}
for s in S:
    for i in s["posts"]:
        usage[i] = usage.get(i, 0) + 1


def spot_post(spot, i):
    """Post-Eintrag für einen Spot – mit dem Slide, der genau diesen Ort zeigt."""
    p = dict(posts[i])
    code = POSTS[i][2]
    c = ctx.get(code)
    p["match"] = "single" if usage[i] == 1 else "cover"
    fixed = spot.get("slides", {}).get(i)
    rel = f"images/{code}_{fixed}.jpg" if fixed else None
    if rel and os.path.exists(os.path.join(ROOT, rel)):  # Slide schon geladen (z.B. von der Routine) – ohne Karussell-Daten nutzbar
        p["image"], p["match"], p["slide"] = rel, "slide", fixed
        p["url"] = p["url"] + f"?img_index={fixed}"
    elif c and len(c["slides"]) > 1:
        m = (fixed - 1,) if fixed else sl.match_slide(spot, sl.list_entries(c["caption"]))
        if m and m[0] < len(c["slides"]):
            try:
                p["image"] = sl.download_slide(code, m[0], c["slides"][m[0]])
                p["match"], p["slide"] = "slide", m[0] + 1
                p["url"] = p["url"] + f"?img_index={m[0] + 1}"
            except Exception as e:  # noqa: BLE001
                print(f"  Slide {code}#{m[0] + 1}: {e}", file=sys.stderr)
    if p["match"] == "cover":
        # Sammel-Post ohne passendes Einzelbild: Titelbild zeigt meist einen anderen Ort → nicht als Foto des Spots verwenden
        p["image"], p["generic"] = None, True
    return p


def spot_id(name):
    """Stabile ID aus dem Namen (Status in data/my-status.json hängt daran)."""
    slug = re.sub(r"[^a-z0-9]+", "-", re.sub(r"[^\x00-\x7f]", "", name.lower())).strip("-")
    return "hk-" + slug[:48]


def dhash(rel, n=8):
    """Wahrnehmungs-Hash: gleiche Fotos (auch mit Schrift-Overlay/leichtem Zuschnitt) liegen nah beieinander."""
    from PIL import Image
    im = Image.open(os.path.join(ROOT, rel)).convert("L").resize((n + 1, n), Image.LANCZOS)
    px = im.load()
    return sum(1 << (r * n + c) for r in range(n) for c in range(n) if px[c, r] > px[c + 1, r])


def dedupe(ps):
    """Gleiches Foto aus mehreren Posts nur einmal zeigen – bevorzugt ein Karussell-Bild ohne Titel-Overlay."""
    rank = lambda p: 0 if p["match"] == "slide" and p.get("slide", 1) > 1 else 1 if p["match"] == "slide" else 2
    kept = []
    for p in sorted([p for p in ps if p["image"]], key=rank):
        h = dhash(p["image"])
        if any(bin(h ^ k).count("1") <= 16 for k in kept):
            p["image"], p["generic"], p["dup"] = None, True, True
        else:
            kept.append(h)
    return ps


places, used = [], set()
for n, s in enumerate(S):
    if isinstance(s["q"], tuple):
        # (lat, lon) = von Hand gesetzt (ungefähr), (lat, lon, "OSM") = exakt aus OpenStreetMap
        lat, lng = s["q"][:2]
        approx, addr = len(s["q"]) < 3, s["district"]
    else:
        g = geo[s["q"]]
        lat, lng, approx, addr = g["lat"], g["lon"], False, g.get("name") or s["q"]
    used.update(s["posts"])
    ps = dedupe([spot_post(s, i) for i in s["posts"]])
    # Markerbild: zum Spot passendes Slide > Post nur dieses Spots > Titelbild
    first = (next((p for p in ps if p["image"] and p["match"] == "slide"), None)
             or next((p for p in ps if p["image"]), None)
             or ps[0])
    places.append({
        "id": spot_id(s["name"]),
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
    pop = popularity.get(places[-1]["id"])
    if pop:
        places[-1]["pop"] = pop["score"]
        places[-1]["pop_reason"] = pop.get("reason", "")

PHOTO_OVERRIDES = bp.load_json(os.path.join(ROOT, "hk", "photo_overrides.json"), {})

# Claude-Tipps: ergänzende Top-Spots, nicht aus der Sammlung (Bild lädt die Karte von Wikipedia)
from claude_spots import CLAUDE_SPOTS  # noqa: E402
cgeo = json.load(open(os.path.join(ROOT, "hk", "claude_geo.json"), encoding="utf-8"))
cimg = bp.load_json(os.path.join(ROOT, "hk", "claude_images.json"), {})  # von tools/fetch_claude_images.py
for name, q, district, cat, pop, reason, wiki, note in CLAUDE_SPOTS:
    g = cgeo.get(q)
    if not g:
        print("  Claude-Tipp ohne Koordinaten:", name, file=sys.stderr)
        continue
    places.append({
        "id": "claude-" + spot_id(name)[3:],
        "name": name, "district": district, "category": cat, "note": note,
        "address": g["name"], "lat": round(g["lat"], 6), "lng": round(g["lon"], 6), "approx": False,
        "image": None, "caption": "", "post_url": "", "username": "", "profile_url": "", "posts": [],
        "by_claude": True, "wiki": wiki, "pop": pop, "pop_reason": reason,
    })
    ci = cimg.get(spot_id(name)[3:])
    if ci and os.path.exists(os.path.join(ROOT, ci["image"])):
        credit = "Foto: " + " · ".join(x for x in [ci.get("artist"), ci.get("license"), "Wikimedia Commons"] if x)
        places[-1].update(image=ci["image"], image_page=ci.get("page"), image_credit=credit[6:], wiki_url=ci.get("wiki_url"))

# Weitere Spots aus Artikeln (z.B. Time Out Neon-Guide), Foto mit Quellenangabe
for e in bp.load_json(os.path.join(ROOT, "hk", "extra_spots.json"), []):
    src = e.get("source", "Time Out Hong Kong, Mai 2024")
    places.append({
        "id": spot_id(e["name"]), "name": e["name"], "district": e["district"], "category": e["cat"],
        "note": e.get("note", ""), "tip": e.get("tip", ""), "address": e["district"], "lat": e["lat"], "lng": e["lng"],
        "approx": e.get("approx", False), "image": e.get("image"), "caption": "", "post_url": "", "username": "",
        "profile_url": "", "posts": [], "pop": e.get("pop"), "pop_reason": e.get("reason", ""),
        "image_page": e.get("url", "https://www.timeout.com/hong-kong/things-to-do/hong-kong-neon-signs"),
        "image_credit": src, "source": src,
    })

# Spots ohne eigenes Foto: Ersatzfoto von Wikimedia Commons (hk/photo_overrides.json, Name → Bild + Quelle)
for p in places:
    o = PHOTO_OVERRIDES.get(p["name"])
    if o and not p["image"] and os.path.exists(os.path.join(ROOT, o["image"])):
        p.update(image=o["image"], image_page=o["page"], image_credit=o["credit"])

unplaced = [posts[i] for i in sorted(POSTS) if i not in used]

with open(bp.OUT_FILE, "w", encoding="utf-8") as f:
    f.write("// Generiert von tools/build_hk.py aus hk/spots.py – nicht von Hand bearbeiten.\n")
    f.write("window.PLACES = ")
    json.dump(places, f, ensure_ascii=False, indent=1)
    f.write(";\nwindow.UNPLACED_POSTS = ")
    json.dump(unplaced, f, ensure_ascii=False, indent=1)
    f.write(";\n")

print(f"✔ {len(places)} Orte (inkl. Claude-Tipps), {len(unplaced)} Posts ohne konkreten Ort → data/places.js")
from collections import Counter  # noqa: E402
dup = Counter(p["image"] for p in places if p["image"])
shared = sum(n for n in dup.values() if n > 1)
print(f"Markerbilder: {len(dup)} verschiedene, {shared} Spots teilen sich ein Bild mit anderen")
nophoto = [p["name"] for p in places if not p["image"] and not p.get("by_claude")]
print(f"Spots ohne eigenes Foto (nur Sammel-Post): {len(nophoto)}")
missing = [p["url"] for p in posts.values() if not p["image"]]
if missing:
    print(f"⚠ {len(missing)} Posts ohne Bild (erneut ausführen):", *missing, sep="\n  ")
