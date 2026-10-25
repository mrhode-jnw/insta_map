import json
from datetime import date

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models import Analysis, Answer, Image, Photographer, Source
from app.schemas import AnalysisOut, AnalysisRevisionOut, enforce_sources
from app.services import analysis as analysis_service
from app.services import claude_client, images as image_service

from .conftest import make_jpeg

VALID = {
    "seen": "Ein Canyon, links eine Felswand.",
    "construction": {
        "viewpoint": "Vom Talboden.",
        "distance_focal_estimate": "Vermutlich Normalbrennweite.",
        "light": "Seitenlicht.",
        "moment": "",
        "layers": "",
        "color": "",
        "omitted": "",
    },
    "context": {"sourced": [{"text": "Aufgenommen 1873.", "source_ids": [1]}], "assessment": "Wirkt nüchtern."},
    "transferable": ["Näher an die Wand.", "Auf Seitenlicht warten."],
}


def test_schema_accepts_valid_json():
    a = AnalysisOut.model_validate(VALID)
    assert a.context.sourced[0].source_ids == [1]


def test_schema_rejects_wrong_types():
    bad = json.loads(json.dumps(VALID))
    bad["context"]["sourced"] = [{"text": "x", "source_ids": "eins"}]
    with pytest.raises(ValidationError):
        AnalysisOut.model_validate(bad)
    with pytest.raises(ValidationError):
        AnalysisOut.model_validate({**VALID, "transferable": "kein Array"})


def test_enforce_sources_drops_unsourced_statements():
    a = AnalysisOut.model_validate(
        {**VALID, "context": {"sourced": [
            {"text": "belegt", "source_ids": [1, 99]},
            {"text": "erfunden", "source_ids": [42]},
            {"text": "ohne", "source_ids": []},
        ], "assessment": ""}}
    )
    cleaned, warnings = enforce_sources(a, {1})
    assert [s.text for s in cleaned.context.sourced] == ["belegt"]
    assert cleaned.context.sourced[0].source_ids == [1]
    assert len(warnings) == 3


def _image(db):
    ph = Photographer(name="P")
    db.add(ph)
    db.flush()
    fp, tp = image_service.store_original(make_jpeg())
    img = Image(photographer_id=ph.id, file_path=fp, thumb_path=tp, source_url="https://e.org", accessed_at=date.today())
    db.add(img)
    db.flush()
    src = Source(url="https://e.org/s", excerpt="1873", accessed_at=date.today(), scope_type="image", scope_id=img.id)
    db.add(src)
    db.commit()
    return img, src


def test_generate_is_stable_and_versioned(db, monkeypatch):
    img, src = _image(db)
    calls = []

    def fake(media_type, b64, meta, sources_block, previous=None):
        calls.append(previous)
        data = json.loads(json.dumps(VALID))
        data["context"]["sourced"][0]["source_ids"] = [src.id]
        if previous is not None:
            data["deviations"] = [{"field": "construction.light", "reason": "Schatten genauer gelesen."}]
            return claude_client.Result(AnalysisRevisionOut.model_validate(data), "test-model", "analysis_v1+rev")
        return claude_client.Result(AnalysisOut.model_validate(data), "test-model", "analysis_v1")

    monkeypatch.setattr(claude_client, "analyze_image", fake)
    a1, _ = analysis_service.generate(db, img)
    again, _ = analysis_service.generate(db, img)
    assert again.id == a1.id and len(calls) == 1  # stored analysis is reused

    a2, _ = analysis_service.generate(db, img, regenerate=True)
    assert calls[1]["seen"] == VALID["seen"]  # previous version passed to the model
    db.refresh(a1)
    assert a1.replaced_by == a2.id and a2.version == 2
    assert a2.data["deviations"][0]["field"] == "construction.light"
    assert db.scalar(select(Analysis).where(Analysis.id == a1.id)) is not None  # old version kept


def test_learn_flow_hides_then_reveals(client, db, monkeypatch):
    img, src = _image(db)

    def fake(media_type, b64, meta, sources_block, previous=None):
        return claude_client.Result(AnalysisOut.model_validate(VALID), "test-model", "analysis_v1")

    monkeypatch.setattr(claude_client, "analyze_image", fake)
    monkeypatch.setattr(claude_client, "learn_feedback", lambda a, ans: claude_client.Result("Gut gesehen.", "m", "f"))

    r = client.post("/learn/session", data={"mode": "random", "size": 3})
    assert r.status_code == 200
    assert "Wo stand der Fotograf?" in r.text
    assert VALID["seen"] not in r.text  # analysis hidden before answering
    assert "Photographer" not in r.text and ">P<" not in r.text

    r = client.post(f"/learn/answer/{img.id}", data={"q_position": "unten", "q_wait": "Licht"})
    assert VALID["seen"] in r.text and "Gut gesehen." in r.text
    ans = db.scalar(select(Answer))
    assert ans.q_position == "unten" and ans.feedback_md == "Gut gesehen." and ans.analysis_id
