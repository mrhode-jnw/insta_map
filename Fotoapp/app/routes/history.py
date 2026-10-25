"""History: chapters with sourced text, key images, and the timeline."""
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Chapter, ChapterImage, Image
from app.routes.common import get_or_404, opt_int
from app.services import claude_client
from app.services import sources as source_service
from app.services.claude_client import ClaudeError
from app.web import templates

router = APIRouter()


@router.get("/chapters")
def chapter_list(request: Request, db: Session = Depends(get_db)):
    rows = db.scalars(select(Chapter).order_by(Chapter.number)).all()
    return templates.TemplateResponse(request, "chapters.html", {"chapters": rows})


@router.post("/chapters")
def chapter_create(
    number: int = Form(...),
    title: str = Form(...),
    period_from: str = Form(""),
    period_to: str = Form(""),
    db: Session = Depends(get_db),
):
    if db.scalar(select(Chapter).where(Chapter.number == number)):
        raise HTTPException(400, "Kapitelnummer existiert bereits")
    ch = Chapter(number=number, title=title.strip(), period_from=opt_int(period_from), period_to=opt_int(period_to))
    db.add(ch)
    db.commit()
    return RedirectResponse(f"/chapters/{ch.id}/edit", status_code=303)


def _blocks(ch: Chapter) -> list[tuple[str, object]]:
    """Alternate text sections (split at '## ' headings) and key images."""
    sections: list[str] = []
    current: list[str] = []
    for line in (ch.text_md or "").splitlines():
        if line.startswith("## ") and current:
            sections.append("\n".join(current))
            current = []
        current.append(line)
    if current:
        sections.append("\n".join(current))
    pictures = list(ch.images)
    blocks: list[tuple[str, object]] = []
    for i, sec in enumerate(sections):
        blocks.append(("text", sec))
        if i < len(pictures) and not sec.lstrip().startswith("## Meine Einschätzung"):
            blocks.append(("image", pictures[i]))
    used = sum(1 for b in blocks if b[0] == "image")
    blocks.extend(("image", p) for p in pictures[used:])
    return blocks


@router.get("/chapters/{cid}")
def chapter_detail(cid: int, request: Request, db: Session = Depends(get_db)):
    ch = get_or_404(db, Chapter, cid)
    return templates.TemplateResponse(
        request,
        "chapter.html",
        {"ch": ch, "blocks": _blocks(ch), "sources": source_service.for_scope(db, "chapter", ch.id)},
    )


def _edit_ctx(db: Session, ch: Chapter, **extra) -> dict:
    srcs = source_service.for_scope(db, "chapter", ch.id)
    used = {ci.image_id for ci in ch.images}
    candidates = db.scalars(select(Image).order_by(Image.year.is_(None), Image.year)).all()
    text = extra.get("draft") or ch.text_md
    unknown = sorted(source_service.referenced_ids(text) - {s.id for s in srcs})
    return {
        "ch": ch,
        "sources": srcs,
        "candidates": [i for i in candidates if i.id not in used],
        "unknown_refs": unknown,
        "draft": None,
        "error": None,
        **extra,
    }


@router.get("/chapters/{cid}/edit")
def chapter_edit(cid: int, request: Request, db: Session = Depends(get_db)):
    ch = get_or_404(db, Chapter, cid)
    return templates.TemplateResponse(request, "chapter_edit.html", _edit_ctx(db, ch))


@router.post("/chapters/{cid}")
def chapter_update(
    cid: int,
    title: str = Form(...),
    number: int = Form(...),
    period_from: str = Form(""),
    period_to: str = Form(""),
    text_md: str = Form(""),
    status: str = Form("draft"),
    db: Session = Depends(get_db),
):
    ch = get_or_404(db, Chapter, cid)
    ch.title, ch.number = title.strip(), number
    ch.period_from, ch.period_to = opt_int(period_from), opt_int(period_to)
    ch.text_md = text_md.strip()
    ch.status = status if status in ("draft", "reviewed") else "draft"
    db.commit()
    return RedirectResponse(f"/chapters/{cid}/edit?saved=1", status_code=303)


@router.post("/chapters/{cid}/draft")
def chapter_draft(cid: int, request: Request, db: Session = Depends(get_db)):
    """Generate a draft from the chapter's sources. Not saved until the user saves the form."""
    ch = get_or_404(db, Chapter, cid)
    srcs = source_service.for_scope(db, "chapter", ch.id)
    if not srcs:
        return templates.TemplateResponse(
            request, "chapter_edit.html",
            _edit_ctx(db, ch, error="Erst Quellen mit Textauszug hinterlegen – ohne Quellen kein Entwurf."),
        )
    key_images = [
        {
            "fotograf": ci.image.photographer.name,
            "titel": ci.image.title,
            "jahr": ci.image.year,
            "bildunterschrift": ci.caption_md,
        }
        for ci in ch.images
    ]
    meta = {"nummer": ch.number, "titel": ch.title, "zeitraum": [ch.period_from, ch.period_to]}
    try:
        result = claude_client.chapter_draft(meta, source_service.format_for_prompt(srcs), key_images)
    except ClaudeError as exc:
        return templates.TemplateResponse(request, "chapter_edit.html", _edit_ctx(db, ch, error=str(exc)))
    return templates.TemplateResponse(request, "chapter_edit.html", _edit_ctx(db, ch, draft=result.output))


@router.post("/chapters/{cid}/images")
def chapter_add_image(
    cid: int, image_id: int = Form(...), caption_md: str = Form(""), db: Session = Depends(get_db)
):
    ch = get_or_404(db, Chapter, cid)
    get_or_404(db, Image, image_id)
    if not db.get(ChapterImage, (cid, image_id)):
        pos = (db.scalar(select(func.max(ChapterImage.position)).where(ChapterImage.chapter_id == cid)) or 0) + 1
        db.add(ChapterImage(chapter_id=ch.id, image_id=image_id, position=pos, caption_md=caption_md.strip()))
        db.commit()
    return RedirectResponse(f"/chapters/{cid}/edit#images", status_code=303)


@router.post("/chapters/{cid}/images/{iid}")
def chapter_update_image(
    cid: int,
    iid: int,
    position: int = Form(0),
    caption_md: str = Form(""),
    remove: str = Form(""),
    db: Session = Depends(get_db),
):
    ci = db.get(ChapterImage, (cid, iid))
    if ci is None:
        raise HTTPException(404)
    if remove:
        db.delete(ci)
    else:
        ci.position, ci.caption_md = position, caption_md.strip()
    db.commit()
    return RedirectResponse(f"/chapters/{cid}/edit#images", status_code=303)


@router.get("/timeline")
def timeline(request: Request, chapter: int | None = None, db: Session = Depends(get_db)):
    q = select(Image).where(Image.year.is_not(None)).order_by(Image.year)
    if chapter:
        q = q.join(ChapterImage, ChapterImage.image_id == Image.id).where(ChapterImage.chapter_id == chapter)
    rows = db.scalars(q).all()
    chapters = db.scalars(select(Chapter).order_by(Chapter.number)).all()

    points = []
    if rows:
        y0 = min(i.year for i in rows)
        y1 = max(i.year for i in rows)
        y0 -= (y0 % 10)
        y1 += 10 - (y1 % 10)
        span = max(1, y1 - y0)
        stack: dict[int, int] = {}
        for img in rows:
            bucket = round((img.year - y0) / span * 40)  # collision buckets ~2.5 % wide
            level = stack.get(bucket, 0)
            stack[bucket] = level + 1
            points.append({"img": img, "left": (img.year - y0) / span * 100, "level": level})
        ticks = [(y, (y - y0) / span * 100) for y in range(y0, y1 + 1, 10 if span <= 120 else 20)]
        height = max(stack.values()) if stack else 1
    else:
        ticks, height = [], 1
    return templates.TemplateResponse(
        request,
        "timeline.html",
        {"points": points, "ticks": ticks, "chapters": chapters, "chapter": chapter, "height": height},
    )
