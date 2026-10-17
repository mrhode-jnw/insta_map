#!/usr/bin/env python3
"""Seit wann gibt es jeden Spot? → data/added.js (window.ADDED = {id: "YYYY-MM-DDTHH:MM"}).

Liest die Git-Geschichte von data/places.js und data/china.js: maßgeblich ist der erste Commit, in dem
die Spot-ID auftaucht. Spots, die noch nicht eingecheckt sind, bekommen die aktuelle Zeit.
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


def git(*a):
    return subprocess.run(["git", "-C", ROOT, *a], capture_output=True, text=True).stdout


def main():
    added = {}
    log = git("log", "--reverse", "--format=%H %cI", "--", *FILES).split("\n")
    for line in filter(None, log):
        sha, when = line.split(" ", 1)
        when = dt.datetime.fromisoformat(when).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M")
        for f in FILES:
            for i in ID.findall(git("show", f"{sha}:{f}")):
                added.setdefault(i, when)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M")
    for f in FILES:
        for i in ID.findall(open(os.path.join(ROOT, f), encoding="utf-8").read()):
            added.setdefault(i, now)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// Generiert von tools/build_added.py – erster Commit je Spot-ID (UTC).\n")
        fh.write("window.ADDED = " + json.dumps(added, separators=(",", ":")) + ";\n")
    print(f"✔ {len(added)} Spots mit Datum → data/added.js")


if __name__ == "__main__":
    main()
