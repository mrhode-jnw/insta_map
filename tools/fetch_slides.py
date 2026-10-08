#!/usr/bin/env python3
"""Lädt Caption + Slide-URLs aller Posts aus hk/spots.py nach data/cache.json ("ctx")."""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "hk"))
import build_places as bp  # noqa: E402
import slides as sl  # noqa: E402
from spots import POSTS  # noqa: E402

cache = bp.load_json(bp.CACHE_FILE, {"posts": {}, "geo": {}})
ctx = cache.setdefault("ctx", {})
todo = [POSTS[i][2] for i in sorted(POSTS) if POSTS[i][2] not in ctx]
for n, code in enumerate(todo, 1):
    print(f"[{n}/{len(todo)}] {code}", flush=True)
    c = sl.fetch_context(code)
    if c:
        ctx[code] = c
        bp.save_json(bp.CACHE_FILE, cache)
    time.sleep(4)
print("fertig:", sum(1 for i in POSTS if POSTS[i][2] in ctx), "von", len(POSTS))
