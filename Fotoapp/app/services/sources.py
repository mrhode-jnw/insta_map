"""Collecting sources for a scope and rendering source references."""
import re

from markupsafe import Markup, escape
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

import markdown as md_lib

from app.models import Image, Source

SOURCE_REF = re.compile(r"\[S(\d+)(?:\s*,\s*S?(\d+))*\]")
SOURCE_ID = re.compile(r"S?(\d+)")


def for_scope(db: Session, scope_type: str, scope_id: int) -> list[Source]:
    return list(
        db.scalars(
            select(Source)
            .where(Source.scope_type == scope_type, Source.scope_id == scope_id)
            .order_by(Source.id)
        )
    )


def for_image(db: Session, image: Image) -> list[Source]:
    """All sources relevant to an image: the image's own, its project's and its photographer's."""
    conds = [
        (Source.scope_type == "image") & (Source.scope_id == image.id),
        (Source.scope_type == "photographer") & (Source.scope_id == image.photographer_id),
    ]
    if image.project_id:
        conds.append((Source.scope_type == "project") & (Source.scope_id == image.project_id))
    return list(db.scalars(select(Source).where(or_(*conds)).order_by(Source.id)))


def format_for_prompt(sources: list[Source]) -> str:
    if not sources:
        return "(Keine Quellen hinterlegt.)"
    parts = []
    for s in sources:
        parts.append(
            f'<source id="{s.id}" scope="{s.scope_type}" url="{s.url}" title="{s.title}">\n'
            f"{s.excerpt.strip()}\n</source>"
        )
    return "\n".join(parts)


def referenced_ids(text: str) -> set[int]:
    ids: set[int] = set()
    for m in re.finditer(r"\[(S\d+(?:\s*,\s*S?\d+)*)\]", text):
        ids.update(int(x) for x in SOURCE_ID.findall(m.group(1)))
    return ids


def link_refs(html: str) -> str:
    """Turn [S12] / [S12, S14] into anchor links to #source-<id>."""

    def repl(m: re.Match) -> str:
        ids = SOURCE_ID.findall(m.group(1))
        links = ", ".join(f'<a class="ref" href="#source-{i}">S{i}</a>' for i in ids)
        return f"[{links}]"

    return re.sub(r"\[(S\d+(?:\s*,\s*S?\d+)*)\]", repl, html)


def render_md(text: str) -> Markup:
    """Render trusted local markdown (escaped first) and link source references."""
    html = md_lib.markdown(str(escape(text or "")), extensions=["extra", "sane_lists"])
    return Markup(link_refs(html))
