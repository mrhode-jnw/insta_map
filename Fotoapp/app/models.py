"""ORM models for stage 1."""
import json
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

SCOPE_TYPES = ("photographer", "project", "image", "chapter", "concept")


class Photographer(Base):
    __tablename__ = "photographers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    born: Mapped[int | None] = mapped_column(Integer)
    died: Mapped[int | None] = mapped_column(Integer)
    bio_md: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    projects: Mapped[list["Project"]] = relationship(
        back_populates="photographer", order_by="Project.year_from", cascade="all, delete-orphan"
    )
    images: Mapped[list["Image"]] = relationship(back_populates="photographer")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    photographer_id: Mapped[int] = mapped_column(ForeignKey("photographers.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(300))
    year_from: Mapped[int | None] = mapped_column(Integer)
    year_to: Mapped[int | None] = mapped_column(Integer)
    description_md: Mapped[str] = mapped_column(Text, default="")

    photographer: Mapped[Photographer] = relationship(back_populates="projects")
    images: Mapped[list["Image"]] = relationship(back_populates="project", order_by="Image.year")

    @property
    def period(self) -> str:
        if self.year_from and self.year_to and self.year_from != self.year_to:
            return f"{self.year_from}–{self.year_to}"
        return str(self.year_from or self.year_to or "")


class Image(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    photographer_id: Mapped[int] = mapped_column(ForeignKey("photographers.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(300), default="")
    year: Mapped[int | None] = mapped_column(Integer)
    location: Mapped[str] = mapped_column(String(300), default="")
    file_path: Mapped[str] = mapped_column(String(500))
    thumb_path: Mapped[str] = mapped_column(String(500))
    source_url: Mapped[str] = mapped_column(String(1000))
    image_url: Mapped[str] = mapped_column(String(1000), default="")
    accessed_at: Mapped[date] = mapped_column(Date)
    tags: Mapped[str] = mapped_column(String(500), default="")

    photographer: Mapped[Photographer] = relationship(back_populates="images")
    project: Mapped[Project | None] = relationship(back_populates="images")
    analyses: Mapped[list["Analysis"]] = relationship(
        back_populates="image", order_by="Analysis.version", cascade="all, delete-orphan"
    )

    @property
    def tag_list(self) -> list[str]:
        return [t.strip() for t in self.tags.split(",") if t.strip()]

    @property
    def current_analysis(self) -> "Analysis | None":
        current = [a for a in self.analyses if a.replaced_by is None]
        return current[-1] if current else None


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str] = mapped_column(String(500), default="")
    excerpt: Mapped[str] = mapped_column(Text, default="")
    accessed_at: Mapped[date] = mapped_column(Date)
    scope_type: Mapped[str] = mapped_column(String(20))
    scope_id: Mapped[int] = mapped_column(Integer)


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(primary_key=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("images.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    model: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(100))
    json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    replaced_by: Mapped[int | None] = mapped_column(ForeignKey("analyses.id"))

    image: Mapped[Image] = relationship(back_populates="analyses")

    @property
    def data(self) -> dict:
        return json.loads(self.json)


class Answer(Base):
    __tablename__ = "answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("images.id", ondelete="CASCADE"))
    analysis_id: Mapped[int | None] = mapped_column(ForeignKey("analyses.id"))
    q_position: Mapped[str] = mapped_column(Text, default="")
    q_wait: Mapped[str] = mapped_column(Text, default="")
    q_omitted: Mapped[str] = mapped_column(Text, default="")
    q_different: Mapped[str] = mapped_column(Text, default="")
    feedback_md: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    image: Mapped[Image] = relationship()


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)
    title: Mapped[str] = mapped_column(String(300))
    period_from: Mapped[int | None] = mapped_column(Integer)
    period_to: Mapped[int | None] = mapped_column(Integer)
    text_md: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")

    images: Mapped[list["ChapterImage"]] = relationship(
        back_populates="chapter", order_by="ChapterImage.position", cascade="all, delete-orphan"
    )


class ChapterImage(Base):
    __tablename__ = "chapter_images"

    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), primary_key=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("images.id", ondelete="CASCADE"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    caption_md: Mapped[str] = mapped_column(Text, default="")

    chapter: Mapped[Chapter] = relationship(back_populates="images")
    image: Mapped[Image] = relationship()


class Drill(Base):
    """One focused seeing exercise: a single dimension of one image."""

    __tablename__ = "drills"

    id: Mapped[int] = mapped_column(primary_key=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("images.id", ondelete="CASCADE"))
    analysis_id: Mapped[int | None] = mapped_column(ForeignKey("analyses.id"))
    dimension: Mapped[str] = mapped_column(String(30))
    look_seconds: Mapped[int] = mapped_column(Integer, default=0)
    answer: Mapped[str] = mapped_column(Text, default="")
    feedback_md: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    image: Mapped[Image] = relationship()


class Concept(Base):
    """A sourced term of seeing (e.g. Szarkowski's vantage point)."""

    __tablename__ = "concepts"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    dimension: Mapped[str] = mapped_column(String(30), default="")
    summary_md: Mapped[str] = mapped_column(Text, default="")
    exercise_md: Mapped[str] = mapped_column(Text, default="")

    images: Mapped[list["ConceptImage"]] = relationship(
        back_populates="concept", order_by="ConceptImage.position", cascade="all, delete-orphan"
    )


class ConceptImage(Base):
    __tablename__ = "concept_images"

    concept_id: Mapped[int] = mapped_column(ForeignKey("concepts.id", ondelete="CASCADE"), primary_key=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("images.id", ondelete="CASCADE"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    note_md: Mapped[str] = mapped_column(Text, default="")

    concept: Mapped[Concept] = relationship(back_populates="images")
    image: Mapped[Image] = relationship()
