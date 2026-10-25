"""Import the researched starter content from seed/*.json (idempotent).

Usage: python -m app.seed [files...]
Images are downloaded into data/images; failures are listed and skipped.
"""
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import SEED_DIR
from app.db import SessionLocal
from app.models import Chapter, ChapterImage, Image, Photographer, Project, Source
from app.routes.common import normalize_tags
from app.services import images as image_service

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
]


def _date(value: str | None) -> date:
    try:
        return date.fromisoformat(value or "")
    except ValueError:
        return date.today()


def add_sources(db: Session, items: list[dict], scope_type: str, scope_id: int, accessed: date) -> int:
    added = 0
    for s in items or []:
        url = (s.get("url") or "").strip()
        if not url:
            continue
        exists = db.scalar(
            select(Source).where(Source.scope_type == scope_type, Source.scope_id == scope_id, Source.url == url)
        )
        if exists:
            continue
        db.add(
            Source(
                url=url,
                title=s.get("title", ""),
                excerpt=s.get("excerpt", ""),
                accessed_at=_date(s.get("accessed_at")) if s.get("accessed_at") else accessed,
                scope_type=scope_type,
                scope_id=scope_id,
            )
        )
        added += 1
    return added


def ensure_chapters(db: Session) -> None:
    for number, title in CHAPTERS:
        if not db.scalar(select(Chapter).where(Chapter.number == number)):
            db.add(Chapter(number=number, title=title))
    db.commit()


def import_file(db: Session, path: Path, keys: dict[str, int], failed: list[str]) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    accessed = _date(data.get("accessed_at"))
    stats = {"photographers": 0, "images": 0, "sources": 0}

    for p in data.get("photographers", []):
        ph = db.scalar(select(Photographer).where(Photographer.name == p["name"]))
        if ph is None:
            ph = Photographer(name=p["name"], born=p.get("born"), died=p.get("died"))
            db.add(ph)
            db.flush()
            stats["photographers"] += 1
        # Later files may supply sourced life dates that earlier ones lacked.
        ph.born = ph.born or p.get("born")
        ph.died = ph.died or p.get("died")
        stats["sources"] += add_sources(db, p.get("sources"), "photographer", ph.id, accessed)

        for pr_data in p.get("projects", []):
            pr = db.scalar(
                select(Project).where(Project.photographer_id == ph.id, Project.title == pr_data["title"])
            )
            if pr is None:
                pr = Project(
                    photographer_id=ph.id,
                    title=pr_data["title"],
                    year_from=pr_data.get("year_from"),
                    year_to=pr_data.get("year_to"),
                )
                db.add(pr)
                db.flush()
            pr.year_from = pr.year_from or pr_data.get("year_from")
            pr.year_to = pr.year_to or pr_data.get("year_to")
            stats["sources"] += add_sources(db, pr_data.get("sources"), "project", pr.id, accessed)

            for im in pr_data.get("images", []):
                # Several images can share one source page (series pages), so the image URL is the key.
                img = db.scalar(
                    select(Image).where(
                        Image.image_url == im["image_url"] if im.get("image_url") else Image.source_url == im["source_url"]
                    )
                )
                if img is None:
                    if not im.get("image_url"):
                        failed.append(f"{im.get('key')}: keine Bild-URL")
                        continue
                    try:
                        raw = image_service.download(im["image_url"])
                        file_path, thumb_path = image_service.store_original(raw)
                    except image_service.ImageImportError as exc:
                        failed.append(f"{im.get('key')}: {exc}")
                        continue
                    time.sleep(0.3)
                    img = Image(
                        photographer_id=ph.id,
                        project_id=pr.id,
                        title=im.get("title", ""),
                        year=im.get("year"),
                        location=im.get("location") or "",
                        file_path=file_path,
                        thumb_path=thumb_path,
                        source_url=im["source_url"],
                        image_url=im["image_url"],
                        accessed_at=accessed,
                        tags=normalize_tags(",".join(im.get("tags", []))),
                    )
                    db.add(img)
                    db.flush()
                    stats["images"] += 1
                    print(f"  + {ph.name}: {img.title}")
                if im.get("key"):
                    keys[im["key"]] = img.id
                stats["sources"] += add_sources(db, im.get("sources"), "image", img.id, accessed)
        db.commit()

    for c in data.get("chapters", []):
        ch = db.scalar(select(Chapter).where(Chapter.number == c["number"]))
        if ch is None:
            ch = Chapter(number=c["number"], title=c["title"])
            db.add(ch)
            db.flush()
        if ch.period_from is None:
            ch.period_from, ch.period_to = c.get("period_from"), c.get("period_to")
        stats["sources"] += add_sources(db, c.get("sources"), "chapter", ch.id, accessed)
        pos = len(ch.images)
        linked = {ci.image_id for ci in ch.images}
        for key in c.get("key_images", []):
            iid = keys.get(key)
            if iid is None or iid in linked:
                continue
            linked.add(iid)
            pos += 1
            db.add(ChapterImage(chapter_id=ch.id, image_id=iid, position=pos))
        db.commit()
    return stats


def _seed_order(path: Path) -> tuple[int, int, str]:
    """Chapter files first (content_ch1-3, content_ch4-6, …), then additions, upgrades last."""
    m = re.match(r"content_ch(\d+)", path.stem)
    if m:
        return (0, int(m.group(1)), path.name)
    return (2 if "upgrade" in path.stem else 1, 0, path.name)


def main(argv: list[str]) -> None:
    files = [Path(a) for a in argv] or sorted(SEED_DIR.glob("*.json"), key=_seed_order)
    keys: dict[str, int] = {}
    failed: list[str] = []
    with SessionLocal() as db:
        ensure_chapters(db)
        for f in files:
            print(f"Importiere {f.name} …")
            stats = import_file(db, f, keys, failed)
            print(f"  {stats}")
    if failed:
        print("\nNicht importiert:")
        for line in failed:
            print("  -", line)


if __name__ == "__main__":
    main(sys.argv[1:])
