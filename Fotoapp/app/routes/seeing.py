"""Learning to see: focused drills per dimension and the sourced vocabulary of seeing."""
import random

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Concept, Drill, Image
from app.routes.common import get_or_404
from app.seeing import BY_KEY, DIMENSIONS, DRILLABLE, LOOK_CHOICES, reference_text
from app.services import analysis as analysis_service
from app.services import claude_client, images as image_service
from app.services import sources as source_service
from app.services.claude_client import ClaudeError
from app.web import templates

router = APIRouter()


def _concepts_by_dimension(db: Session) -> dict[str, list[Concept]]:
    grouped: dict[str, list[Concept]] = {}
    for c in db.scalars(select(Concept).order_by(Concept.name)):
        grouped.setdefault(c.dimension, []).append(c)
    return grouped


@router.get("/sehen")
def seeing_home(request: Request, db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Drill.dimension, func.count(Drill.id)).group_by(Drill.dimension)).all())
    recent = db.scalars(select(Drill).order_by(Drill.id.desc()).limit(8)).all()
    return templates.TemplateResponse(
        request,
        "seeing.html",
        {
            "dimensions": DRILLABLE,
            "all_dimensions": DIMENSIONS,
            "counts": counts,
            "recent": recent,
            "concepts": _concepts_by_dimension(db),
            "look_choices": LOOK_CHOICES,
            "look": request.session.get("look_seconds", 60),
        },
    )


@router.post("/sehen/session")
def drill_session(
    request: Request,
    dimension: str = Form(...),
    size: int = Form(5),
    look_seconds: int = Form(60),
    db: Session = Depends(get_db),
):
    if dimension == "mixed":
        dims = [d.key for d in DRILLABLE]
    elif dimension in BY_KEY and BY_KEY[dimension].analysis_field:
        dims = [dimension]
    else:
        return RedirectResponse("/sehen", status_code=303)
    pool = db.scalars(select(Image)).all()
    # Prefer images not yet drilled in this dimension.
    done = set(db.execute(select(Drill.image_id, Drill.dimension)).all())
    random.shuffle(pool)
    pool.sort(key=lambda i: any((i.id, d) in done for d in dims))
    picked = pool[: max(3, min(8, size))]
    if not picked:
        return RedirectResponse("/sehen", status_code=303)
    look = look_seconds if look_seconds in LOOK_CHOICES else 60
    request.session["look_seconds"] = look
    request.session["drill"] = {
        "items": [[img.id, random.choice(dims)] for img in picked],
        "pos": 0,
        "look": look,
    }
    return RedirectResponse("/sehen/current", status_code=303)


@router.get("/sehen/current")
def drill_current(request: Request, db: Session = Depends(get_db)):
    state = request.session.get("drill")
    if not state or state["pos"] >= len(state["items"]):
        request.session.pop("drill", None)
        return RedirectResponse("/sehen", status_code=303)
    iid, dim = state["items"][state["pos"]]
    img = get_or_404(db, Image, iid)
    return templates.TemplateResponse(
        request,
        "drill_question.html",
        {
            "img": img,
            "dim": BY_KEY[dim],
            "pos": state["pos"] + 1,
            "total": len(state["items"]),
            "look": state["look"],
        },
    )


@router.post("/sehen/answer/{iid}")
def drill_answer(
    iid: int,
    dimension: str = Form(...),
    answer: str = Form(""),
    looked: int = Form(0),
    db: Session = Depends(get_db),
):
    img = get_or_404(db, Image, iid)
    dim = BY_KEY.get(dimension)
    if dim is None or dim.analysis_field is None:
        return RedirectResponse("/sehen", status_code=303)
    drill = Drill(image_id=img.id, dimension=dim.key, answer=answer.strip(), look_seconds=max(0, looked))
    db.add(drill)
    db.commit()
    error = ""
    try:
        analysis, _ = analysis_service.generate(db, img)
        drill.analysis_id = analysis.id
        data = analysis.data
        media_type, b64 = image_service.for_api(img.file_path)
        fb = claude_client.drill_feedback(
            media_type, b64, dim.label, dim.question, reference_text(data, dim.analysis_field), data, drill.answer
        )
        drill.feedback_md = fb.output
        db.commit()
    except ClaudeError:
        error = "?error=1"
    return RedirectResponse(f"/sehen/reveal/{drill.id}{error}", status_code=303)


@router.get("/sehen/reveal/{did}")
def drill_reveal(did: int, request: Request, error: str = "", db: Session = Depends(get_db)):
    drill = get_or_404(db, Drill, did)
    img = drill.image
    dim = BY_KEY[drill.dimension]
    state = request.session.get("drill")
    in_session = bool(
        state and state["pos"] < len(state["items"]) and state["items"][state["pos"]] == [img.id, drill.dimension]
    )
    concepts = db.scalars(select(Concept).where(Concept.dimension == dim.key).order_by(Concept.name)).all()
    return templates.TemplateResponse(
        request,
        "drill_reveal.html",
        {
            "drill": drill,
            "img": img,
            "dim": dim,
            "analysis": img.current_analysis,
            "reference": reference_text(img.current_analysis.data, dim.analysis_field) if img.current_analysis else "",
            "sources": source_service.for_image(db, img),
            "concepts": concepts,
            "in_session": in_session,
            "pos": state["pos"] + 1 if in_session else None,
            "total": len(state["items"]) if in_session else None,
            "error": bool(error),
        },
    )


@router.post("/sehen/next")
def drill_next(request: Request):
    state = request.session.get("drill")
    if state:
        state["pos"] += 1
        request.session["drill"] = state
    return RedirectResponse("/sehen/current", status_code=303)


@router.get("/begriffe")
def concept_list(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(
        request, "concepts.html", {"concepts": _concepts_by_dimension(db), "dimensions": DIMENSIONS}
    )


@router.get("/begriffe/{slug}")
def concept_detail(slug: str, request: Request, db: Session = Depends(get_db)):
    c = db.scalar(select(Concept).where(Concept.slug == slug))
    if c is None:
        return RedirectResponse("/begriffe", status_code=303)
    return templates.TemplateResponse(
        request,
        "concept.html",
        {"c": c, "dim": BY_KEY.get(c.dimension), "sources": source_service.for_scope(db, "concept", c.id)},
    )
