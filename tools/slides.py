"""Karussell-Daten eines Posts: vollständige Caption + Bild-URL jedes Slides.

Quelle ist das contextJSON der öffentlichen Embed-Seite. Ergebnisse werden in
data/cache.json unter "ctx" gespeichert (Bild-URLs laufen ab, daher werden die
benötigten Slides sofort nach images/<code>_<n>.jpg geladen).
"""
import difflib
import json
import os
import re
import sys
import time
import urllib.error

import build_places as bp

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")


def fetch_context(code):
    for attempt in range(5):
        try:
            page = bp.http_get(f"https://www.instagram.com/p/{code}/embed/captioned/", ua=UA)
        except urllib.error.HTTPError as e:
            page = ""
            print(f"    HTTP {e.code}", file=sys.stderr)
        m = re.search(r'"contextJSON":("(?:[^"\\]|\\.)*")', page or "")
        if m:
            raw = json.loads(m.group(1))
            if raw:
                sm = json.loads(raw)["gql_data"]["shortcode_media"]
                caps = sm.get("edge_media_to_caption", {}).get("edges", [])
                kids = sm.get("edge_sidecar_to_children", {}).get("edges", [])
                nodes = [k["node"] for k in kids] or [sm]
                return {
                    "caption": caps[0]["node"]["text"] if caps else "",
                    "slides": [pick(n) for n in nodes],
                }
        wait = 20 * (attempt + 1)
        print(f"    kein contextJSON, warte {wait}s …", file=sys.stderr)
        time.sleep(wait)
    return None


def pick(node):
    """Slide-Bild mit ~640px Breite."""
    res = node.get("display_resources") or []
    if res:
        return min(res, key=lambda r: abs(r["config_width"] - 640))["src"]
    return node.get("display_url")


def download_slide(code, idx, src):
    rel = f"images/{code}_{idx + 1}.jpg"
    path = os.path.join(bp.ROOT, rel)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(bp.http_get(src, ua=UA, binary=True))
    return rel


# ---------------------------------------------------------------- Caption-Liste → Slide

ENTRY_RE = re.compile(r"^\s*(\d{1,2})(?:\s*[-–&,]\s*(\d{1,2}))?\s*[.)：:]\s*(.+)$")
STOP = {"the", "at", "of", "and", "in", "on", "near", "hong", "kong", "hk", "drone", "view",
        "street", "st", "road", "rd", "building", "bldg"}


def list_entries(caption):
    """[(name, [slide-indizes 0-basiert])] aus „1. Name“ / „12-13. Name“-Zeilen."""
    out = []
    for line in caption.splitlines():
        m = ENTRY_RE.match(line)
        if not m:
            continue
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) else a
        if not (1 <= a <= b <= 20):
            continue
        out.append((m.group(3).strip(), list(range(a - 1, b))))
    return out


def tokens(s):
    s = re.sub(r"[^\w\s]", " ", s.lower())
    s = re.sub(r"[　-鿿]+", " ", s)  # CJK raus, Listen sind englisch
    return [t for t in s.split() if len(t) > 1 and not t.isdigit()
            and not any(similar(t, w) for w in STOP)]  # auch Tippfehler wie „Streer“


def similar(a, b):
    return a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.82


def score(spot_text, entry):
    st, et = tokens(spot_text), tokens(entry)
    if not st or not et:
        return 0.0
    hit_e = sum(any(similar(e, s) for s in st) for e in et) / len(et)
    hit_s = sum(any(similar(s, e) for e in et) for s in st) / len(st)
    return 0.7 * hit_e + 0.3 * hit_s


def match_slide(spot, entries):
    """Bester Listeneintrag für einen Spot → (slide-index, eintrag, score) oder None."""
    texts = [spot["name"]] + ([spot["q"]] if isinstance(spot["q"], str) else [])
    best = None
    for name, idxs in entries:
        sc = max(score(t, name) for t in texts)
        if not best or sc > best[2]:
            best = (idxs[0], name, sc)
    return best if best and best[2] >= 0.6 else None
