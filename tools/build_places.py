#!/usr/bin/env python3
"""Baut data/places.js aus gespeicherten Instagram-Posts.

Eingabe (eins von beidem):
  * eine Textdatei mit Post-Links (eine URL pro Zeile), z.B. posts.txt
  * saved_collections.json aus dem Instagram-Datenexport
    (optional gefiltert mit --collection "Hong Kong")

Für jeden Post wird die öffentliche Embed-Seite geladen (Foto, Username,
Caption). Aus der Caption werden Orte extrahiert (📍-Zeilen, "Address:" ...)
und geocodiert. Manuelle Korrekturen kommen aus data/overrides.json.

Nur Standardbibliothek, keine Installation nötig:
  python3 tools/build_places.py posts.txt
  python3 tools/build_places.py saved_collections.json --collection "Hong Kong"
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
IMAGES = os.path.join(ROOT, "images")
CACHE_FILE = os.path.join(DATA, "cache.json")
OVERRIDES_FILE = os.path.join(DATA, "overrides.json")
OUT_FILE = os.path.join(DATA, "places.js")

UA_BROWSER = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
              "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
UA_TOOL = "insta-map/1.0 (personal travel map)"

POST_RE = re.compile(r"instagram\.com/(?:[A-Za-z0-9_.]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)")

# Zeilen, die typischerweise einen Ort beschreiben
PIN_RE = re.compile(r"^\s*(?:📍|📌|🏠|🗺️?|📫)\s*[:：-]?\s*(.+)$")
LABEL_RE = re.compile(
    r"^\s*(?:address|location|adresse|ort|where|地址|位置|addr\.?)\s*[:：-]\s*(.+)$", re.I)


# ---------------------------------------------------------------- helpers

def http_get(url, ua=UA_TOOL, binary=False, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Language": "en,de;q=0.8"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
                return body if binary else body.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < retries - 1:
                wait = 10 * (attempt + 1)
                print(f"    HTTP {e.code}, warte {wait}s …", file=sys.stderr)
                time.sleep(wait)
                continue
            raise
    return None


def load_json(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- input

def read_shortcodes(path, collection=None):
    text = open(path, encoding="utf-8").read()
    if path.endswith(".json"):
        return shortcodes_from_export(json.loads(text), collection)
    seen, out = set(), []
    for m in POST_RE.finditer(text):
        if m.group(1) not in seen:
            seen.add(m.group(1))
            out.append(m.group(1))
    return out


def shortcodes_from_export(data, collection):
    """saved_collections.json: Sammlungs-Kopfzeilen gefolgt von ihren Posts."""
    entries = data.get("saved_saved_collections", data) if isinstance(data, dict) else data
    current, out, seen = None, [], set()
    for e in entries:
        smd = e.get("string_map_data", {}) if isinstance(e, dict) else {}
        if e.get("title") == "Collection" or ("Creation Time" in smd and "Update Time" in smd):
            current = (smd.get("Name") or {}).get("value")
            continue
        if collection and (current or "").strip().lower() != collection.strip().lower():
            continue
        for m in POST_RE.finditer(json.dumps(e)):
            if m.group(1) not in seen:
                seen.add(m.group(1))
                out.append(m.group(1))
    return out


# ---------------------------------------------------------------- instagram

def fetch_post(code):
    url = f"https://www.instagram.com/p/{code}/embed/captioned/"
    page = http_get(url, ua=UA_BROWSER)
    post = {"shortcode": code, "post_url": f"https://www.instagram.com/p/{code}/"}

    m = re.search(r'class="UsernameText">([^<]+)<', page) or \
        re.search(r'class="CaptionUsername"[^>]*>([^<]+)<', page)
    post["username"] = html.unescape(m.group(1)).strip() if m else None

    img = None
    m = re.search(r'class="EmbeddedMediaImage"[^>]*srcset="([^"]+)"', page)
    if m:
        # mittlere Größe (~480px) reicht fürs Popup
        cands = [c.strip().rsplit(" ", 1) for c in html.unescape(m.group(1)).split(",") if c.strip()]
        cands = [(u, int(w.rstrip("w"))) for u, w in cands if w.rstrip("w").isdigit()]
        if cands:
            img = min(cands, key=lambda c: abs(c[1] - 480))[0]
    if not img:
        m = re.search(r'class="EmbeddedMediaImage"[^>]*src="([^"]+)"', page)
        img = html.unescape(m.group(1)) if m else None
    post["image_src"] = img

    m = re.search(r'class="Caption">(.*?)<div class="CaptionComments"', page, re.S)
    cap = m.group(1) if m else ""
    cap = re.sub(r'^\s*<a class="CaptionUsername".*?</a>', "", cap, flags=re.S)
    cap = re.sub(r"<br\s*/?>", "\n", cap)
    cap = re.sub(r"<[^>]+>", "", cap)
    post["caption"] = html.unescape(cap).strip()
    return post


def download_image(code, src):
    if not src:
        return None
    os.makedirs(IMAGES, exist_ok=True)
    rel = f"images/{code}.jpg"
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        with open(path, "wb") as f:
            f.write(http_get(src, ua=UA_BROWSER, binary=True))
    return rel


# ---------------------------------------------------------------- caption → orte

def clean(s):
    s = re.sub(r"#\S+", "", s)                       # hashtags
    s = re.sub(r"@([A-Za-z0-9_.]+)", r"\1", s)       # @handles → Name
    s = re.sub(r"[\U0001F000-\U0001FFFF☀-➿️]", " ", s)  # emojis
    return re.sub(r"\s+", " ", s).strip(" ,.-|•")


def extract_places(caption):
    """Liefert [{name, address}] – eine Zeile pro 📍/Address-Eintrag."""
    lines = caption.splitlines()
    out = []
    for i, line in enumerate(lines):
        m = PIN_RE.match(line) or LABEL_RE.match(line)
        if not m:
            continue
        text = clean(m.group(1))
        if not text:
            continue
        name, address = text, text
        # "Name - Adresse" / "Name | Adresse" / "Name (Adresse)"
        parts = re.split(r"\s+[-–|]\s+|\s*\(\s*", text, maxsplit=1)
        if len(parts) == 2 and len(parts[1]) > 5:
            name, address = parts[0], parts[1].rstrip(")")
        elif "," in text:
            name = text.split(",")[0]
        # Adresse in der Folgezeile ("📍 Name" \n "12 Some Street")
        if address == name and i + 1 < len(lines):
            nxt = clean(lines[i + 1])
            if re.search(r"\d", nxt) and not PIN_RE.match(lines[i + 1]):
                address = f"{name}, {nxt}"
        out.append({"name": name[:80], "address": address})
    return out


# ---------------------------------------------------------------- geocoding

def geocode(query, region, cache):
    key = f"{region}|{query}"
    if key in cache:
        return cache[key]
    full = f"{query}, {region}" if region and region.lower() not in query.lower() else query
    res = None
    gkey = os.environ.get("GOOGLE_MAPS_API_KEY")
    try:
        if gkey:
            u = "https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode(
                {"address": full, "key": gkey})
            d = json.loads(http_get(u))
            if d.get("results"):
                r = d["results"][0]
                res = {"lat": r["geometry"]["location"]["lat"], "lng": r["geometry"]["location"]["lng"],
                       "formatted": r["formatted_address"], "via": "google"}
        if not res:
            u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
                {"q": full, "format": "json", "limit": 1, "addressdetails": 0})
            try:
                d = json.loads(http_get(u))
                time.sleep(1.1)  # Nominatim: max 1 Anfrage/Sekunde
                if d:
                    res = {"lat": float(d[0]["lat"]), "lng": float(d[0]["lon"]),
                           "formatted": d[0]["display_name"], "via": "nominatim"}
            except urllib.error.HTTPError:
                pass
        if not res:
            u = "https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": full, "limit": 1})
            d = json.loads(http_get(u))
            if d.get("features"):
                f = d["features"][0]
                p = f["properties"]
                parts = [p.get("name"), " ".join(x for x in [p.get("housenumber"), p.get("street")] if x),
                         p.get("district") or p.get("city"), p.get("state"), p.get("country")]
                res = {"lat": f["geometry"]["coordinates"][1], "lng": f["geometry"]["coordinates"][0],
                       "formatted": ", ".join(x for x in parts if x), "via": "photon"}
    except Exception as e:  # noqa: BLE001 – Netzwerkfehler sollen den Lauf nicht abbrechen
        print(f"    Geocoding-Fehler für {query!r}: {e}", file=sys.stderr)
        return None
    cache[key] = res
    return res


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="posts.txt (Links) oder saved_collections.json (Instagram-Export)")
    ap.add_argument("--collection", help="Nur diese Sammlung aus dem Export, z.B. 'Hong Kong'")
    ap.add_argument("--region", default="Hong Kong", help="Wird an Adressen angehängt (Standard: Hong Kong)")
    ap.add_argument("--delay", type=float, default=3.0, help="Pause zwischen Instagram-Abrufen (Sekunden)")
    args = ap.parse_args()

    os.makedirs(DATA, exist_ok=True)
    cache = load_json(CACHE_FILE, {"posts": {}, "geo": {}})
    overrides = load_json(OVERRIDES_FILE, {})

    codes = read_shortcodes(args.input, args.collection)
    print(f"{len(codes)} Posts gefunden")
    places, unresolved = [], []

    for n, code in enumerate(codes, 1):
        print(f"[{n}/{len(codes)}] {code}")
        post = cache["posts"].get(code)
        if not post:
            try:
                post = fetch_post(code)
                post["image"] = download_image(code, post.pop("image_src"))
                cache["posts"][code] = post
                save_json(CACHE_FILE, cache)
                time.sleep(args.delay)
            except Exception as e:  # noqa: BLE001
                print(f"    konnte Post nicht laden: {e}", file=sys.stderr)
                unresolved.append({"shortcode": code, "reason": f"Post nicht ladbar: {e}"})
                continue

        found = overrides.get(code) or extract_places(post.get("caption", ""))
        if not found:
            unresolved.append({"shortcode": code, "reason": "kein Ort in der Caption",
                               "caption": post.get("caption", "")[:200]})
            continue

        for i, pl in enumerate(found):
            lat, lng, formatted, via = pl.get("lat"), pl.get("lng"), pl.get("address"), "manual"
            if lat is None or lng is None:
                name, addr = pl.get("name") or "", pl.get("address") or ""
                # genaueste Variante zuerst: "Name, Adresse" → Adresse → Name
                queries = [f"{name}, {addr}" if name and name.lower() not in addr.lower() else addr, addr, name]
                g = None
                for q in dict.fromkeys(x for x in queries if x):
                    g = geocode(q, args.region, cache["geo"])
                    if g:
                        break
                save_json(CACHE_FILE, cache)
                if not g:
                    unresolved.append({"shortcode": code, "reason": "nicht geocodierbar", "query": pl})
                    continue
                lat, lng, formatted, via = g["lat"], g["lng"], g["formatted"], g["via"]
            user = post.get("username")
            places.append({
                "id": f"{code}-{i}",
                "name": pl.get("name") or pl.get("address"),
                "address": formatted,
                "lat": round(float(lat), 6),
                "lng": round(float(lng), 6),
                "geocoder": via,
                "image": post.get("image"),
                "caption": post.get("caption", "")[:600],
                "post_url": post["post_url"],
                "username": user,
                "profile_url": f"https://www.instagram.com/{user}/" if user else None,
            })

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        f.write("// Generiert von tools/build_places.py – nicht von Hand bearbeiten,\n")
        f.write("// Korrekturen gehören in data/overrides.json.\n")
        f.write("window.PLACES = ")
        json.dump(places, f, ensure_ascii=False, indent=1)
        f.write(";\n")
    save_json(os.path.join(DATA, "unresolved.json"), unresolved)

    print(f"\n✔ {len(places)} Orte → data/places.js")
    if unresolved:
        print(f"⚠ {len(unresolved)} Einträge ohne Koordinaten → data/unresolved.json "
              f"(per data/overrides.json nachtragen)")


if __name__ == "__main__":
    main()
