"""Estimated study time per lesson: core path vs. Vertiefung (same formula as lessonTime() in js/domain.js).

Calibrated on the user's own pace (lesson "viewpoint" before the split: ~80 min):
80 words/min for dense text, 1.5 min per image or sketch, 0.3 min per gallery thumbnail (::galerie), 1 min per quiz question.
Usage: python3 tools/lesson_time.py [seed/lessons_x.json ...]   (default: all seed lessons)
"""
import json
import re
import sys
from pathlib import Path

WPM, PER_VISUAL, PER_QUESTION, PER_GLANCE = 80, 1.5, 1.0, 0.3
REF = re.compile(r"\[(?:S|Q)\d+[^\]]*\]")


def text_cost(text: str) -> float:
    minutes = 0.0
    for line in (text or "").split("\n"):
        m = re.match(r"::(\w+)\s*(.*)", line.strip())
        if m and m.group(1) == "vergleich":
            minutes += 2 * PER_VISUAL
        elif m and m.group(1) in ("bild", "skizze"):
            minutes += PER_VISUAL
        elif m and m.group(1) == "galerie":
            minutes += len(m.group(2).split("|")[0].split()) * PER_GLANCE
        words = REF.sub("", m.group(2) if m else line).split()
        minutes += len(words) / WPM
    return minutes


def split(text: str) -> tuple[str, str]:
    parts = re.split(r"^::vertiefung\s*$", text or "", maxsplit=1, flags=re.M)
    return parts[0], parts[1] if len(parts) > 1 else ""


def lesson_time(le: dict) -> tuple[float, float]:
    core = text_cost(le.get("intro_md", ""))
    deep = 0.0
    for s in le.get("sections", []):
        a, b = split(s.get("body_md", ""))
        if s.get("deep"):
            deep += text_cost(a) + text_cost(b)
        else:
            core += text_cost(a)
            deep += text_cost(b)
    for e in le.get("examples", []):
        t = PER_VISUAL + len((e.get("caption_md", "") + " " + " ".join(e.get("look_for", []))).split()) / WPM
        if e.get("deep"):
            deep += t
        else:
            core += t
    core += len(" ".join(le.get("takeaways", [])).split()) / WPM
    deep += len(" ".join(le.get("exercises", [])).split()) / WPM  # exercises are for the road, collapsed
    for q in le.get("quiz", []):
        if q.get("deep"):
            deep += PER_QUESTION
        else:
            core += PER_QUESTION
    return core, deep


if __name__ == "__main__":
    files = sys.argv[1:] or sorted(str(p) for p in (Path(__file__).resolve().parent.parent / "seed").glob("lessons_*.json"))
    for f in files:
        for le in json.loads(Path(f).read_text(encoding="utf-8"))["lessons"]:
            c, d = lesson_time(le)
            print(f"{le['dimension']:<24} Kern {c:5.1f} min   Vertiefung {d:5.1f} min   ({Path(f).name})")
