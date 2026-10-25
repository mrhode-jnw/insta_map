"""Pydantic schema of the analysis JSON and its validation against provided sources."""
from pydantic import BaseModel, Field


class Construction(BaseModel):
    viewpoint: str = ""
    distance_focal_estimate: str = ""
    light: str = ""
    moment: str = ""
    layers: str = ""
    color: str = ""
    omitted: str = ""
    edge: str = ""
    detail: str = ""
    focus_plane: str = ""


class SourcedStatement(BaseModel):
    text: str
    source_ids: list[int] = Field(default_factory=list)


class Context(BaseModel):
    sourced: list[SourcedStatement] = Field(default_factory=list)
    assessment: str = ""


class Deviation(BaseModel):
    field: str
    reason: str


class AnalysisOut(BaseModel):
    seen: str = ""
    construction: Construction = Field(default_factory=Construction)
    context: Context = Field(default_factory=Context)
    stance: str = ""
    transferable: list[str] = Field(default_factory=list)
    not_assessable: str = ""


class AnalysisRevisionOut(AnalysisOut):
    """Used when regenerating: every deviation from the previous version must be justified."""

    deviations: list[Deviation] = Field(default_factory=list)


def enforce_sources(analysis: AnalysisOut, allowed_ids: set[int]) -> tuple[AnalysisOut, list[str]]:
    """Drop sourced statements without a valid source reference. Returns the cleaned analysis and warnings."""
    kept: list[SourcedStatement] = []
    warnings: list[str] = []
    for st in analysis.context.sourced:
        ids = [i for i in st.source_ids if i in allowed_ids]
        if not ids:
            warnings.append(f"Aussage ohne gültige Quelle entfernt: „{st.text[:80]}…“")
            continue
        if len(ids) != len(st.source_ids):
            warnings.append(f"Ungültige Quellen-IDs entfernt bei: „{st.text[:80]}…“")
        kept.append(SourcedStatement(text=st.text, source_ids=ids))
    analysis.context.sourced = kept
    analysis.transferable = [t for t in analysis.transferable if t.strip()][:4]
    return analysis, warnings
