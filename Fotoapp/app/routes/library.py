"""Library: photographers, projects, images and sources."""
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import SCOPE_TYPES, Analysis, Answer, Chapter, ChapterImage, Image, Photographer, Project, Source
from app.routes.common import (
    get_or_404,
    normalize_tags,
    opt_int,
    parse_date,
    photographer_by_name,
    project_by_title,
)
from app.services import images as image_service
from app.services import sources as source_service
from app.web import templates

router = APIRouter()


@router.get("/")
def home(request: Request, db: Session = Depends(get_db)):
    counts = {
        "photographers": db.scalar(select(func.count(Photographer.id))),
        "images": db.scalar(select(func.count(Image.id))),
        "analyses": db.scalar(select(func.count(Analysis.id)).where(Analysis.replaced_by.is_(None))),
        "answers": db.scalar(select(func.count(Answer.id))),
        "chapters": db.scalar(select(func.count(Chapter.id))),
    }
    recent = db.scalars(select(Image).order_by(Image.id.desc()).limit(12)).all()
    chapters = db.scalars(select(Chapter).order_by(Chapter.number)).all()
    return templates.TemplateResponse(
        request, "home.html", {"counts": counts, "recent": recent, "chapters": chapters}
    )


# --- Photographers -----------------------------------------------------------


@router.get("/photographers")
def photographer_list(request: Request, db: Session = Depends(get_db)):
    rows = db.scalars(select(Photographer).order_by(Photographer.name)).all()
    return templates.TemplateResponse(request, "photographers.html", {"photographers": rows})


@router.post("/photographers")
def photographer_create(
    name: str = Form(...),
    born: str = Form(""),
    died: str = Form(""),
    db: Session = Depends(get_db),
):
    ph = photographer_by_name(db, name)
    ph.born, ph.died = opt_int(born), opt_int(died)
    db.commit()
    return RedirectResponse(f"/photographers/{ph.id}", status_code=303)


@router.get("/photographers/{pid}")
def photographer_detail(pid: int, request: Request, db: Session = Depends(get_db)):
    ph = get_or_404(db, Photographer, pid)
    return templates.TemplateResponse(
        request,
        "photographer.html",
        {
            "ph": ph,
            "sources": source_service.for_scope(db, "photographer", ph.id),
            "loose_images": [i for i in ph.images if i.project_id is None],
        },
    )


@router.post("/photographers/{pid}")
def photographer_update(
    pid: int,
    name: str = Form(...),
    born: str = Form(""),
    died: str = Form(""),
    bio_md: str = Form(""),
    db: Session = Depends(get_db),
):
    ph = get_or_404(db, Photographer, pid)
    ph.name, ph.born, ph.died, ph.bio_md = name.strip(), opt_int(born), opt_int(died), bio_md.strip()
    db.commit()
    return RedirectResponse(f"/photographers/{pid}", status_code=303)


# --- Projects ----------------------------------------------------------------


@router.post("/projects")
def project_create(
    photographer_id: int = Form(...),
    title: str = Form(...),
    year_from: str = Form(""),
    year_to: str = Form(""),
    db: Session = Depends(get_db),
):
    ph = get_or_404(db, Photographer, photographer_id)
    pr = project_by_title(db, ph, title)
    if pr is None:
        raise HTTPException(400, "Titel fehlt")
    pr.year_from, pr.year_to = opt_int(year_from), opt_int(year_to)
    db.commit()
    return RedirectResponse(f"/projects/{pr.id}", status_code=303)


@router.get("/projects/{pid}")
def project_detail(pid: int, request: Request, db: Session = Depends(get_db)):
    pr = get_or_404(db, Project, pid)
    return templates.TemplateResponse(
        request, "project.html", {"pr": pr, "sources": source_service.for_scope(db, "project", pr.id)}
    )


@router.post("/projects/{pid}")
def project_update(
    pid: int,
    title: str = Form(...),
    year_from: str = Form(""),
    year_to: str = Form(""),
    description_md: str = Form(""),
    db: Session = Depends(get_db),
):
    pr = get_or_404(db, Project, pid)
    pr.title, pr.year_from, pr.year_to = title.strip(), opt_int(year_from), opt_int(year_to)
    pr.description_md = description_md.strip()
    db.commit()
    return RedirectResponse(f"/projects/{pid}", status_code=303)


# --- Images ------------------------------------------------------------------


@router.get("/images")
def image_list(
    request: Request,
    tag: str = "",
    photographer: int | None = None,
    db: Session = Depends(get_db),
):
    q = select(Image).order_by(Image.year.is_(None), Image.year, Image.id)
    if photographer:
        q = q.where(Image.photographer_id == photographer)
    rows = db.scalars(q).all()
    if tag:
        rows = [i for i in rows if tag in i.tag_list]
    all_tags = sorted({t for i in db.scalars(select(Image)).all() for t in i.tag_list})
    return templates.TemplateResponse(
        request, "images.html", {"images": rows, "tag": tag, "all_tags": all_tags}
    )


def _form_context(db: Session) -> dict:
    return {
        "photographers": db.scalars(select(Photographer).order_by(Photographer.name)).all(),
        "projects": db.scalars(select(Project).order_by(Project.title)).all(),
        "today": date.today().isoformat(),
    }


@router.get("/images/new")
def image_new(request: Request, photographer: str = "", project: str = "", db: Session = Depends(get_db)):
    ctx = _form_context(db) | {"error": None, "values": {"photographer": photographer, "project": project}}
    return templates.TemplateResponse(request, "image_form.html", ctx)


@router.post("/images")
async def image_create(
    request: Request,
    source_url: str = Form(...),
    image_url: str = Form(""),
    upload: UploadFile | None = File(None),
    photographer: str = Form(...),
    project: str = Form(""),
    title: str = Form(""),
    year: str = Form(""),
    location: str = Form(""),
    tags: str = Form(""),
    accessed_at: str = Form(""),
    db: Session = Depends(get_db),
):
    values = dict(
        source_url=source_url, image_url=image_url, photographer=photographer, project=project,
        title=title, year=year, location=location, tags=tags, accessed_at=accessed_at,
    )
    try:
        data = await upload.read() if upload is not None and upload.filename else b""
        if not data:
            if not image_url.strip():
                raise image_service.ImageImportError("Bitte Bild-URL angeben oder eine Datei hochladen.")
            data = image_service.download(image_url.strip())
        file_path, thumb_path = image_service.store_original(data)
    except image_service.ImageImportError as exc:
        ctx = _form_context(db) | {"error": str(exc), "values": values}
        return templates.TemplateResponse(request, "image_form.html", ctx, status_code=400)

    ph = photographer_by_name(db, photographer)
    pr = project_by_title(db, ph, project)
    img = Image(
        photographer_id=ph.id,
        project_id=pr.id if pr else None,
        title=title.strip(),
        year=opt_int(year),
        location=location.strip(),
        file_path=file_path,
        thumb_path=thumb_path,
        source_url=source_url.strip(),
        image_url=image_url.strip(),
        accessed_at=parse_date(accessed_at),
        tags=normalize_tags(tags),
    )
    db.add(img)
    db.commit()
    return RedirectResponse(f"/images/{img.id}", status_code=303)


@router.get("/images/{iid}")
def image_detail(iid: int, request: Request, db: Session = Depends(get_db)):
    img = get_or_404(db, Image, iid)
    chapters = db.scalars(select(Chapter).order_by(Chapter.number)).all()
    in_chapters = db.scalars(
        select(Chapter).join(ChapterImage).where(ChapterImage.image_id == iid).order_by(Chapter.number)
    ).all()
    return templates.TemplateResponse(
        request,
        "image.html",
        {
            "img": img,
            "sources": source_service.for_image(db, img),
            "own_sources": source_service.for_scope(db, "image", img.id),
            "analysis": img.current_analysis,
            "chapters": chapters,
            "in_chapters": in_chapters,
            **_form_context(db),
        },
    )


@router.post("/images/{iid}")
def image_update(
    iid: int,
    photographer: str = Form(...),
    project: str = Form(""),
    title: str = Form(""),
    year: str = Form(""),
    location: str = Form(""),
    tags: str = Form(""),
    source_url: str = Form(...),
    db: Session = Depends(get_db),
):
    img = get_or_404(db, Image, iid)
    ph = photographer_by_name(db, photographer)
    pr = project_by_title(db, ph, project)
    img.photographer_id, img.project_id = ph.id, pr.id if pr else None
    img.title, img.year, img.location = title.strip(), opt_int(year), location.strip()
    img.tags, img.source_url = normalize_tags(tags), source_url.strip()
    db.commit()
    return RedirectResponse(f"/images/{iid}", status_code=303)


@router.post("/images/{iid}/delete")
def image_delete(iid: int, db: Session = Depends(get_db)):
    img = get_or_404(db, Image, iid)
    paths = (img.file_path, img.thumb_path)
    for s in source_service.for_scope(db, "image", iid):
        db.delete(s)
    db.delete(img)
    db.commit()
    still_used = db.scalar(select(func.count(Image.id)).where(Image.file_path == paths[0]))
    if not still_used:
        image_service.delete_files(*paths)
    return RedirectResponse("/images", status_code=303)


# --- Sources -----------------------------------------------------------------


SCOPE_URL = {"photographer": "/photographers/{}", "project": "/projects/{}", "image": "/images/{}", "chapter": "/chapters/{}"}


@router.post("/sources")
def source_create(
    scope_type: str = Form(...),
    scope_id: int = Form(...),
    url: str = Form(...),
    title: str = Form(""),
    excerpt: str = Form(""),
    accessed_at: str = Form(""),
    db: Session = Depends(get_db),
):
    if scope_type not in SCOPE_TYPES:
        raise HTTPException(400, "Ungültiger Bereich")
    if not url.strip().startswith(("http://", "https://")):
        raise HTTPException(400, "Quelle braucht eine URL")
    db.add(
        Source(
            scope_type=scope_type,
            scope_id=scope_id,
            url=url.strip(),
            title=title.strip(),
            excerpt=excerpt.strip(),
            accessed_at=parse_date(accessed_at),
        )
    )
    db.commit()
    return RedirectResponse(SCOPE_URL[scope_type].format(scope_id) + "#sources", status_code=303)


@router.post("/sources/{sid}/delete")
def source_delete(sid: int, db: Session = Depends(get_db)):
    s = get_or_404(db, Source, sid)
    target = SCOPE_URL[s.scope_type].format(s.scope_id) + "#sources"
    db.delete(s)
    db.commit()
    return RedirectResponse(target, status_code=303)
