"""Generating and displaying analyses (with versioning)."""
from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Image
from app.routes.common import get_or_404
from app.services import analysis as analysis_service
from app.services import sources as source_service
from app.services.claude_client import ClaudeError
from app.web import templates

router = APIRouter()


def _render(request: Request, db: Session, img: Image, error: str | None = None, warnings=None):
    return templates.TemplateResponse(
        request,
        "partials/analysis.html",
        {
            "img": img,
            "analysis": img.current_analysis,
            "sources": source_service.for_image(db, img),
            "error": error,
            "warnings": warnings or [],
        },
    )


@router.post("/images/{iid}/analysis")
def analysis_create(
    iid: int, request: Request, regenerate: str = Form(""), db: Session = Depends(get_db)
):
    img = get_or_404(db, Image, iid)
    try:
        _, warnings = analysis_service.generate(db, img, regenerate=regenerate == "1")
    except ClaudeError as exc:
        return _render(request, db, img, error=str(exc))
    return _render(request, db, img, warnings=warnings)


@router.get("/images/{iid}/analyses")
def analysis_history(iid: int, request: Request, db: Session = Depends(get_db)):
    img = get_or_404(db, Image, iid)
    return templates.TemplateResponse(
        request,
        "analysis_history.html",
        {"img": img, "analyses": list(reversed(img.analyses)), "sources": source_service.for_image(db, img)},
    )
