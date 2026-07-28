"""Platform Gemini vision provider for photo-search phase 1 (SD-26 D1).

One standalone ``generateContent`` call. The prompt embeds the D5 canary:
the model must first report how many images it received, so the router can
detect endpoints that silently drop image parts. Never called from tests —
tests stub the ``VisionProvider`` protocol.
"""

from __future__ import annotations

import base64
import json

import httpx

from agent.agents.vision_supply_router import VisionRecognition

GEMINI_VISION_MODEL = "gemini-2.0-flash"
_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

_PROMPT = (
    "You will receive one or more photos. Respond with strict JSON only: "
    '{"image_count": <how many images you actually received>, '
    '"candidate_titles": [<up to 4 anime SERIES titles this scene could be '
    "from, main series name only, no season/movie suffixes>]}. "
    "If the photos are not from any anime you recognize, return an empty "
    "candidate_titles list. Reply in locale: {locale}."
)


def sniff_image_mime(image: bytes) -> str | None:
    """Strict magic-byte sniff; ``None`` when the bytes are not a supported image."""
    if image.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image.startswith(b"RIFF") and image[8:12] == b"WEBP":
        return "image/webp"
    if image.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


def _sniff_mime(image: bytes) -> str:
    return sniff_image_mime(image) or "image/jpeg"


def _image_part(image: bytes) -> dict[str, object]:
    encoded = base64.b64encode(image).decode("ascii")
    return {"inline_data": {"mime_type": _sniff_mime(image), "data": encoded}}


def _payload(images: list[bytes], locale: str) -> dict[str, object]:
    parts: list[dict[str, object]] = [{"text": _PROMPT.replace("{locale}", locale)}]
    parts.extend(_image_part(image) for image in images)
    return {
        "contents": [{"parts": parts}],
        "generationConfig": {"response_mime_type": "application/json"},
    }


def _response_text(body: object) -> str:
    if not isinstance(body, dict):
        return ""
    candidates = body.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    return _candidate_text(candidates[0])


def _candidate_text(candidate: object) -> str:
    if not isinstance(candidate, dict):
        return ""
    content = candidate.get("content")
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list) or not parts:
        return ""
    part = parts[0]
    text = part.get("text") if isinstance(part, dict) else None
    return text if isinstance(text, str) else ""


def _parse_recognition(text: str) -> VisionRecognition:
    try:
        raw: object = json.loads(text)
    except json.JSONDecodeError:
        return VisionRecognition(reported_image_count=-1)
    if not isinstance(raw, dict):
        return VisionRecognition(reported_image_count=-1)
    count = raw.get("image_count")
    titles = raw.get("candidate_titles")
    return VisionRecognition(
        reported_image_count=count if isinstance(count, int) else -1,
        candidate_titles=_string_list(titles),
    )


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


class GeminiVisionProvider:
    """Thin REST client for the platform vision baseline."""

    def __init__(
        self,
        api_key: str,
        model: str = GEMINI_VISION_MODEL,
        base_url: str = _GEMINI_BASE_URL,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url
        self._timeout = timeout_seconds

    async def recognize(self, images: list[bytes], locale: str) -> VisionRecognition:
        url = f"{self._base_url}/models/{self._model}:generateContent"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                url,
                headers={"x-goog-api-key": self._api_key},
                json=_payload(images, locale),
            )
        response.raise_for_status()
        return _parse_recognition(_response_text(response.json()))
