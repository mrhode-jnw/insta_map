import json
from datetime import date

from app.models import Analysis, Chapter, ChapterImage, Image, Photographer, Project, Source
from app.services import sources as source_service


def _image(db, ph, pr=None):
    img = Image(
        photographer_id=ph.id, project_id=pr.id if pr else None, title="T", file_path="images/a.jpg",
        thumb_path="thumbs/a.jpg", source_url="https://example.org/a", accessed_at=date.today(),
        tags="berge, licht",
    )
    db.add(img)
    db.commit()
    return img


def test_structure_photographer_project_image(db):
    ph = Photographer(name="Carleton Watkins")
    db.add(ph)
    db.flush()
    pr = Project(photographer_id=ph.id, title="Yosemite", year_from=1861, year_to=1866)
    db.add(pr)
    db.commit()
    img = _image(db, ph, pr)
    db.refresh(ph)
    assert img.project.photographer is ph
    assert pr.period == "1861–1866"
    assert img.tag_list == ["berge", "licht"]


def test_sources_for_image_cover_all_scopes(db):
    ph = Photographer(name="X")
    db.add(ph)
    db.flush()
    pr = Project(photographer_id=ph.id, title="P")
    db.add(pr)
    db.commit()
    img = _image(db, ph, pr)
    for scope, sid in (("photographer", ph.id), ("project", pr.id), ("image", img.id), ("chapter", 99)):
        db.add(Source(url=f"https://e.org/{scope}", accessed_at=date.today(), scope_type=scope, scope_id=sid))
    db.commit()
    scopes = {s.scope_type for s in source_service.for_image(db, img)}
    assert scopes == {"photographer", "project", "image"}


def test_current_analysis_respects_replaced_by(db):
    ph = Photographer(name="Y")
    db.add(ph)
    db.commit()
    img = _image(db, ph)
    a1 = Analysis(image_id=img.id, version=1, model="m", prompt_version="analysis_v1", json=json.dumps({"seen": "a"}))
    db.add(a1)
    db.flush()
    a2 = Analysis(image_id=img.id, version=2, model="m", prompt_version="analysis_v1", json=json.dumps({"seen": "b"}))
    db.add(a2)
    db.flush()
    a1.replaced_by = a2.id
    db.commit()
    db.refresh(img)
    assert img.current_analysis.version == 2
    assert len(img.analyses) == 2


def test_chapter_images_ordering(db):
    ph = Photographer(name="Z")
    db.add(ph)
    db.commit()
    i1, i2 = _image(db, ph), _image(db, ph)
    ch = Chapter(number=1, title="K")
    db.add(ch)
    db.flush()
    db.add_all([ChapterImage(chapter_id=ch.id, image_id=i2.id, position=1), ChapterImage(chapter_id=ch.id, image_id=i1.id, position=2)])
    db.commit()
    db.refresh(ch)
    assert [ci.image_id for ci in ch.images] == [i2.id, i1.id]


def test_source_reference_helpers():
    assert source_service.referenced_ids("a [S3] b [S4, S7] c [S8,9]") == {3, 4, 7, 8, 9}
    html = str(source_service.render_md("Satz [S12]."))
    assert 'href="#source-12"' in html
    assert "<script>" not in str(source_service.render_md("<script>x</script>"))
