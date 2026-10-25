"""Calls to the Claude API: image analysis, learning feedback, chapter drafts."""
import json
from dataclasses import dataclass

import anthropic

from app.config import PROMPTS_DIR, settings
from app.schemas import AnalysisOut, AnalysisRevisionOut

ANALYSIS_PROMPT = "analysis_v3"
REVISION_PROMPT = "analysis_revision_v1"
FEEDBACK_PROMPT = "learn_feedback_v3"
CHAPTER_PROMPT = "chapter_draft_v3"
DRILL_PROMPT = "drill_feedback_v1"


class ClaudeError(Exception):
    pass


@dataclass
class Result:
    output: object
    model: str
    prompt_version: str


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def _client() -> anthropic.Anthropic:
    if not settings.anthropic_api_key:
        raise ClaudeError("ANTHROPIC_API_KEY fehlt in der .env.")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _common_kwargs() -> dict:
    kwargs: dict = {
        "model": settings.anthropic_model,
        "output_config": {"effort": settings.anthropic_effort},
    }
    if settings.anthropic_fallbacks:
        # Server-side fallback when the model declines (refusal); see .env.example.
        kwargs["betas"] = ["server-side-fallback-2026-07-01"]
        kwargs["fallbacks"] = settings.anthropic_fallbacks
    return kwargs


def _check(response) -> None:
    if response.stop_reason == "refusal":
        raise ClaudeError("Das Modell hat die Anfrage abgelehnt.")
    if response.stop_reason == "max_tokens":
        raise ClaudeError("Antwort wurde abgeschnitten (max_tokens).")


def _call(fn, **kwargs):
    try:
        return fn(**kwargs)
    except anthropic.AuthenticationError as exc:
        raise ClaudeError("API-Key ungültig.") from exc
    except anthropic.NotFoundError as exc:
        raise ClaudeError(f"Modell nicht gefunden: {settings.anthropic_model}") from exc
    except anthropic.RateLimitError as exc:
        raise ClaudeError("Rate-Limit erreicht – bitte später erneut versuchen.") from exc
    except anthropic.APIStatusError as exc:
        raise ClaudeError(f"API-Fehler {exc.status_code}: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise ClaudeError("Keine Verbindung zur Claude API.") from exc


def analyze_image(
    media_type: str,
    image_b64: str,
    metadata: dict,
    sources_block: str,
    previous: dict | None = None,
) -> Result:
    system = load_prompt(ANALYSIS_PROMPT)
    prompt_version = ANALYSIS_PROMPT
    schema = AnalysisOut
    if previous is not None:
        system += "\n\n" + load_prompt(REVISION_PROMPT)
        prompt_version = f"{ANALYSIS_PROMPT}+{REVISION_PROMPT}"
        schema = AnalysisRevisionOut

    text = (
        "<metadata>\n" + json.dumps(metadata, ensure_ascii=False, indent=2) + "\n</metadata>\n\n"
        "<sources>\n" + sources_block + "\n</sources>"
    )
    if previous is not None:
        text += (
            "\n\n<previous_analysis>\n"
            + json.dumps(previous, ensure_ascii=False, indent=2)
            + "\n</previous_analysis>"
        )

    response = _call(
        _client().beta.messages.parse,
        max_tokens=16000,
        system=system,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                    {"type": "text", "text": text},
                ],
            }
        ],
        output_format=schema,
        **_common_kwargs(),
    )
    _check(response)
    if response.parsed_output is None:
        raise ClaudeError("Antwort entsprach nicht dem Analyse-Schema.")
    return Result(response.parsed_output, response.model, prompt_version)


def _text(response) -> str:
    return "".join(b.text for b in response.content if b.type == "text").strip()


def learn_feedback(analysis: dict, answers: dict) -> Result:
    labels = {
        "q_position": "Wo stand der Fotograf?",
        "q_wait": "Worauf hat er gewartet?",
        "q_omitted": "Was ist weggelassen?",
        "q_different": "Was hättest du anders gemacht?",
    }
    answer_text = "\n".join(f"{labels[k]}\n{answers.get(k, '').strip() or '(keine Antwort)'}\n" for k in labels)
    if "extra" in answers:
        label, text = answers["extra"]
        answer_text += f"\n{label}\n{text.strip() or '(keine Antwort)'}\n"
    response = _call(
        _client().beta.messages.create,
        max_tokens=4000,
        system=load_prompt(FEEDBACK_PROMPT),
        messages=[
            {
                "role": "user",
                "content": (
                    "<analysis>\n" + json.dumps(analysis, ensure_ascii=False, indent=2) + "\n</analysis>\n\n"
                    "<answers>\n" + answer_text + "</answers>"
                ),
            }
        ],
        **_common_kwargs(),
    )
    _check(response)
    return Result(_text(response), response.model, FEEDBACK_PROMPT)


def chapter_draft(chapter_meta: dict, sources_block: str, key_images: list[dict]) -> Result:
    response = _call(
        _client().beta.messages.create,
        max_tokens=16000,
        system=load_prompt(CHAPTER_PROMPT),
        messages=[
            {
                "role": "user",
                "content": (
                    "<chapter>\n" + json.dumps(chapter_meta, ensure_ascii=False, indent=2) + "\n</chapter>\n\n"
                    "<key_images>\n" + json.dumps(key_images, ensure_ascii=False, indent=2) + "\n</key_images>\n\n"
                    "<sources>\n" + sources_block + "\n</sources>"
                ),
            }
        ],
        **_common_kwargs(),
    )
    _check(response)
    return Result(_text(response), response.model, CHAPTER_PROMPT)


def drill_feedback(
    media_type: str,
    image_b64: str,
    dimension_label: str, question: str, reference: str, full_analysis: dict, answer: str) -> Result:
    response = _call(
        _client().beta.messages.create,
        max_tokens=4000,
        system=load_prompt(DRILL_PROMPT),
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                    {"type": "text", "text": (
                    f"<dimension>{dimension_label}</dimension>\n<question>{question}</question>\n\n"
                    f"<reference>{reference}</reference>\n\n"
                    "<full_analysis>\n" + json.dumps(full_analysis, ensure_ascii=False, indent=2) + "\n</full_analysis>\n\n"
                    f"<answer>{answer.strip() or '(keine Antwort)'}</answer>"
                    )},
                ],
            }
        ],
        **_common_kwargs(),
    )
    _check(response)
    return Result(_text(response), response.model, DRILL_PROMPT)
