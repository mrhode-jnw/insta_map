#!/usr/bin/env python3
"""Lädt pro Claude-Tipp ein Foto (JPEG) aus dem Wikipedia-Artikel → images/claude_<id>.jpg.

Wählt das erste echte Foto des Artikels (keine Logos/Karten/SVGs) und merkt sich die
Commons-Dateiseite für die Quellenangabe in hk/claude_images.json.
"""
import json
import os
import re
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "hk"))
import build_places as bp  # noqa: E402
from claude_spots import CLAUDE_SPOTS  # noqa: E402

UA = "insta-map/1.0 (https://github.com/mrhode-jnw/insta_map; private travel map)"
OUT = os.path.join(ROOT, "hk", "claude_images.json")
SKIP = re.compile(r"(logo|map|locator|flag|icon|svg|seal|emblem|coat_of_arms|diagram|plan\b|route)", re.I)


def get(url, binary=False):
    for attempt in range(6):
        try:
            return bp.http_get(url, ua=UA, binary=binary, retries=1)
        except Exception as e:  # noqa: BLE001
            wait = 8 * (attempt + 1)
            print(f"    {e} – warte {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("zu viele Fehlversuche")


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"[^\x00-\x7f]", "", name.lower())).strip("-")[:48]


data = bp.load_json(OUT, {})
for name, q, district, cat, pop, reason, wiki, note in CLAUDE_SPOTS:
    sid = slug(name)
    if data.get(sid, {}).get("image") and os.path.exists(os.path.join(ROOT, data[sid]["image"])):
        continue
    title = urllib.parse.quote(wiki.replace(" ", "_"), safe="")
    try:
        media = json.loads(get(f"https://en.wikipedia.org/api/rest_v1/page/media-list/{title}"))
    except Exception as e:  # noqa: BLE001
        print("FAIL", name, e); continue
    pick = None
    for it in media.get("items", []):
        t = it.get("title", "")
        if it.get("type") != "image" or not re.search(r"\.jpe?g$", t, re.I) or SKIP.search(t):
            continue
        pick = it; break
    if not pick:
        print("KEIN FOTO", name); continue
    file_title = pick["title"]  # z.B. "File:Star_Ferry.jpg"
    fname = file_title.split(":", 1)[1]
    # Standard-Thumbnail-Größe (Wikimedia liefert nur feste Stufen aus)
    try:
        info = json.loads(get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(dict(
            action="query", titles=file_title, prop="imageinfo", iiprop="url|extmetadata", iiurlwidth=960, format="json"))))
    except Exception as e:  # noqa: BLE001
        print("FAIL", name, e); continue
    page = next(iter(info["query"]["pages"].values()))
    if "imageinfo" not in page:
        print("KEINE INFO", name, file_title); continue
    ii = page["imageinfo"][0]
    meta = ii.get("extmetadata", {})
    artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip()[:80]
    lic = meta.get("LicenseShortName", {}).get("value", "")
    rel = f"images/claude_{sid}.jpg"
    try:
        img = get(ii.get("thumburl") or ii["url"], binary=True)
    except Exception as e:  # noqa: BLE001
        print("FAIL", name, e); continue
    with open(os.path.join(ROOT, rel), "wb") as f:
        f.write(img)
    data[sid] = {"image": rel, "file": fname, "page": ii.get("descriptionurl"),
                 "artist": artist, "license": lic,
                 "wiki_url": f"https://en.wikipedia.org/wiki/{title}"}
    bp.save_json(OUT, data)
    print("OK  ", name, "→", fname, "|", lic, "|", artist[:40])
    time.sleep(10)
