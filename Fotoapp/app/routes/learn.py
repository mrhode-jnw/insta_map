"""Learning mode: judge first, then read the analysis."""
import random

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Answer, Chapter, ChapterImage, Image
from app.routes.common import get_or_404
from app.services import analysis as analysis_service
from app.services import claude_client
from app.services import sources as source_service
from app.services.claude_client import ClaudeError
from app.seeing import EXTRA_QUESTIONS
from app.web import QUESTIONS, templates

router = APIRouter(prefix="/learn")


def _extra(answer: Answer) -> dict:
    return {"extra": (answer.q_extra_label, answer.q_extra)} if answer.q_extra_label else {}


@router.get("")
def learn_start(request: Request, db: Session = Depends(get_db)):
    images = db.scalars(select(Image)).all()
    tags = sorted({t for i in images for t in i.tag_list})
    chapters = db.scalars(select(Chapter).order_by(Chapter.number)).all()
    recent = db.scalars(select(Answer).order_by(Answer.id.desc()).limit(10)).all()
    return templates.TemplateResponse(
        request,
        "learn_start.html",
        {"tags": tags, "chapters": chapters, "count": len(images), "recent": recent},
    )


@router.post("/session")
def learn_session(
    request: Request,
    mode: str = Form("random"),
    tag: str = Form(""),
    chapter_id: str = Form(""),
    size: int = Form(4),
    look_seconds: int = Form(60),
    db: Session = Depends(get_db),
):
    pool = db.scalars(select(Image)).all()
    if mode == "tag" and tag:
        pool = [i for i in pool if tag in i.tag_list]
    elif mode == "chapter" and chapter_id.isdigit():
        ids = db.scalars(select(ChapterImage.image_id).where(ChapterImage.chapter_id == int(chapter_id))).all()
        pool = [i for i in pool if i.id in set(ids)]
    # Prefer images not yet answered, then random.
    answered = set(db.scalars(select(Answer.image_id)).all())
    fresh = [i for i in pool if i.id not in answered]
    rest = [i for i in pool if i.id in answered]
    random.shuffle(fresh)
    random.shuffle(rest)
    picked = (fresh + rest)[: max(3, min(5, size))]
    if not picked:
        return RedirectResponse("/learn?empty=1", status_code=303)
    request.session["learn"] = {"ids": [i.id for i in picked], "pos": 0, "look": look_seconds if look_seconds in (0, 30, 60, 90) else 60}
    return RedirectResponse("/learn/current", status_code=303)


@router.get("/current")
def learn_current(request: Request, db: Session = Depends(get_db)):
    state = request.session.get("learn")
    if not state or state["pos"] >= len(state["ids"]):
        return RedirectResponse("/learn/done", status_code=303)
    img = get_or_404(db, Image, state["ids"][state["pos"]])
    return templates.TemplateResponse(
        request,
        "learn_question.html",
        {
            "img": img,
            "pos": state["pos"] + 1,
            "total": len(state["ids"]),
            "look": state.get("look", 0),
            "extra": EXTRA_QUESTIONS[(img.id + state["pos"]) % len(EXTRA_QUESTIONS)][1],
        },
    )


@router.post("/answer/{iid}")
def learn_answer(
    iid: int,
    request: Request,
    q_position: str = Form(""),
    q_wait: str = Form(""),
    q_omitted: str = Form(""),
    q_different: str = Form(""),
    q_extra_label: str = Form(""),
    q_extra: str = Form(""),
    db: Session = Depends(get_db),
):
    img = get_or_404(db, Image, iid)
    answers = {"q_position": q_position, "q_wait": q_wait, "q_omitted": q_omitted, "q_different": q_different}
    answer = Answer(
        image_id=img.id,
        q_extra_label=q_extra_label.strip(),
        q_extra=q_extra.strip(),
        **{k: v.strip() for k, v in answers.items()},
    )
    db.add(answer)
    db.commit()

    error = None
    try:
        analysis, _ = analysis_service.generate(db, img)
        answer.analysis_id = analysis.id
        fb = claude_client.learn_feedback(analysis.data, answers | _extra(answer))
        answer.feedback_md = fb.output
        db.commit()
    except ClaudeError as exc:
        error = str(exc)
    return RedirectResponse(f"/learn/reveal/{answer.id}" + ("?error=1" if error else ""), status_code=303)


@router.get("/reveal/{aid}")
def learn_reveal(aid: int, request: Request, error: str = "", db: Session = Depends(get_db)):
    answer = get_or_404(db, Answer, aid)
    img = answer.image
    state = request.session.get("learn")
    in_session = bool(state and state["pos"] < len(state["ids"]) and state["ids"][state["pos"]] == img.id)
    return templates.TemplateResponse(
        request,
        "learn_reveal.html",
        {
            "img": img,
            "answer": answer,
            "analysis": img.current_analysis,
            "sources": source_service.for_image(db, img),
            "in_session": in_session,
            "pos": (state["pos"] + 1) if in_session else None,
            "total": len(state["ids"]) if in_session else None,
            "error": bool(error),
            "questions": QUESTIONS,
        },
    )


@router.post("/reveal/{aid}/feedback")
def learn_retry_feedback(aid: int, db: Session = Depends(get_db)):
    answer = get_or_404(db, Answer, aid)
    try:
        analysis, _ = analysis_service.generate(db, answer.image)
        answer.analysis_id = analysis.id
        fb = claude_client.learn_feedback(
            analysis.data,
            {k: getattr(answer, k) for k, _ in QUESTIONS} | _extra(answer),
        )
        answer.feedback_md = fb.output
        db.commit()
    except ClaudeError:
        return RedirectResponse(f"/learn/reveal/{aid}?error=1", status_code=303)
    return RedirectResponse(f"/learn/reveal/{aid}", status_code=303)


@router.post("/next")
def learn_next(request: Request):
    state = request.session.get("learn")
    if state:
        state["pos"] += 1
        request.session["learn"] = state
    return RedirectResponse("/learn/current", status_code=303)


@router.get("/done")
def learn_done(request: Request, db: Session = Depends(get_db)):
    state = request.session.pop("learn", None)
    ids = state["ids"] if state else []
    images = [db.get(Image, i) for i in ids]
    return templates.TemplateResponse(request, "learn_done.html", {"images": [i for i in images if i]})


@router.get("/answers")
def learn_answers(request: Request, db: Session = Depends(get_db)):
    rows = db.scalars(select(Answer).order_by(Answer.id.desc())).all()
    return templates.TemplateResponse(request, "learn_answers.html", {"answers": rows})
