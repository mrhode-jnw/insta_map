#!/usr/bin/env python3
"""Hilfswerkzeug für die stündliche Claude-Routine (siehe ROUTINE.md).

  python3 tools/inbox.py pending            # neue Links im Eingang (Branch map-data), noch nicht in hk/spots.py
  python3 tools/inbox.py show <code>        # Post laden: Account, Typ, Caption, Anzahl Bilder, nummerierte Orte
  python3 tools/inbox.py add-post <code>    # Post in hk/spots.py → POSTS eintragen, gibt den Index aus
  python3 tools/inbox.py skip <code> <grund> # Post dauerhaft überspringen (z.B. gelöscht/privat)
  python3 tools/inbox.py link <id>          # Google-Maps-/OSM-/Locationscout-Eintrag auslesen (Name, Koordinaten, Tipps)
  python3 tools/inbox.py done <id> <spot>   # solchen Eintrag als erledigt markieren (Spot-Name oder „vorhanden: …“)
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "hk"))

import build_places as bp  # noqa: E402
import slides as sl  # noqa: E402

SPOTS = os.path.join(ROOT, "hk", "spots.py")
SPOTS_CN = os.path.join(ROOT, "cn", "spots_cn.py")  # China-Sammlung (tools/build_cn.py)
SKIPPED = os.path.join(ROOT, "hk", "inbox_skipped.json")
DONE = os.path.join(ROOT, "hk", "inbox_done.json")  # erledigte Nicht-Instagram-Links (id → Spot)
DATA_BRANCH = "map-data"


def inbox():
    subprocess.run(["git", "-C", ROOT, "fetch", "-q", "origin", DATA_BRANCH], check=False)
    r = subprocess.run(["git", "-C", ROOT, "show", f"origin/{DATA_BRANCH}:data/inbox.json"],
                       capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else []


def known_codes():
    txt = open(SPOTS, encoding="utf-8").read() + open(SPOTS_CN, encoding="utf-8").read()
    return set(re.findall(r'\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([A-Za-z0-9_-]+)"\s*\)', txt))


def pending():
    skipped = bp.load_json(SKIPPED, {})
    done = bp.load_json(DONE, {})
    known = known_codes()
    out = []
    for x in inbox():
        if x.get("code"):  # Instagram
            if x["code"] not in known and x["code"] not in skipped:
                out.append(x)
        elif x.get("id") and x["id"] not in done and x["id"] not in skipped:  # Google Maps / OSM / Locationscout
            out.append(x)
    return out


def link(lid):
    import linkinfo
    x = next((e for e in inbox() if e.get("id") == lid), None)
    if not x:
        sys.exit("unbekannte id: " + lid)
    d = linkinfo.info(x["url"])
    if x.get("note"):
        d["shared_text"] = x["note"]
    if x.get("where"):
        d["where"] = x["where"]  # Ortsangabe des Nutzers – hat Vorrang vor Vermutungen
    print(json.dumps(d, ensure_ascii=False, indent=1))


def done(lid, spot):
    d = bp.load_json(DONE, {})
    d[lid] = spot
    bp.save_json(DONE, d)


def show(code):
    cache = bp.load_json(bp.CACHE_FILE, {"posts": {}, "geo": {}})
    post = cache["posts"].get(code) or bp.fetch_post(code)
    if "image_src" in post:
        post["image"] = bp.download_image(code, post.pop("image_src"))
    cache["posts"][code] = post
    ctx = cache.setdefault("ctx", {})
    c = ctx.get(code) or sl.fetch_context(code)
    if c:
        ctx[code] = c
    bp.save_json(bp.CACHE_FILE, cache)
    where = next((e.get("where") for e in inbox() if e.get("code") == code and e.get("where")), None)
    print(json.dumps({
        "code": code,
        "username": post.get("username"),
        "slides": len(c["slides"]) if c else None,
        "numbered_entries": [e[0] for e in sl.list_entries(c["caption"])] if c else [],
        "caption": (c or {}).get("caption") or post.get("caption", ""),
        **({"where": where} if where else {}),  # Ortsangabe des Nutzers – hat Vorrang vor Vermutungen
    }, ensure_ascii=False, indent=1))


def add_post(code, kind=None):
    txt = open(SPOTS, encoding="utf-8").read()
    if code in known_codes():
        idx = re.search(r'(\d+)\s*:\s*\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"' + re.escape(code) + '"', txt).group(1)
        print(idx); return
    cache = bp.load_json(bp.CACHE_FILE, {"posts": {}})
    post = cache["posts"].get(code) or bp.fetch_post(code)
    user = post.get("username") or "unknown"
    if not kind:
        page = next((x for x in inbox() if x["code"] == code), {}).get("url", "")
        kind = "reel" if "/reel" in page else "p"
    m = re.search(r"POSTS\s*=\s*\{(.*?)\n\}", txt, re.S)
    nums = [int(n) for n in re.findall(r"(\d+)\s*:\s*\(", m.group(1))]
    idx = max(nums) + 1
    entry = f' {idx}:("{user}","{kind}","{code}"),\n'
    txt = txt[:m.end() - 1] + entry + txt[m.end() - 1:]
    open(SPOTS, "w", encoding="utf-8").write(txt)
    print(idx)


def skip(code, reason):
    d = bp.load_json(SKIPPED, {})
    d[code] = reason
    bp.save_json(SKIPPED, d)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "pending"
    if cmd == "pending":
        p = pending()
        print(json.dumps(p, ensure_ascii=False, indent=1) if p else "KEINE NEUEN POSTS")
    elif cmd == "show":
        show(sys.argv[2])
    elif cmd == "add-post":
        add_post(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    elif cmd == "link":
        link(sys.argv[2])
    elif cmd == "done":
        done(sys.argv[2], " ".join(sys.argv[3:]) or "erledigt")
    elif cmd == "skip":
        skip(sys.argv[2], " ".join(sys.argv[3:]) or "übersprungen")
    else:
        print(__doc__)
