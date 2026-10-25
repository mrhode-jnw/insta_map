import json

from sqlalchemy import func, select

from app import seed
from app.models import Chapter, ChapterImage, Image, Photographer, Source
from app.services import images as image_service

from .conftest import make_jpeg


def _write(tmp_path, name, data):
    p = tmp_path / name
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def test_seed_is_idempotent_and_merges(tmp_path, db, monkeypatch):
    colors = iter(range(10, 250, 7))
    monkeypatch.setattr(image_service, "download", lambda url, timeout=60.0: make_jpeg((300, 200), (next(colors), 0, 0)))
    monkeypatch.setattr(seed.time, "sleep", lambda s: None)
    page = "https://gallery.example/series"  # two images share one series page
    first = _write(tmp_path, "content_ch1-3.json", {
        "accessed_at": "2026-10-25",
        "photographers": [{"key": "a", "name": "A", "sources": [{"url": "https://e.org/a", "excerpt": "x"}],
            "projects": [{"key": "a-p", "title": "P", "sources": [], "images": [
                {"key": "a-1", "title": "Eins", "source_url": page, "image_url": "https://img/1.jpg", "tags": ["Berge"]},
                {"key": "a-2", "title": "Zwei", "source_url": page, "image_url": "https://img/2.jpg", "tags": []},
            ]}]}],
        "chapters": [{"number": 1, "title": "K1", "sources": [{"url": "https://e.org/k", "excerpt": "y"}],
                      "key_images": ["a-1", "a-2", "a-1"]}],
    })
    upgrade = _write(tmp_path, "content_upgrade.json", {
        "photographers": [{"name": "A", "born": 1900, "sources": [{"url": "https://e.org/a2", "excerpt": "z"}], "projects": []}],
        "chapters": [{"number": 1, "title": "K1", "key_images": ["a-2"]}],
    })
    seed.main([str(first), str(upgrade)])
    seed.main([str(first), str(upgrade)])

    assert db.scalar(select(func.count(Image.id))) == 2
    assert db.scalar(select(func.count(Photographer.id))) == 1
    assert db.scalar(select(Photographer)).born == 1900
    assert db.scalar(select(func.count(Source.id))) == 3
    ch = db.scalar(select(Chapter).where(Chapter.number == 1))
    assert db.scalar(select(func.count()).select_from(ChapterImage).where(ChapterImage.chapter_id == ch.id)) == 2
    assert db.scalar(select(func.count(Chapter.id))) == 11  # all proposed chapters exist
