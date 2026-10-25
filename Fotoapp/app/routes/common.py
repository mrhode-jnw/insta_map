"""Helpers shared by route modules."""
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Photographer, Project


def get_or_404(db: Session, model, obj_id: int):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(404, "Nicht gefunden")
    return obj


def opt_int(value: str | None) -> int | None:
    value = (value or "").strip()
    return int(value) if value.lstrip("-").isdigit() else None


def parse_date(value: str | None) -> date:
    try:
        return date.fromisoformat((value or "").strip())
    except ValueError:
        return date.today()


def normalize_tags(raw: str) -> str:
    tags = [t.strip().lower() for t in raw.replace(";", ",").split(",")]
    seen: list[str] = []
    for t in tags:
        if t and t not in seen:
            seen.append(t)
    return ", ".join(seen)


def photographer_by_name(db: Session, name: str) -> Photographer:
    name = name.strip()
    if not name:
        raise HTTPException(400, "Fotograf fehlt")
    ph = db.scalar(select(Photographer).where(Photographer.name == name))
    if ph is None:
        ph = Photographer(name=name)
        db.add(ph)
        db.flush()
    return ph


def project_by_title(db: Session, photographer: Photographer, title: str) -> Project | None:
    title = title.strip()
    if not title:
        return None
    pr = db.scalar(select(Project).where(Project.photographer_id == photographer.id, Project.title == title))
    if pr is None:
        pr = Project(photographer_id=photographer.id, title=title)
        db.add(pr)
        db.flush()
    return pr
