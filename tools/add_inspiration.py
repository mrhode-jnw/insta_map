#!/usr/bin/env python3
"""Instagram-Post (alle Karussell-Bilder) zur Inspiration-Sektion hinzufügen – unabhängig von Spots/Orten.

  python3 tools/add_inspiration.py <Instagram-Link oder Code> [hk|cn]

Bilder → images/insp/<code>_<n>.jpg, Liste → data/inspiration.json, für die App → data/inspiration.js
"""
import io
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import slides as sl  # noqa: E402

SRC = os.path.join(ROOT, "data", "inspiration.json")
OUT = os.path.join(ROOT, "data", "inspiration.js")
IMG = os.path.join(ROOT, "images", "insp")


def code_of(s):
    m = re.search(r"instagram\.com/(?:[^/]+/)?(?:p|reel)/([A-Za-z0-9_-]+)", s)
    return m.group(1) if m else s.strip()


def write_js(data):
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Generiert von tools/add_inspiration.py – nicht von Hand bearbeiten.\nwindow.INSPIRATION = ")
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write(";\n")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    code, region = code_of(sys.argv[1]), (sys.argv[2] if len(sys.argv) > 2 else "hk")
    data = json.load(open(SRC, encoding="utf-8")) if os.path.exists(SRC) else {"hk": [], "cn": []}
    lst = data.setdefault(region, [])
    old = next((x for x in lst if x["code"] == code), None)
    if old and old.get("user"):
        print("schon vorhanden:", code)
        write_js(data)
        return
    if old:
        lst.remove(old)
    ctx = sl.fetch_context(code)
    if not ctx or not ctx.get("slides"):
        sys.exit("Post nicht abrufbar: " + code)
    import build_places as bp
    cache = bp.load_json(bp.CACHE_FILE, {"posts": {}})
    try:
        user = (cache.get("posts", {}).get(code) or bp.fetch_post(code)).get("username") or ""
    except Exception:
        user = ""
    os.makedirs(IMG, exist_ok=True)
    from PIL import Image
    imgs = []
    for i, u in enumerate(ctx["slides"], 1):
        path = os.path.join(IMG, f"{code}_{i}.jpg")
        if not os.path.exists(path):
            for k in range(4):
                try:
                    b = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read()
                    break
                except Exception:
                    time.sleep(2 ** (k + 1))
            else:
                continue
            im = Image.open(io.BytesIO(b)).convert("RGB")
            im.thumbnail((1080, 1350))
            im.save(path, quality=85)
        imgs.append(f"images/insp/{code}_{i}.jpg")
    lst.insert(0, {"code": code, "user": user, "url": f"https://www.instagram.com/p/{code}/",
                   "caption": (ctx.get("caption") or "").strip()[:300], "images": imgs})
    json.dump(data, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    write_js(data)
    print(f"✔ {len(imgs)} Bilder von @{user or '?'} → Inspiration ({region})")


if __name__ == "__main__":
    main()
