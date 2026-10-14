#!/usr/bin/env python3
"""Baut die Fakten-Pakete der App aus geprüften Recherche-Dateien.

    python3 unnuetzes_wissen/tools/build_facts.py <ordner-mit-verified-*.json>

- übernimmt nur Einträge mit "verdict": "belegt"
- entfernt interne Felder (evidence, verdict, note) – Belegzitate bleiben privat
- vergibt stabile IDs (Kategorie-Kürzel + Hash der Schlagzeile) und hängt an bestehende Pakete an
- schreibt data/facts-allgemein.json, data/facts-<ort>.json, data/facts-aktuell.json und data/index.json
"""
import hashlib, json, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TAX = json.loads((DATA / "taxonomy.json").read_text())
CATS = {c["id"] for c in TAX["categories"]}
PUBLIC = ["id", "category", "place", "lang", "headline", "teaser", "detail", "sources", "tags",
          "era", "gross", "sensitive", "kids", "verified", "expires"]


def fid(f):
    h = hashlib.sha1((f["headline"] + f["sources"][0]["url"]).encode()).hexdigest()[:6]
    return f"{f['category'][:3]}-{h}"


def pack_of(f):
    if f.get("place"):
        return f"facts-{f['place']}.json"
    if f["category"] == "aktuell":
        return "facts-aktuell.json"
    return "facts-allgemein.json"


def main(src):
    packs = {}
    for p in DATA.glob("facts-*.json"):
        packs[p.name] = {f["id"]: f for f in json.loads(p.read_text())}
    added = skipped = 0
    for path in sorted(pathlib.Path(src).glob("verified-*.json")):
        for f in json.loads(path.read_text()):
            if f.get("verdict") != "belegt":
                skipped += 1
                continue
            if f.get("category") not in CATS or not f.get("sources"):
                print("übersprungen (Kategorie/Quelle):", f.get("headline"))
                skipped += 1
                continue
            f.setdefault("lang", "de")
            f.setdefault("verified", datetime.date.today().isoformat())
            f["id"] = fid(f)
            out = {k: f.get(k) for k in PUBLIC if f.get(k) is not None}
            out["sources"] = [{k: s.get(k) for k in ("title", "publisher", "date", "url") if s.get(k)} for s in f["sources"]]
            packs.setdefault(pack_of(f), {})[f["id"]] = out
            added += 1
    index = {"version": datetime.datetime.now().strftime("%Y%m%d%H%M"), "packs": []}
    for name, items in sorted(packs.items()):
        (DATA / name).write_text(json.dumps(list(items.values()), ensure_ascii=False, indent=1) + "\n")
        place = name[6:-5] if name not in ("facts-allgemein.json", "facts-aktuell.json") else None
        index["packs"].append({"file": name, "place": place, "count": len(items)})
    (DATA / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n")
    total = sum(len(v) for v in packs.values())
    print(f"{added} übernommen, {skipped} verworfen, {total} Fakten insgesamt in {len(packs)} Paketen")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
