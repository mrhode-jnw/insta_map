"""Build the web app's library (data/library.json) from seed/*.json and encrypt the images.

Usage:
  python3 tools/build_library.py --media-dir <checkout of branch sehschule-media> --key-file <path to media key>

- Library metadata (photographers, projects, images, sources, chapters, concepts) is public anyway
  (it is in seed/), so data/library.json is plain JSON.
- Images are copyrighted: they are downloaded, scaled (1568 px / 480 px) and stored AES-256-GCM encrypted
  (iv[12] | ciphertext) as m/<id>.bin and t/<id>.bin in the media checkout. Only holders of the media key
  (itself stored encrypted with the access code in config.js) can view them.
- IDs are stable hashes, so stored analyses keep pointing at the right images and sources after rebuilds.
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = ROOT / "seed"
OUT = ROOT / "data" / "library.json"
FULL_EDGE = 1568  # what the Claude API uses at most
THUMB_EDGE = 480
USER_AGENT = "Sehschule/1.0 (private study app; https://github.com/mrhode-jnw/insta_map)"

CHAPTERS = [
    (1, "Expeditions- und Reisefotografie des 19. Jahrhunderts"),
    (2, "Die große Landschaftsfotografie in Schwarzweiß"),
    (3, "Der entscheidende Augenblick: Straßenfotografie und die Gründung von Magnum"),
    (4, "Farbe wird ernst genommen: die Farbfotografen der 70er"),
    (5, "Neue Topografie: Landschaft mit Spuren des Menschen"),
    (6, "Das Reisemagazin-Zeitalter: ikonische Reportage- und Porträtbilder"),
    (7, "Die großen Formate: Düsseldorfer Schule und die Megastädte"),
    (8, "Natur und Tiere: von der Expedition zur Naturschutzfotografie"),
    (9, "Zeitgenössische Landschaft: Mensch, Industrie, Klima"),
    (10, "Instagram und die Folgen"),
    (11, "Die Reise als Autorenprojekt: Roadtrip, Fremde, Blick von außen"),
    (12, "Landschaftsfotografie: vom Erhabenen zur intimen Landschaft"),
]


def short_hash(*parts: str, n: int = 12) -> str:
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:n]


def source_id(scope: str, scope_id: str, url: str, excerpt: str) -> int:
    """Stable numeric id for [S<id>] citations."""
    return int(short_hash(scope, scope_id, url, excerpt, n=6), 16) % 900000 + 100000


def seed_order(path: Path) -> tuple:
    m = re.match(r"content_ch(\d+)", path.stem)
    if m:
        return (0, int(m.group(1)), path.name)
    if "sehen" in path.stem:
        return (3, 0, path.name)
    return (2 if "upgrade" in path.stem else 1, 0, path.name)


def norm_tags(tags) -> list[str]:
    out: list[str] = []
    for t in tags or []:
        t = t.strip().lower()
        if t and t not in out:
            out.append(t)
    return out


class Library:
    def __init__(self) -> None:
        self.photographers: dict[str, dict] = {}
        self.projects: dict[str, dict] = {}
        self.images: dict[str, dict] = {}
        self.sources: dict[int, dict] = {}
        self.chapters: dict[int, dict] = {
            n: {"id": f"c{n}", "number": n, "title": t, "period_from": None, "period_to": None, "images": []}
            for n, t in CHAPTERS
        }
        self.concepts: dict[str, dict] = {}
        self.keys: dict[str, str] = {}  # seed image key -> image id
        self.by_url: dict[str, str] = {}

    def add_sources(self, items, scope: str, scope_id: str, accessed: str) -> list[int]:
        ids = []
        for s in items or []:
            url = (s.get("url") or "").strip()
            if not url:
                continue
            excerpt = s.get("excerpt", "")
            sid = source_id(scope, scope_id, url, excerpt)
            salt = 0
            # On a hash collision probe deterministically; ids of earlier sources never change.
            while sid in self.sources and (self.sources[sid]["url"], self.sources[sid]["excerpt"],
                                           self.sources[sid]["scope"], self.sources[sid]["scope_id"]) != (url, excerpt, scope, scope_id):
                salt += 1
                sid = source_id(scope, scope_id, url, excerpt + f"#{salt}")
            entry = self.sources.setdefault(sid, {
                "id": sid, "url": url, "title": s.get("title", ""), "excerpt": excerpt,
                "accessed_at": s.get("accessed_at") or accessed, "scope": scope, "scope_id": scope_id,
            })
            # expert voices carry who said it and about what
            for k in ("kind", "author", "aspect", "series_level"):
                if s.get(k):
                    entry[k] = s[k]
            ids.append(sid)
        return ids

    def import_file(self, data: dict) -> None:
        accessed = data.get("accessed_at") or time.strftime("%Y-%m-%d")
        for p in data.get("photographers", []):
            pid = "p" + short_hash(p["name"], n=8)
            ph = self.photographers.setdefault(pid, {"id": pid, "name": p["name"], "born": None, "died": None})
            ph["born"] = ph["born"] or p.get("born")
            ph["died"] = ph["died"] or p.get("died")
            self.add_sources(p.get("sources"), "photographer", pid, accessed)
            for pr in p.get("projects", []):
                prid = "r" + short_hash(p["name"], pr["title"], n=8)
                proj = self.projects.setdefault(prid, {
                    "id": prid, "photographer_id": pid, "title": pr["title"], "year_from": None, "year_to": None})
                proj["year_from"] = proj["year_from"] or pr.get("year_from")
                proj["year_to"] = proj["year_to"] or pr.get("year_to")
                self.add_sources(pr.get("sources"), "project", prid, accessed)
                for im in pr.get("images", []):
                    url = im.get("image_url") or ""
                    if not url:
                        continue
                    iid = self.by_url.get(url) or "i" + short_hash(url, n=10)
                    self.by_url[url] = iid
                    self.images.setdefault(iid, {
                        "id": iid, "photographer_id": pid, "project_id": prid, "title": im.get("title", ""),
                        "year": im.get("year"), "location": im.get("location") or "",
                        "source_url": im["source_url"], "image_url": url, "accessed_at": accessed,
                        "tags": norm_tags(im.get("tags")),
                    })
                    if im.get("key"):
                        self.keys[im["key"]] = iid
                    self.add_sources(im.get("sources"), "image", iid, accessed)
        for c in data.get("chapters", []):
            ch = self.chapters.setdefault(c["number"], {
                "id": f"c{c['number']}", "number": c["number"], "title": c["title"],
                "period_from": None, "period_to": None, "images": []})
            if ch["period_from"] is None:
                ch["period_from"], ch["period_to"] = c.get("period_from"), c.get("period_to")
            self.add_sources(c.get("sources"), "chapter", ch["id"], accessed)
            for key in c.get("key_images", []):
                iid = self.keys.get(key)
                if iid and iid not in ch["images"]:
                    ch["images"].append(iid)
        for c in data.get("concepts", []):
            cid = c["key"]
            ids = self.add_sources(c.get("sources"), "concept", cid, accessed)

            self.concepts[cid] = {
                "id": cid, "name": c["name"], "dimension": c.get("dimension", ""),
                "summary_md": q_to_s(c.get("summary_md", ""), ids),
                "exercise_md": c.get("exercise_md", ""),
                "images": [{"id": self.keys[e["key"]], "note": e.get("note", "")}
                           for e in c.get("example_images", []) if e.get("key") in self.keys],
            }


    def import_experts(self, data: dict) -> int:
        accessed = data.get("accessed_at") or time.strftime("%Y-%m-%d")
        n = 0
        for entry in data.get("images", []):
            iid = self.by_url.get(entry.get("image_url", ""))
            if not iid:
                continue
            n += len(self.add_sources(entry.get("experts"), "image", iid, accessed))
        return n

    def import_chapter_texts(self, data: dict) -> int:
        """Sourced base texts for chapters ([S<id>] for library sources, [Qn] for the file's own sources)."""
        accessed = data.get("accessed_at") or time.strftime("%Y-%m-%d")
        n = 0
        for c in data.get("chapters", []):
            ch = self.chapters.setdefault(c["number"], {
                "id": f"c{c['number']}", "number": c["number"], "title": c.get("title", ""),
                "period_from": None, "period_to": None, "images": []})
            if ch["period_from"] is None:
                ch["period_from"], ch["period_to"] = c.get("period_from"), c.get("period_to")
            ids = self.add_sources(c.get("sources"), "chapter", ch["id"], accessed)
            ch["text_md"] = q_to_s(c.get("text_md", ""), ids)
            n += 1
        return n

    def import_bios(self, data: dict) -> int:
        accessed = data.get("accessed_at") or time.strftime("%Y-%m-%d")
        by_name = {p["name"]: p for p in self.photographers.values()}
        n = 0
        for b in data.get("photographers", []):
            ph = by_name.get(b.get("name"))
            if not ph:
                continue
            ids = self.add_sources(b.get("sources"), "photographer", ph["id"], accessed)
            ph["born"] = ph["born"] or b.get("born")
            ph["died"] = ph["died"] or b.get("died")
            ph["bio_md"] = q_to_s(b.get("bio_md", ""), ids)
            ph["method_md"] = q_to_s(b.get("method_md", ""), ids)
            if b.get("portrait") and b["portrait"].get("image_url"):
                ph["portrait"] = {k: b["portrait"].get(k, "") for k in ("image_url", "source_url", "credit")}
            n += 1
        return n


def q_to_s(text: str, ids: list[int]) -> str:
    """[Q1, Q2] (position in the entry's own source list) -> [S<id>, S<id>]."""
    def group(m: re.Match) -> str:
        def one(q: re.Match) -> str:
            k = int(q.group(1)) - 1
            return f"S{ids[k]}" if 0 <= k < len(ids) else q.group(0)
        return "[" + re.sub(r"Q(\d+)", one, m.group(1)) + "]"
    return re.sub(r"\[(Q\d+(?:\s*,\s*Q\d+)*)\]", group, text or "")


def headers(url: str) -> dict:
    h = {"User-Agent": USER_AGENT, "Accept": "image/jpeg,image/*;q=0.8"}
    if "artic.edu" in url:
        h["AIC-User-Agent"] = USER_AGENT
    return h


def download(url: str) -> bytes:
    """Some CDNs reject urllib, others httpx – try both."""
    try:
        import httpx

        r = httpx.get(url, headers=headers(url), follow_redirects=True, timeout=60)
        r.raise_for_status()
        return r.content
    except Exception as first:  # noqa: BLE001 - fall back to urllib for any client error
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers(url)), timeout=60) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ValueError):
            raise RuntimeError(f"{first}") from first


def scaled_jpeg(img: Image.Image, edge: int, quality: int) -> bytes:
    im = img.convert("RGB") if img.mode not in ("I;16", "I;16B", "I") else img.point(lambda v: v / 256).convert("RGB")
    im.thumbnail((edge, edge))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def encrypt(key: bytes, data: bytes) -> bytes:
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, data, None)


def build_portraits(lib: Library, media_dir: Path, key: bytes) -> list[str]:
    (media_dir / "p").mkdir(parents=True, exist_ok=True)
    failed = []
    for ph in lib.photographers.values():
        portrait = ph.get("portrait")
        if not portrait:
            continue
        out = media_dir / "p" / f"{ph['id']}.bin"
        if not out.exists():
            try:
                with Image.open(io.BytesIO(download(portrait["image_url"]))) as img:
                    img.load()
                    out.write_bytes(encrypt(key, scaled_jpeg(img, 800, 84)))
                print("  + Porträt", ph["name"])
                time.sleep(1.0)
            except Exception as exc:  # noqa: BLE001 - report and continue
                failed.append(f"Porträt {ph['name']}: {exc}"[:200])
                ph.pop("portrait")
                continue
        portrait.pop("image_url", None)
    return failed


def build_media(lib: Library, media_dir: Path, key: bytes) -> list[str]:
    (media_dir / "m").mkdir(parents=True, exist_ok=True)
    (media_dir / "t").mkdir(parents=True, exist_ok=True)
    failed = []
    for iid, im in lib.images.items():
        full, thumb = media_dir / "m" / f"{iid}.bin", media_dir / "t" / f"{iid}.bin"
        if full.exists() and thumb.exists():
            with Image.open(io.BytesIO(AESGCM(key).decrypt(thumb.read_bytes()[:12], thumb.read_bytes()[12:], None))) as t:
                im["w"], im["h"] = t.size
            continue
        try:
            raw = download(im["image_url"])
            with Image.open(io.BytesIO(raw)) as img:
                img.load()
                full_bytes = scaled_jpeg(img, FULL_EDGE, 86)
                thumb_bytes = scaled_jpeg(img, THUMB_EDGE, 80)
        except Exception as exc:  # noqa: BLE001 - report and continue with the next image
            failed.append(f"{im['title'][:50]}: {exc}"[:200])
            continue
        full.write_bytes(encrypt(key, full_bytes))
        thumb.write_bytes(encrypt(key, thumb_bytes))
        with Image.open(io.BytesIO(thumb_bytes)) as t:
            im["w"], im["h"] = t.size
        print("  +", im["title"][:70])
        time.sleep(0.3)
    return failed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--media-dir", type=Path, help="checkout of the sehschule-media branch")
    ap.add_argument("--key-file", type=Path, help="file with the 32-byte media key (hex)")
    args = ap.parse_args()

    lib = Library()
    for f in sorted(SEED_DIR.glob("content_*.json"), key=seed_order):
        lib.import_file(json.loads(f.read_text(encoding="utf-8")))
    experts = sum(lib.import_experts(json.loads(f.read_text(encoding="utf-8"))) for f in sorted(SEED_DIR.glob("experts_*.json")))
    texts = sum(lib.import_chapter_texts(json.loads(f.read_text(encoding="utf-8"))) for f in sorted(SEED_DIR.glob("chapter_texts_*.json")))
    bio_file = SEED_DIR / "photographers_bio.json"
    bios = lib.import_bios(json.loads(bio_file.read_text(encoding="utf-8"))) if bio_file.exists() else 0

    failed: list[str] = []
    if args.media_dir:
        key = bytes.fromhex(args.key_file.read_text().strip())
        failed = build_media(lib, args.media_dir, key) + build_portraits(lib, args.media_dir, key)
        present = {p.stem for p in (args.media_dir / "m").glob("*.bin")}
        missing = [i for i in lib.images if i not in present]
        for i in missing:
            lib.images.pop(i)
        for ch in lib.chapters.values():
            ch["images"] = [i for i in ch["images"] if i in lib.images]
        for c in lib.concepts.values():
            c["images"] = [e for e in c["images"] if e["id"] in lib.images]

    if not args.media_dir:  # without media no portrait files exist; keep the source info only
        for ph in lib.photographers.values():
            ph.pop("portrait", None)
    out = {
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "photographers": sorted(lib.photographers.values(), key=lambda p: p["name"]),
        "projects": list(lib.projects.values()),
        "images": list(lib.images.values()),
        "sources": sorted(lib.sources.values(), key=lambda s: s["id"]),
        "chapters": [lib.chapters[n] for n in sorted(lib.chapters)],
        "concepts": sorted(lib.concepts.values(), key=lambda c: c["name"]),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out['photographers'])} Fotografen, {len(out['images'])} Bilder, {len(out['sources'])} Quellen "
          f"({experts} Expertenstimmen), {bios} Biografien, {texts} Kapiteltexte, {len(out['concepts'])} Begriffe → {OUT.relative_to(ROOT)}")
    if failed:
        print("\nNicht geladen:", *failed, sep="\n  - ")


if __name__ == "__main__":
    sys.exit(main())
