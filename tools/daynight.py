"""Tag/Nacht-Einordnung der Spots für den Filter ☀️/🌙 in der App.

Reihenfolge: Korrektur aus hk/daynight.json (id → "day" | "night" | "both") > Regel aus Kategorie,
Text (Notiz/Tipp) und Helligkeit der Fotos. Neue Spots bekommen so automatisch einen Wert;
die Routine prüft ihn anhand der Bilder und trägt Abweichungen in hk/daynight.json ein.
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERRIDES = os.path.join(ROOT, "hk", "daynight.json")

NIGHT = re.compile(r"\b(abends?|nachts?|Nacht|blaue[nr]? Stunde|Neon(?!.*abgerissen)|leuchte[nt]|Lichtspuren|Langzeitbelichtung|Lichter)\b", re.I)
DAY = re.compile(r"\b(morgens|vormittags|mittags|nachmittags|Sonnenaufgang|Morgenlicht|tagsüber|Sonne auf|Tageslicht)\b", re.I)
BOTH = re.compile(r"(Tag und Nacht|tags und nachts|auch (abends|nachts)|bei Tag wie bei Nacht)", re.I)


def _dark(path):
    """True, wenn das Foto nach Nachtaufnahme aussieht (sehr dunkel, kaum Mitteltöne)."""
    try:
        from PIL import Image
        im = Image.open(os.path.join(ROOT, path)).convert("L").resize((48, 48))
        px = list(im.getdata()) if not hasattr(im, "get_flattened_data") else list(im.get_flattened_data())
        mean = sum(px) / len(px)
        dark = sum(1 for v in px if v < 45) / len(px)
        return mean < 58 and dark > 0.45
    except Exception:
        return None


def classify(p, overrides=None):
    o = (overrides if overrides is not None else load_overrides()).get(p.get("id"))
    if o in ("day", "night", "both"):
        return o
    text = " ".join(str(p.get(k) or "") for k in ("note", "tip", "name"))
    if BOTH.search(text):
        return "both"
    imgs = [x.get("image") for x in p.get("posts") or [] if x.get("image")] or ([p["image"]] if p.get("image") else [])
    darks = [d for d in (_dark(i) for i in imgs[:4]) if d is not None]
    night_img, day_img = any(darks), (not darks) or not all(darks)
    night_txt, day_txt = bool(NIGHT.search(text)), bool(DAY.search(text))
    if p.get("category") == "Neon" and "abgerissen" not in text:
        return "both" if day_txt else "night"
    if (night_txt or night_img) and (day_txt or (darks and not all(darks))):
        return "both"
    if night_txt or (darks and all(darks)):
        return "night"
    return "day"


def load_overrides():
    try:
        return json.load(open(OVERRIDES, encoding="utf-8"))
    except Exception:
        return {}


def tag_all(places):
    ov = load_overrides()
    for p in places:
        p["when"] = classify(p, ov)
    return places
