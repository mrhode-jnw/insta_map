from sqlalchemy import select

from app.config import settings
from app.models import Image, Photographer, Project
from app.services import images as image_service

from .conftest import make_jpeg


def test_upload_creates_image_thumb_and_entities(client, db):
    data = make_jpeg()
    r = client.post(
        "/images",
        data={
            "source_url": "https://museum.example/obj/1",
            "photographer": "Timothy H. O'Sullivan",
            "project": "Wheeler Survey",
            "title": "Canyon",
            "year": "1873",
            "tags": "Landschaft, Schwarzweiß, landschaft",
        },
        files={"upload": ("c.jpg", data, "image/jpeg")},
        follow_redirects=False,
    )
    assert r.status_code == 303
    img = db.scalar(select(Image))
    assert img.year == 1873
    assert img.tags == "landschaft, schwarzweiß"
    assert img.project.title == "Wheeler Survey"
    assert db.scalar(select(Photographer)).name == "Timothy H. O'Sullivan"
    original = settings.data_dir / img.file_path
    assert original.read_bytes() == data  # original stored unchanged
    from PIL import Image as PILImage

    with PILImage.open(settings.data_dir / img.thumb_path) as t:
        assert max(t.size) <= image_service.THUMB_LONG_EDGE
    assert client.get(f"/images/{img.id}").status_code == 200
    assert client.get(f"/media/{img.thumb_path}").status_code == 200


def test_import_by_url(client, db, monkeypatch):
    monkeypatch.setattr(image_service, "download", lambda url, timeout=60.0: make_jpeg((800, 600)))
    r = client.post(
        "/images",
        data={"source_url": "https://e.org/p", "image_url": "https://e.org/i.jpg", "photographer": "A"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    img = db.scalar(select(Image))
    assert img.image_url == "https://e.org/i.jpg"
    assert img.project_id is None


def test_import_rejects_non_image(client, db):
    r = client.post(
        "/images",
        data={"source_url": "https://e.org/p", "photographer": "A"},
        files={"upload": ("x.jpg", b"not an image", "image/jpeg")},
    )
    assert r.status_code == 400
    assert db.scalar(select(Image)) is None


def test_api_image_is_scaled():
    fp, _ = image_service.store_original(make_jpeg((4000, 3000)))
    media_type, b64 = image_service.for_api(fp)
    import base64
    import io

    from PIL import Image as PILImage

    with PILImage.open(io.BytesIO(base64.b64decode(b64))) as im:
        assert max(im.size) == image_service.API_LONG_EDGE
    assert media_type == "image/jpeg"


def test_source_requires_url(client, db):
    ph = Photographer(name="B")
    db.add(ph)
    db.commit()
    r = client.post("/sources", data={"scope_type": "photographer", "scope_id": ph.id, "url": "keine-url"})
    assert r.status_code == 400
    r = client.post(
        "/sources",
        data={"scope_type": "photographer", "scope_id": ph.id, "url": "https://e.org", "excerpt": "Zitat"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    page = client.get(f"/photographers/{ph.id}").text
    assert "Zitat" in page
