#!/usr/bin/env python3
"""Baut data/china.js aus der kuratierten China-Liste (cn/spots_cn.py).

Titelbilder und Karussell-Daten kommen aus data/cache.json (wie bei build_hk.py);
fehlende werden über die öffentliche Embed-Seite nachgeladen.

  python3 tools/build_cn.py
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "cn"))

import build_places as bp  # noqa: E402
import slides as sl  # noqa: E402
from spots_cn import POP, POSTS, SPOTS, UNPLACED_REGION  # noqa: E402

OUT = os.path.join(ROOT, "data", "china.js")
cache = bp.load_json(bp.CACHE_FILE, {"posts": {}, "geo": {}})
ctx = cache.setdefault("ctx", {})


def post_info(n):
    user, kind, code = POSTS[n]
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


posts = {n: post_info(n) for n in sorted(POSTS)}
usage = {}
for s in SPOTS:
    for x in s[6]:
        n = x if isinstance(x, int) else x[0]
        usage[n] = usage.get(n, 0) + 1


def spot_post(x):
    """Post-Eintrag für einen Spot; bei Sammel-Posts nur mit festgelegtem Slide ein Foto."""
    n, slide = (x, None) if isinstance(x, int) else x
    p = dict(posts[n])
    code = POSTS[n][2]
    p["match"] = "single" if usage[n] == 1 else "cover"
    rel = f"images/{code}_{slide}.jpg" if slide else None
    if slide and not os.path.exists(os.path.join(ROOT, rel)):  # Slide noch nicht geladen → Karussell holen
        c = ctx.get(code) or sl.fetch_context(code)
        if c:
            ctx[code] = c
            bp.save_json(bp.CACHE_FILE, cache)
            if slide <= len(c["slides"]):
                sl.download_slide(code, slide - 1, c["slides"][slide - 1])
    if slide and os.path.exists(os.path.join(ROOT, rel)):
        # korrigierte Fassung (z. B. gedreht) unter neuem Namen – neuer Name, damit Caches sie sicher neu laden
        fixed = rel[:-4] + "_r.jpg"
        p["image"] = fixed if os.path.exists(os.path.join(ROOT, fixed)) else rel
        p["match"], p["slide"] = "slide", slide
        p["url"] += f"?img_index={slide}"
    if p["match"] == "cover":
        p["image"], p["generic"] = None, True
    return p


def dhash(rel, n=8):
    from PIL import Image
    im = Image.open(os.path.join(ROOT, rel)).convert("L").resize((n + 1, n), Image.LANCZOS)
    px = im.load()
    return sum(1 << (r * n + c) for r in range(n) for c in range(n) if px[c, r] > px[c + 1, r])


def dedupe(ps):
    kept = []
    for p in ps:
        if not p["image"]:
            continue
        h = dhash(p["image"])
        if any(bin(h ^ k).count("1") <= 16 for k in kept):
            p["image"], p["generic"], p["dup"] = None, True, True
        else:
            kept.append(h)
    return ps


def spot_id(name):
    slug = re.sub(r"[^a-z0-9]+", "-", re.sub(r"[^\x00-\x7f]", "", name.lower())).strip("-")
    return "cn-" + slug[:48]


places = []
for name, lat, lng, approx, region, cat, plist, note in SPOTS:
    ps = dedupe([spot_post(x) for x in plist])
    first = next((p for p in ps if p["image"]), ps[0] if ps else  # Spot nur mit Fotos aus cn/extra_photos.json
                 {"image": None, "caption": "", "url": "", "username": "", "profile_url": ""})
    pop = next((v for k, v in POP.items() if k in name), None)
    places.append({
        "id": spot_id(name), "region": "cn",
        "name": name, "district": region, "category": cat, "note": note,
        "address": region, "lat": lat, "lng": lng, "approx": approx,
        "image": first["image"], "caption": first["caption"], "post_url": first["url"],
        "username": first["username"], "profile_url": first["profile_url"], "posts": ps,
        **({"pop": pop[0], "pop_reason": pop[1]} if pop else {}),
    })

# Claude-Tipps entlang der Route (Web-Recherche): cn/claude_spots_cn.json, Bild optional unter images/
for c in bp.load_json(os.path.join(ROOT, "cn", "claude_spots_cn.json"), []):
    places.append({
        # plan: Ort steht im offiziellen Reiseplan → normaler Spot, kein Tipp (ID bleibt für Status/Touren)
        "id": "claude-cn-" + spot_id(c["name"])[3:], "region": "cn", "by_claude": not c.get("plan"),
        "name": c["name"], "district": c["district"], "category": c.get("cat", ""), "note": "",
        "tip": c.get("tip", ""), "address": c["district"], "lat": c["lat"], "lng": c["lng"],
        "approx": c.get("approx", False), "image": c.get("image"), "caption": "", "post_url": "",
        "username": "", "profile_url": "", "posts": [], "pop": c.get("pop"), "pop_reason": c.get("reason", ""),
        **({"image_page": c["image_page"], "image_credit": c["image_credit"]} if c.get("image_page") else {}),
        **({"kind": c["kind"]} if c.get("kind") else {}),  # Claude-Tipps sind sonst „Erlebnis“; "both"/"photo" zeigt sie unter Fotos
    })

# Spots aus beliebigen Links (Inbox, z.B. trip.com): cn/extra_spots.json
for e in bp.load_json(os.path.join(ROOT, "cn", "extra_spots.json"), []):
    places.append({
        "id": spot_id(e["name"]), "region": "cn", "name": e["name"], "district": e["district"],
        "category": e.get("cat", ""), "note": e.get("note", ""), "address": e["district"], "lat": e["lat"], "lng": e["lng"],
        "approx": e.get("approx", False), "image": None, "caption": "", "post_url": "", "username": "",
        "profile_url": "", "posts": [], "source": e.get("source", ""),
        **({"ok": e["ok"]} if e.get("ok") else {}), **({"unsure": e["unsure"]} if e.get("unsure") else {}), **({"kind": e["kind"]} if e.get("kind") else {}),
    })

# Zusätzliche Fotos aus Links (cn/extra_photos.json, Name → [{image, url, credit}]) – erscheinen in der Galerie
for p in places:
    extra = [x for x in bp.load_json(os.path.join(ROOT, "cn", "extra_photos.json"), {}).get(p["name"], [])
             if os.path.exists(os.path.join(ROOT, x["image"]))]
    if not extra:
        continue
    p["posts"] = [q for q in p["posts"] if q.get("image")] + [
        {"url": x["url"], "username": "", "profile_url": x["url"], "kind": "photo", "image": x["image"],
         "caption": x.get("caption", ""), "credit": x["credit"]} for x in extra]
    if not p["image"]:
        p.update(image=extra[0]["image"], image_page=extra[0]["url"], image_credit=extra[0]["credit"])
    # Claude-Tipp mit Fotos aus eigenen Instagram-Posts (Eingang) → normaler Foto-Spot (ID bleibt für Status/Touren)
    if p.get("by_claude") and any("instagram.com" in x["url"] for x in extra):
        p["by_claude"] = False

# Zugang für Autorouten (cn/access.json): Eingang/Parkplatz, wenn der Spot selbst nicht per Auto erreichbar ist
_access = bp.load_json(os.path.join(ROOT, "cn", "access.json"), {})
for p in places:
    if p["id"] in _access:
        p["access"] = _access[p["id"]]

# Tag/Nacht für den Filter (Korrekturen in hk/daynight.json)
import daynight  # noqa: E402
daynight.tag_all(places)

used = {x if isinstance(x, int) else x[0] for s in SPOTS for x in s[6]}
# Posts, deren Foto über cn/extra_photos.json an einem Spot hängt, gelten auch als verortet
_ep_urls = " ".join(x["url"] for l in bp.load_json(os.path.join(ROOT, "cn", "extra_photos.json"), {}).values() for x in l)
used |= {n for n in POSTS if POSTS[n][2] in _ep_urls}
unplaced = [dict(posts[n], region=UNPLACED_REGION.get(n, "cn"), sub="hk" if UNPLACED_REGION.get(n) == "hk" else "cnx")
            for n in sorted(POSTS) if n not in used]

with open(OUT, "w", encoding="utf-8") as f:
    f.write("// Generiert von tools/build_cn.py aus cn/spots_cn.py – nicht von Hand bearbeiten.\n")
    f.write("window.PLACES_CN = ")
    json.dump(places, f, ensure_ascii=False, indent=1)
    f.write(";\nwindow.UNPLACED_CN = ")
    json.dump(unplaced, f, ensure_ascii=False, indent=1)
    f.write(";\n")

print(f"✔ {len(places)} China-Spots, {len(unplaced)} Posts ohne Ort → data/china.js")
print("Ohne eigenes Foto:", [p["name"] for p in places if not p["image"]])

import build_added  # noqa: E402
build_added.main()  # Hinzugefügt-Datum je Spot für „Neu hinzugefügt“
