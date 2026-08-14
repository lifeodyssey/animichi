"""Contract tests for the /v1/chat AI SDK message stream (TURN-4 #955).

Validates that ``POST /v1/chat`` emits the AI SDK UI-message-stream frames
in the expected order (``start`` -> ``start-step`` -> tool parts ->
``data-response`` -> ``finish-step`` -> ``finish`` -> ``done``), that the
data part carries the full ``PublicAPIResponse`` wire payload, and that
runtime errors surface as an ``error`` frame with no exception detail.

Uses a real PostgreSQL testcontainer for the DB layer; RuntimeAPI is still
mocked so we test stream framing, not pipeline logic.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient
from pydantic_ai.models import Model

from animichi.agents.runtime_deps import StepEvent
from animichi.config.settings import Settings
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.fastapi_service import create_fastapi_app
from animichi.interfaces.public_api import PublicAPIResponse, RuntimeAPI

# ── Helpers ──────────────────────────────────────────────────────────────────


def _canned_response() -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        session_id="sess-sse",
        message="Found 0 pilgrimage spots.",
        data={"results": {"rows": [], "row_count": 0}},
        ui={"component": "PilgrimageGrid"},
    )


def _chat_body(text: str) -> dict[str, object]:
    """The Vercel AI SDK chat envelope the web app sends."""
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": text}]}
        ]
    }


def _parse_frames(raw: str) -> list[dict[str, object]]:
    """Parse every ``data: ...`` SSE line into its chunk dict.

    The AI SDK ``done`` chunk is the literal ``data: [DONE]`` — mapped to a
    ``{"type": "done"}`` frame so ordering assertions can name it.
    """
    frames: list[dict[str, object]] = []
    for line in raw.split("\n"):
        if not line.startswith("data: "):
            continue
        payload = line[len("data: ") :]
        if payload == "[DONE]":
            frames.append({"type": "done"})
            continue
        try:
            frames.append(json.loads(payload))
        except json.JSONDecodeError:
            continue
    return frames


def _build_runtime_api_mock(
    db: PersistenceRepos,
    response: PublicAPIResponse | None = None,
    *,
    emit_steps: bool = True,
) -> MagicMock:
    """Build a mock RuntimeAPI whose ``handle`` optionally emits on_step calls."""
    canned = response or _canned_response()
    api = MagicMock(spec=RuntimeAPI)
    api._db = db
    api._session_store = InMemorySessionStore()

    async def handle_side_effect(
        request: object,
        *,
        model: Model | None = None,
        user_id: str | None = None,
        user_type: str | None = None,
        is_byok: bool = False,
        on_step: object = None,
        outcome: object = None,
        turn_ref: object = None,
        owner: object = None,
        verdict: object = None,
        turn_key: str | None = None,
    ) -> PublicAPIResponse:
        del model, is_byok, outcome, turn_ref, owner, verdict, turn_key
        if emit_steps and on_step is not None and callable(on_step):
            await on_step(
                StepEvent(
                    tool="search_bangumi",
                    call_id="integration-call",
                    status="running",
                    data={"bangumi_id": "12345"},
                    thought="Searching...",
                )
            )
            await on_step(
                StepEvent(
                    tool="search_bangumi",
                    call_id="integration-call",
                    status="done",
                    data={"rows": [], "row_count": 0},
                    observation="Found 0 results",
                )
            )
        return canned

    api.handle = AsyncMock(side_effect=handle_side_effect)
    return api


def _stream_frames(
    db: PersistenceRepos, api: MagicMock, text: str = "京吹の聖地"
) -> list[dict[str, object]]:
    app = create_fastapi_app(runtime_api=api, settings=Settings())
    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/v1/chat",
            json=_chat_body(text),
            headers={"X-User-Id": "user-1"},
        ) as resp:
            body = "".join(resp.iter_text())
    return _parse_frames(body)


# ── Frame ordering ───────────────────────────────────────────────────────────


class TestSSEFrameOrdering:
    async def test_stream_starts_with_start_and_ends_with_done(
        self, tc_db: PersistenceRepos
    ) -> None:
        api = _build_runtime_api_mock(tc_db)
        frames = _stream_frames(tc_db, api)

        assert len(frames) >= 1
        assert frames[0]["type"] == "start"
        assert frames[-1]["type"] == "done"

    async def test_stream_emits_exactly_one_done_frame(
        self, tc_db: PersistenceRepos
    ) -> None:
        api = _build_runtime_api_mock(tc_db)
        frames = _stream_frames(tc_db, api)

        done_frames = [f for f in frames if f["type"] == "done"]
        assert len(done_frames) == 1

    async def test_order_is_start_step_data_finish_done(
        self, tc_db: PersistenceRepos
    ) -> None:
        api = _build_runtime_api_mock(tc_db, emit_steps=True)
        frames = _stream_frames(tc_db, api)

        types = [str(f["type"]) for f in frames]
        assert types[0] == "start"
        assert types[1] == "start-step"
        assert types[-3:] == ["finish-step", "finish", "done"]
        assert "data-response" in types


# ── Data part shape ──────────────────────────────────────────────────────────


class TestSSEDataPartShape:
    async def test_data_part_contains_public_api_response_keys(
        self, tc_db: PersistenceRepos
    ) -> None:
        api = _build_runtime_api_mock(tc_db)
        frames = _stream_frames(tc_db, api)

        data_parts = [f for f in frames if f["type"] == "data-response"]
        assert data_parts, "expected at least one data-response frame"
        payload = data_parts[-1]["data"]
        assert isinstance(payload, dict)
        for key in ("success", "status", "intent", "message", "data", "errors"):
            assert key in payload, f"data part missing key: {key}"

        assert isinstance(payload["success"], bool)
        assert isinstance(payload["status"], str)
        assert isinstance(payload["intent"], str)
        assert isinstance(payload["errors"], list)


# ── Tool part shape ──────────────────────────────────────────────────────────


class TestSSEToolPartShape:
    async def test_tool_parts_carry_the_tool_name(
        self, tc_db: PersistenceRepos
    ) -> None:
        api = _build_runtime_api_mock(tc_db, emit_steps=True)
        frames = _stream_frames(tc_db, api)

        input_frames = [f for f in frames if f["type"] == "tool-input-available"]
        output_frames = [f for f in frames if f["type"] == "tool-output-available"]
        assert input_frames
        assert output_frames
        for frame in input_frames:
            assert frame["toolName"] == "search_bangumi"
        for frame in output_frames:
            assert frame["toolCallId"] == "integration-call"
            assert "output" in frame


# ── Error shape ──────────────────────────────────────────────────────────────


class TestSSEError:
    async def test_runtime_error_emits_error_frame_without_exception_detail(
        self, tc_db: PersistenceRepos
    ) -> None:
        api = MagicMock(spec=RuntimeAPI)
        api.handle = AsyncMock(side_effect=RuntimeError("boom"))
        api._db = tc_db
        api._session_store = InMemorySessionStore()
        frames = _stream_frames(tc_db, api)

        error_frames = [f for f in frames if f["type"] == "error"]
        assert len(error_frames) == 1
        payload = error_frames[0]
        assert "boom" not in json.dumps(payload)
        assert payload.get("errorText")

    async def test_blank_text_on_chat_returns_422(
        self, tc_db: PersistenceRepos
    ) -> None:
        api = _build_runtime_api_mock(tc_db)
        app = create_fastapi_app(runtime_api=api, settings=Settings())
        with TestClient(app) as client:
            resp = client.post(
                "/v1/chat",
                json=_chat_body("   "),
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 422
        body = resp.json()
        assert "error" in body
