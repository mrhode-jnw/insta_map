#!/usr/bin/env python3
"""Timeline der letzten Änderungen → data/timeline.js (window.TIMELINE = [{t, k, …}], neueste zuerst).

Liest die Git-Geschichte:
  data/places.js, data/china.js → k "new" (neuer Spot), k "photo" (neue Fotos/Posts an einem Spot)
  cn/itinerary.json             → k "plan" (Reiseplan geändert, Text = Commit-Betreff)
  data/inspiration.json         → k "insp" (neue Inspirations-Posts)
  data/insp_locate.json         → k "loc"  (Ergebnis von „Ort recherchieren“)
Eigene Spots und Einträge im Eingang (Branch map-data) ergänzt die App selbst.

  python3 tools/build_timeline.py
"""
import datetime as dt
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPOT_FILES = ["data/places.js", "data/china.js"]
ITIN, INSP, LOC = "cn/itinerary.json", "data/inspiration.json", "data/insp_locate.json"
OUT = os.path.join(ROOT, "data", "timeline.js")
ARR = re.compile(r'window\.PLACES(?:_CN)?\s*=\s*(\[.*?\]);\s*(?=window\.|$)', re.S)
DAYS = 45      # so weit zurück
MAX = 400      # höchstens so viele Einträge


def git(*a):
    return subprocess.run(["git", "-C", ROOT, *a], capture_output=True, text=True).stdout


def spots(text):
    out = {}
    for m in ARR.finditer(text or ""):
        try:
            arr = json.loads(m.group(1))
        except ValueError:
            continue
        for p in arr:
            if isinstance(p, dict) and p.get("id"):
                imgs = {x.get("image") for x in p.get("posts", []) if x.get("image")} | ({p["image"]} if p.get("image") else set())
                out[p["id"]] = (p.get("name", ""), imgs)
    return out


def jload(text, empty):
    try:
        return json.loads(text) if text and text.strip() else empty
    except ValueError:
        return empty


def main():
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=DAYS)).strftime("%Y-%m-%d")
    files = SPOT_FILES + [ITIN, INSP, LOC]
    log = [l.split("\x1f") for l in git("log", "--reverse", "--format=%H\x1f%cI\x1f%s", "--", *files).split("\n") if l]
    ev, state = [], {}

    def utc(s):
        return dt.datetime.fromisoformat(s).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M")

    for sha, when, subj in log:
        t = utc(when)
        changed = set(git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha).split())
        rec = t[:10] >= since
        for f in SPOT_FILES:
            if f not in changed and f in state:
                continue
            cur = spots(git("show", f"{sha}:{f}"))
            prev = state.get(f)
            if prev is not None and rec:
                for i, (name, imgs) in cur.items():
                    if i not in prev:
                        ev.append({"t": t, "k": "new", "id": i, "name": name, "n": len(imgs)})
                    else:
                        add = imgs - prev[i][1]
                        if add:
                            ev.append({"t": t, "k": "photo", "id": i, "name": name, "n": len(add)})
            state[f] = cur
        if ITIN in changed and rec:
            ev.append({"t": t, "k": "plan", "text": subj.split(" – ")[0][:160]})
        if INSP in changed:
            cur = {p.get("code"): r for r, l in jload(git("show", f"{sha}:{INSP}"), {}).items() for p in l}
            prev = state.get(INSP)
            if prev is not None and rec:
                new = [c for c in cur if c not in prev]
                if new:
                    ev.append({"t": t, "k": "insp", "n": len(new), "regions": sorted({cur[c] for c in new})})
            state[INSP] = cur
        if LOC in changed:
            cur = jload(git("show", f"{sha}:{LOC}"), {})
            prev = state.get(LOC, {})
            if rec:
                for img, r in cur.items():
                    if prev.get(img) != r:
                        ev.append({"t": t, "k": "loc", "image": img, "status": r.get("status"), "id": r.get("spot"), "note": (r.get("note") or "")[:200]})
            state[LOC] = cur
    ev.sort(key=lambda e: e["t"], reverse=True)
    ev = ev[:MAX]
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// Generiert von tools/build_timeline.py – letzte Änderungen (UTC), neueste zuerst.\n")
        fh.write("window.TIMELINE = " + json.dumps(ev, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"✔ {len(ev)} Einträge → data/timeline.js")


if __name__ == "__main__":
    main()
