"""Unit tests for the platform Gemini vision provider (stubbed transport)."""

from __future__ import annotations

import json
from typing import Self

import httpx
import pytest

from agent.clients import gemini_vision
from agent.clients.gemini_vision import (
    GeminiVisionProvider,
    _parse_recognition,
    _payload,
    _response_text,
    _sniff_mime,
)


def test_sniff_mime_covers_the_supported_formats() -> None:
    assert _sniff_mime(b"\x89PNG\r\n") == "image/png"
    assert _sniff_mime(b"RIFFxxxxWEBP") == "image/webp"
    assert _sniff_mime(b"\xff\xd8\xff") == "image/jpeg"


def test_payload_carries_canary_prompt_and_every_image() -> None:
    payload = _payload([b"one", b"two"], "zh")
    contents = payload["contents"]
    assert isinstance(contents, list)
    parts = contents[0]["parts"]
    assert "image_count" in parts[0]["text"]
    assert "locale: zh" in parts[0]["text"]
    assert len(parts) == 3


def test_parse_recognition_reads_count_and_titles() -> None:
    text = json.dumps({"image_count": 2, "candidate_titles": ["君の名は。", 5]})
    recognition = _parse_recognition(text)
    assert recognition.reported_image_count == 2
    assert recognition.candidate_titles == ["君の名は。"]


def test_parse_recognition_degrades_on_malformed_json() -> None:
    assert _parse_recognition("not-json").reported_image_count == -1
    assert _parse_recognition('["list"]').candidate_titles == []


def test_response_text_walks_the_gemini_candidate_shape() -> None:
    body = {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}
    assert _response_text(body) == "hello"
    assert _response_text({"candidates": []}) == ""
    assert _response_text("nope") == ""


class _StubAsyncClient:
    payload: dict[str, object] = {}

    def __init__(self, timeout: float) -> None:
        self.timeout = timeout

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    async def post(
        self, url: str, headers: dict[str, str], json: object
    ) -> httpx.Response:
        text = {"image_count": 1, "candidate_titles": ["リズと青い鳥"]}
        body = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": __import__("json").dumps(text, ensure_ascii=False)}
                        ]
                    }
                }
            ]
        }
        request = httpx.Request("POST", url)
        return httpx.Response(200, json=body, request=request)


async def test_recognize_posts_and_parses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gemini_vision.httpx, "AsyncClient", _StubAsyncClient)
    provider = GeminiVisionProvider(api_key="zero-entropy-test-value")
    recognition = await provider.recognize([b"\xff\xd8\xff"], "ja")
    assert recognition.reported_image_count == 1
    assert recognition.candidate_titles == ["リズと青い鳥"]
