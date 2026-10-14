#!/usr/bin/env python3
"""Übernimmt lockerer umgeschriebene Texte (rewritten-*.json) in die geprüften Recherche-Dateien.

    python3 unnuetzes_wissen/tools/apply_rewrite.py <ordner>

Ein neuer Text wird nur übernommen, wenn er keine Zahl und keinen Superlativ enthält, der
nicht schon im alten Eintrag stand. Sonst bleibt der alte Text, der Fakt bekommt aber den
neuen fun-Wert. Danach build_facts.py laufen lassen.
"""
import glob, json, pathlib, re, sys

FIELDS = ("headline", "teaser", "detail")
# Superlative und Absolutheiten; verglichen wird der Wortstamm, damit „älteste“/„ältesten“ gleich zählen.
# „erst“ allein („erst 1990“) ist kein Superlativ und wird nicht geprüft.
SUPER = re.compile(r"\b(größt|erste|ersten|erster|erstes|einzig|ältest|längst|höchst|schnellst|niemals|nie|immer|weltweit|der welt)", re.I)


def numbers(t):
    # 1.000 / 1,5 / 2026 → normalisierte Ziffernfolgen
    return {re.sub(r"[.,\s]", "", n) for n in re.findall(r"\d[\d.,\s]*\d|\d", t)}


def words(t, rx):
    return {m.lower() for m in rx.findall(t)}


def main(src):
    src = pathlib.Path(src)
    new = {}
    for p in sorted(src.glob("rewritten-*.json")):
        for r in json.loads(p.read_text()):
            new[r["id"]] = r
    taken = kept = 0
    for p in sorted(src.glob("verified-*.json")):
        data = json.loads(p.read_text())
        for f in data:
            r = new.get(f.get("id"))
            if not r:
                continue
            old = " ".join(f.get(k, "") for k in FIELDS)
            neu = " ".join(r.get(k, "") for k in FIELDS)
            extra_num = numbers(neu) - numbers(old)
            extra_sup = words(neu, SUPER) - words(old, SUPER)
            if isinstance(r.get("fun"), int) and 1 <= r["fun"] <= 5:
                f["fun"] = r["fun"]
            if extra_num or extra_sup or not all(r.get(k) for k in FIELDS):
                print(f"behalten {f['id']}: neu {sorted(extra_num)} {sorted(extra_sup)} – {r.get('headline')}")
                kept += 1
                continue
            for k in FIELDS:
                f[k] = r[k]
            taken += 1
        p.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f"{taken} umgeschrieben übernommen, {kept} alter Text behalten")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
