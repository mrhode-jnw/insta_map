"""Shared template environment."""
from fastapi.templating import Jinja2Templates

from app.config import BASE_DIR, settings
from app.services.sources import render_md

templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))
templates.env.globals["md"] = render_md
templates.env.globals["model_name"] = settings.anthropic_model
templates.env.globals["api_configured"] = bool(settings.anthropic_api_key)

QUESTIONS = [
    ("q_position", "Wo stand der Fotograf?"),
    ("q_wait", "Worauf hat er gewartet?"),
    ("q_omitted", "Was ist weggelassen?"),
    ("q_different", "Was hättest du anders gemacht?"),
]
templates.env.globals["QUESTIONS"] = QUESTIONS

CONSTRUCTION_LABELS = [
    ("viewpoint", "Standpunkt"),
    ("distance_focal_estimate", "Distanz / Brennweite (Schätzung)"),
    ("light", "Licht und Tageszeit"),
    ("moment", "Moment"),
    ("layers", "Ebenen"),
    ("color", "Farbe / Tonwerte"),
    ("omitted", "Weggelassen"),
]
templates.env.globals["CONSTRUCTION_LABELS"] = CONSTRUCTION_LABELS

from app.seeing import BY_KEY as _DIMS  # noqa: E402

templates.env.filters["dimlabel"] = lambda key: _DIMS[key].label if key in _DIMS else key


def _today_iso() -> str:
    from datetime import date

    return date.today().isoformat()


templates.env.globals["today_iso"] = _today_iso
