import json

from sqlalchemy import select

from app import seed
from app.models import Concept, Drill, Image, Photographer, Source
from app.schemas import AnalysisOut
from app.services import claude_client
from app.services import images as image_service
from datetime import date

from .conftest import make_jpeg
from .test_analysis import VALID


def _img(db):
    ph = Photographer(name="P")
    db.add(ph)
    db.flush()
    fp, tp = image_service.store_original(make_jpeg())
    img = Image(photographer_id=ph.id, file_path=fp, thumb_path=tp, source_url="https://e.org", accessed_at=date.today())
    db.add(img)
    db.commit()
    return img


def test_drill_flow_reveals_only_after_answer(client, db, monkeypatch):
    img = _img(db)
    monkeypatch.setattr(claude_client, "analyze_image",
                        lambda *a, **k: claude_client.Result(AnalysisOut.model_validate(VALID), "m", "analysis_v2"))
    seen = {}

    def fake_feedback(mt, b64, label, question, reference, full, answer):
        seen.update(label=label, reference=reference, answer=answer)
        return claude_client.Result("Schau auf die linke Kante.", "m", "drill_feedback_v1")

    monkeypatch.setattr(claude_client, "drill_feedback", fake_feedback)
    r = client.post("/sehen/session", data={"dimension": "light", "size": 3, "look_seconds": 30})
    assert "Woher kommt das Licht" in r.text and "Erst nur schauen" in r.text
    assert VALID["construction"]["light"] not in r.text

    r = client.post(f"/sehen/answer/{img.id}", data={"dimension": "light", "answer": "von links", "looked": 41})
    assert VALID["construction"]["light"] in r.text and "linke Kante" in r.text
    assert seen == {"label": "Licht", "reference": VALID["construction"]["light"], "answer": "von links"}
    d = db.scalar(select(Drill))
    assert d.look_seconds == 41 and d.dimension == "light"


def test_concept_import_rewrites_refs(tmp_path, db, client):
    _img(db)
    f = tmp_path / "content_sehen.json"
    f.write_text(json.dumps({"concepts": [{
        "key": "vantage", "name": "Standpunkt (Vantage Point)", "dimension": "viewpoint",
        "summary_md": "Satz eins [Q1]. Satz zwei [Q2, Q1].", "exercise_md": "Geh höher.",
        "sources": [{"url": "https://moma.org/a", "excerpt": "a"}, {"url": "https://moma.org/b", "excerpt": "b"}],
        "example_images": [{"key": "fehlt", "note": "x"}],
    }]}), encoding="utf-8")
    seed.main([str(f)])
    seed.main([str(f)])
    c = db.scalar(select(Concept))
    ids = [s.id for s in db.scalars(select(Source).where(Source.scope_type == "concept").order_by(Source.id))]
    assert len(ids) == 2
    assert c.summary_md == f"Satz eins [S{ids[0]}]. Satz zwei [S{ids[1]}, S{ids[0]}]."
    page = client.get("/begriffe/vantage").text
    assert "Geh höher." in page and f'href="#source-{ids[0]}"' in page
    assert "Standpunkt" in client.get("/sehen").text


def test_reference_text_reads_stance_and_construction():
    from app.seeing import reference_text

    data = {"construction": {"light": " Seitenlicht "}, "stance": "Distanziert."}
    assert reference_text(data, "light") == "Seitenlicht"
    assert reference_text(data, "stance") == "Distanziert."
    assert reference_text(data, "edge") == ""  # older analyses lack the v3 fields
