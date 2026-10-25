"""Creating and versioning analyses."""
import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Analysis, Image
from app.schemas import enforce_sources
from app.services import claude_client, images, sources


def image_metadata(image: Image) -> dict:
    return {
        "fotograf": image.photographer.name,
        "projekt": image.project.title if image.project else None,
        "titel": image.title or None,
        "jahr": image.year,
        "ort": image.location or None,
        "quelle": image.source_url,
    }


def generate(db: Session, image: Image, regenerate: bool = False) -> tuple[Analysis, list[str]]:
    """Create the first analysis, or (only on explicit request) a new version that justifies deviations."""
    current = image.current_analysis
    if current is not None and not regenerate:
        return current, []

    srcs = sources.for_image(db, image)
    media_type, b64 = images.for_api(image.file_path)
    result = claude_client.analyze_image(
        media_type,
        b64,
        image_metadata(image),
        sources.format_for_prompt(srcs),
        previous=current.data if current is not None else None,
    )
    cleaned, warnings = enforce_sources(result.output, {s.id for s in srcs})
    payload = cleaned.model_dump()
    if warnings:
        payload["warnings"] = warnings

    version = (db.scalar(select(func.max(Analysis.version)).where(Analysis.image_id == image.id)) or 0) + 1
    new = Analysis(
        image_id=image.id,
        version=version,
        model=result.model,
        prompt_version=result.prompt_version,
        json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(new)
    db.flush()
    if current is not None:
        current.replaced_by = new.id
    db.commit()
    db.refresh(image)
    return new, warnings
