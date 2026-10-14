#!/usr/bin/env python3
"""Baut die Fakten-Pakete der App aus geprüften Recherche-Dateien.

    python3 unnuetzes_wissen/tools/build_facts.py <ordner-mit-verified-*.json>

- übernimmt nur Einträge mit "verdict": "belegt"
- entfernt interne Felder (evidence, verdict, note) – Belegzitate bleiben privat
- vergibt stabile IDs (Kategorie-Kürzel + Hash der Schlagzeile, danach fest im Eintrag)
- baut alle Pakete neu aus den geprüften Dateien
- schreibt data/facts-allgemein.json, data/facts-<ort>.json, data/facts-land-<land>.json,
  data/facts-aktuell.json und data/index.json
"""
import hashlib, json, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TAX = json.loads((DATA / "taxonomy.json").read_text())
CATS = {c["id"] for c in TAX["categories"]}
THEME_IDS = {t["id"] for t in TAX.get("themes", [])}
PUBLIC = ["id", "category", "place", "country", "lang", "headline", "teaser", "detail", "sources", "tags",
          "era", "gross", "sensitive", "kids", "fun", "themes", "wiki", "verified", "expires"]


def fid(f):
    h = hashlib.sha1((f["headline"] + f["sources"][0]["url"]).encode()).hexdigest()[:6]
    return f"{f['category'][:3]}-{h}"


def pack_of(f):
    if f.get("place"):
        return f"facts-{f['place']}.json"
    if f.get("country"):
        return f"facts-land-{f['country']}.json"
    if f["category"] == "aktuell":
        return "facts-aktuell.json"
    return "facts-allgemein.json"


def main(src):
    # Pakete werden jedes Mal komplett aus den geprüften Dateien gebaut – so bleiben keine
    # veralteten Fassungen stehen, wenn eine Prüfung Text oder ID ändert.
    packs = {}
    for p in DATA.glob("facts-*.json"):
        p.unlink()
    # Themen-Zuordnung (themen-*.json: {id: [thema, …]}) aus dem Recherche-Ordner
    themes = {}
    for p in sorted(pathlib.Path(src).glob("themen-*.json")):
        themes.update(json.loads(p.read_text()))
    # Bild-Motiv (wiki-*.json: {id: "Wikipedia-Titel" | null}); die App lädt das Titelbild im Browser
    wiki = {}
    for p in sorted(pathlib.Path(src).glob("wiki-*.json")):
        wiki.update(json.loads(p.read_text()))
    added = skipped = 0
    for path in sorted(pathlib.Path(src).glob("verified-*.json")):
        data = json.loads(path.read_text())
        for f in data:
            if f.get("verdict") != "belegt":
                skipped += 1
                continue
            # Wikipedia ist nie Quelle (nur Wegweiser zu Einzelnachweisen)
            f["sources"] = [s for s in f.get("sources") or [] if "wikipedia.org" not in s.get("url", "")]
            if f.get("category") not in CATS or not f.get("sources"):
                print("übersprungen (Kategorie/Quelle):", f.get("headline"))
                skipped += 1
                continue
            f.setdefault("lang", "de")
            f.setdefault("verified", datetime.date.today().isoformat())
            f["id"] = f.get("id") or fid(f)
            t = [x for x in themes.get(f["id"], f.get("themes") or []) if x in THEME_IDS]
            if f.get("sensitive") == "verbrechen" and "krimi" not in t:
                t.append("krimi")
            if f.get("gross"):
                t.append("eklig")
            if "Vor Ort" in f.get("detail", ""):
                t.append("vorort")
            f["themes"] = list(dict.fromkeys(t))
            if f["id"] in wiki:
                f["wiki"] = wiki[f["id"]]
            out = {k: f.get(k) for k in PUBLIC if f.get(k) is not None}
            out["sources"] = [{k: s.get(k) for k in ("title", "publisher", "date", "url") if s.get(k)} for s in f["sources"]]
            packs.setdefault(pack_of(f), {})[f["id"]] = out
            added += 1
        # vergebene IDs und Prüfdatum festschreiben, damit spätere Textänderungen sie nicht verschieben
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    index = {"version": datetime.datetime.now().strftime("%Y%m%d%H%M"), "packs": []}
    for name, items in sorted(packs.items()):
        (DATA / name).write_text(json.dumps(list(items.values()), ensure_ascii=False, indent=1) + "\n")
        key = name[6:-5]
        entry = {"file": name, "place": None, "count": len(items)}
        if key.startswith("land-"):
            entry["country"] = key[5:]
        elif key not in ("allgemein", "aktuell"):
            entry["place"] = key
        index["packs"].append(entry)
    (DATA / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n")
    total = sum(len(v) for v in packs.values())
    print(f"{added} übernommen, {skipped} verworfen, {total} Fakten insgesamt in {len(packs)} Paketen")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
