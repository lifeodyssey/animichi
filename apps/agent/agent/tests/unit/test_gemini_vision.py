"""Unit tests for the platform Gemini vision provider (stubbed transport)."""

from __future__ import annotations

import json
from typing import Self

import httpx
import pytest

from agent.agents.vision_supply_router import VisionProviderMisconfigured
from agent.clients import gemini_vision
from agent.clients.gemini_vision import (
    GeminiVisionProvider,
    _parse_recognition,
    _payload,
    _response_text,
    _sniff_mime,
    sniff_image_mime,
)


def test_sniff_mime_covers_the_supported_formats() -> None:
    assert _sniff_mime(b"\x89PNG\r\n\x1a\n" + b"data") == "image/png"
    assert _sniff_mime(b"RIFF\x00\x00\x00\x00WEBP") == "image/webp"
    assert _sniff_mime(b"\xff\xd8\xff\xe0data") == "image/jpeg"


def test_sniff_image_mime_rejects_non_image_bytes() -> None:
    assert sniff_image_mime(b"not an image") is None
    assert sniff_image_mime(b"RIFF\x00\x00\x00\x00WAVE") is None
    assert sniff_image_mime(b"\x89PNG\r\n") is None  # truncated signature


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


async def test_recognize_with_empty_key_fails_fast_without_a_network_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """#502 P1-1: an unconfigured key must not even attempt the request —
    and must raise a type distinct from a call that ran and failed."""

    def _unexpected_client(*args: object, **kwargs: object) -> None:
        raise AssertionError("must not build an HTTP client with no API key")

    monkeypatch.setattr(gemini_vision.httpx, "AsyncClient", _unexpected_client)
    provider = GeminiVisionProvider(api_key="")
    with pytest.raises(VisionProviderMisconfigured):
        await provider.recognize([b"\xff\xd8\xff"], "ja")
