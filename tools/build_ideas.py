#!/usr/bin/env python3
"""Fotoideen → data/ideas.js (window.IDEAS): ungewöhnliche Foto-Konzepte als eigene Pins (Gruppe „Fotoideen“ oben).

Quelle: cn/ideas.json – je Idee id, name, city, district, lat, lng, approx, when, note (Idee), tip (Umsetzung),
images [{image, url, credit}] (Bilder lokal unter images/).

  python3 tools/build_ideas.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "cn", "ideas.json")
OUT = os.path.join(ROOT, "data", "ideas.js")


def main():
    ideas = json.load(open(SRC, encoding="utf-8")) if os.path.exists(SRC) else []
    out = []
    for x in ideas:
        imgs = [i for i in x.get("images", []) if os.path.exists(os.path.join(ROOT, i["image"]))]
        first = imgs[0] if imgs else {}
        out.append({
            "id": x["id"], "region": "cn", "idea": True, "name": x["name"], "city": x.get("city", ""),
            "district": x.get("district", ""), "category": "Fotoidee", "address": x.get("district", ""),
            "lat": x["lat"], "lng": x["lng"], "approx": bool(x.get("approx")), "when": x.get("when", "both"),
            "note": x.get("note", ""), "tip": x.get("tip", ""), "rain": bool(x.get("rain")),
            "image": first.get("image"), "image_page": first.get("url"), "image_credit": first.get("credit"),
            "posts": [{"url": i["url"], "username": "", "profile_url": i["url"], "kind": "photo", "image": i["image"],
                       "caption": i.get("caption", ""), "credit": i["credit"]} for i in imgs],
        })
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Generiert von tools/build_ideas.py aus cn/ideas.json – Fotoideen.\n")
        f.write("window.IDEAS = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n")
    print(f"✔ {len(out)} Fotoideen → data/ideas.js")


if __name__ == "__main__":
    main()
