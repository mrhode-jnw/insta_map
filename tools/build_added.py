#!/usr/bin/env python3
"""Wann kam jeder Spot dazu bzw. zuletzt ein neuer Post? → data/added.js
(window.ADDED = {id: ["angelegt YYYY-MM-DDTHH:MM", "zuletzt neuer Post" | null]}).

Liest die Git-Geschichte von data/places.js und data/china.js: maßgeblich ist der erste Commit, in dem
die Spot-ID auftaucht, bzw. der letzte, in dem der Spot einen neuen Instagram-Post bekam. Noch nicht
eingecheckte Änderungen bekommen die aktuelle Zeit.
Die App sortiert damit „Neu hinzugefügt“; eigene Spots (my-spots.json) bringen ihr „created“ selbst mit.

  python3 tools/build_added.py
"""
import datetime as dt
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ["data/places.js", "data/china.js"]
OUT = os.path.join(ROOT, "data", "added.js")
ID = re.compile(r'"id":\s*"([^"]+)"')
IG = re.compile(r'instagram\.com/(?:[\w.]+/)?(?:p|reel|tv)/([\w-]+)')
ARR = re.compile(r'window\.\w+\s*=\s*(\[.*?\]);\s*(?=window\.|$)', re.S)


def spots(text):
    """{id: {Instagram-Codes}} aus einer places.js/china.js-Fassung."""
    out = {}
    for m in ARR.finditer(text):
        try:
            arr = json.loads(m.group(1))
        except ValueError:
            continue
        for p in arr:
            if isinstance(p, dict) and p.get("id"):
                out[p["id"]] = set(IG.findall(json.dumps(p)))
    if not out:  # ältere/abweichende Fassung: wenigstens die IDs
        out = {i: set() for i in ID.findall(text)}
    return out


def git(*a):
    return subprocess.run(["git", "-C", ROOT, *a], capture_output=True, text=True).stdout


def main():
    first, last, codes = {}, {}, {}

    def take(text, when):
        for i, cs in spots(text).items():
            if i not in first:
                first[i], codes[i] = when, set(cs)
            elif cs - codes[i]:
                last[i] = when
                codes[i] |= cs

    log = git("log", "--reverse", "--format=%H %cI", "--", *FILES).split("\n")
    for line in filter(None, log):
        sha, when = line.split(" ", 1)
        when = dt.datetime.fromisoformat(when).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M")
        for f in FILES:
            take(git("show", f"{sha}:{f}"), when)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M")
    for f in FILES:
        take(open(os.path.join(ROOT, f), encoding="utf-8").read(), now)
    added = {i: [first[i], last.get(i)] for i in first}
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// Generiert von tools/build_added.py – je Spot: [angelegt, zuletzt ergänzt] (UTC).\n")
        fh.write("window.ADDED = " + json.dumps(added, separators=(",", ":")) + ";\n")
    print(f"✔ {len(added)} Spots mit Datum ({len(last)} mit späterem Post) → data/added.js")
    import build_timeline  # Timeline der letzten Änderungen (data/timeline.js) gleich mit erneuern
    build_timeline.main()


if __name__ == "__main__":
    main()
