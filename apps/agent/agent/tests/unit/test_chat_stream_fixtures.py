"""Validate the recorded chat-stream SSE fixtures consumed by C0.2."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

_FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests/fixtures/chat_stream"
_STREAM_FIXTURES = ("search", "clarify", "error")


def _load(name: str) -> str:
    return (_FIXTURE_DIR / f"{name}.sse").read_text(encoding="utf-8")


def _chunks(raw: str) -> list[object]:
    out: list[object] = []
    for block in raw.split("\n\n"):
        if not block:
            continue
        assert block.startswith("data: ")
        payload = block[len("data: ") :]
        out.append(payload if payload == "[DONE]" else json.loads(payload))
    return out


def _type_of(chunk: object) -> str:
    if chunk == "[DONE]":
        return "[DONE]"
    assert isinstance(chunk, dict)
    kind = chunk["type"]
    assert isinstance(kind, str)
    return kind


def _types(chunks: list[object]) -> list[str]:
    return [_type_of(chunk) for chunk in chunks]


def _data_parts(chunks: list[object]) -> list[dict[str, object]]:
    return [
        chunk
        for chunk in chunks
        if isinstance(chunk, dict) and chunk.get("type") == "data-response"
    ]


def _data_of(part: dict[str, object]) -> dict[str, object]:
    value = part["data"]
    assert isinstance(value, dict)
    return value


@pytest.mark.parametrize("name", _STREAM_FIXTURES)
def test_fixture_is_well_framed_and_terminated(name: str) -> None:
    raw = _load(name)
    assert raw.endswith("\n\n")
    types = _types(_chunks(raw))
    assert types[0] == "start"
    assert types[1] == "start-step"
    assert types[-1] == "[DONE]"
    assert types[-2] == "finish"


def test_search_fixture_carries_tool_and_progressive_parts() -> None:
    chunks = _chunks(_load("search"))
    types = _types(chunks)
    assert types.count("tool-output-available") == 3
    parts = _data_parts(chunks)
    assert parts[0]["data"] == {"intent": "plan_route"}
    assert {part["id"] for part in parts} == {"response"}
    assert set(_data_of(parts[1])) > {"intent"}


def test_clarify_fixture_is_intent_first() -> None:
    parts = _data_parts(_chunks(_load("clarify")))
    assert parts[0]["data"] == {"intent": "clarify"}
    assert _data_of(parts[1])["status"] == "needs_clarification"


def test_error_fixture_has_error_part_and_no_data() -> None:
    chunks = _chunks(_load("error"))
    types = _types(chunks)
    assert "error" in types
    assert "data-response" not in types
    finish = [c for c in chunks if isinstance(c, dict) and c["type"] == "finish"][0]
    assert finish["finishReason"] == "error"
