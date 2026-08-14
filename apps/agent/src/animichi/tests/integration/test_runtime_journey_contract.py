"""Runtime journey contract tests.

Tests that the /v1/chat stream's data part returns the correct stage
contracts for frontend journey rendering. Uses httpx.AsyncClient with
ASGITransport to avoid TestClient event loop conflicts with asyncpg.

Endpoints under test:
  POST /v1/chat            (the AI SDK message stream, TURN-4 #955)
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from animichi.agents.agent_result import AgentResult, StepRecord
from animichi.agents.runtime_models import (
    ClarifyResponseModel,
    QAResponseModel,
)
from animichi.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    SessionState,
)
from animichi.config.settings import Settings
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.public_api import RuntimeAPI

_HEADERS = {"X-User-Id": "test-contract", "X-User-Type": "human"}


def _make_clarify_result() -> AgentResult:
    candidates = [
        OrderedCandidate(
            id="11291", title="凉宫春日的忧郁", points_count=2, city="西宫"
        ),
        OrderedCandidate(
            id="3375", title="凉宫春日的消失", points_count=1, city="西宫"
        ),
    ]
    state = SessionState(
        pending_clarification=PendingClarification(
            reason="anime_ambiguity",
            candidate_ids=[item.id for item in candidates],
            ordered_candidates=candidates,
            revision=1,
        ),
        clarification_revision=1,
    )
    output = ClarifyResponseModel(
        reason="anime_ambiguity",
        message="你是指哪部凉宫？",
        candidate_ids=[item.id for item in candidates],
    )
    return AgentResult(
        output=output,
        intent="clarify",
        session_state=state,
        steps=[StepRecord(tool="clarify", is_success=True, model_initiated=False)],
    )


def _make_qa_result() -> AgentResult:
    output = QAResponseModel(message="你好！我可以帮你找动漫圣地。")
    return AgentResult(
        output=output,
        intent="general_qa",
        session_state=SessionState(),
    )


def _chat_body(text: str) -> dict[str, object]:
    """The Vercel AI SDK chat envelope the web app sends."""
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": text}]}
        ]
    }


def _done_payload(raw: str) -> dict[str, object]:
    """The last ``data-response`` frame — the full wire payload."""
    payload: dict[str, object] = {}
    for line in raw.split("\n"):
        if not line.startswith("data: ") or line[6:] == "[DONE]":
            continue
        try:
            frame = json.loads(line[len("data: ") :])
        except json.JSONDecodeError:
            continue
        if frame.get("type") == "data-response":
            data = frame.get("data")
            if isinstance(data, dict):
                payload = data
    return payload


def _build_app(tc_db: object) -> tuple[httpx.AsyncClient, object]:
    """Build an async test client with mocked pipeline."""
    from animichi.interfaces.fastapi_service import create_fastapi_app

    async def _fake_agent(**kwargs: object) -> AgentResult:
        text = str(kwargs.get("text", ""))
        if "凉宫" in text or "涼宮" in text:
            return _make_clarify_result()
        return _make_qa_result()

    runtime_api = RuntimeAPI(
        tc_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
    )
    app = create_fastapi_app(runtime_api=runtime_api, db=tc_db)
    app.state.settings = Settings()
    app.state.runtime_api = runtime_api
    app.state.db_client = tc_db

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="https://test"), _fake_agent


@pytest.fixture
async def async_client(tc_db):
    client, fake_agent = _build_app(tc_db)
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        side_effect=fake_agent,
    ):
        async with client:
            yield client


async def _turn(async_client: httpx.AsyncClient, text: str) -> dict[str, object]:
    resp = await async_client.post(
        "/v1/chat",
        json=_chat_body(text),
        headers=_HEADERS,
    )
    assert resp.status_code == 200
    return _done_payload(resp.text)


# ── Clarify contract ──────────────────────────────────────────────────


@pytest.mark.integration
async def test_runtime_clarify_response_has_full_contract(async_client) -> None:
    payload = await _turn(async_client, "凉宫")

    assert payload["intent"] == "clarify"
    assert payload["message"]
    assert payload["status"] == "needs_clarification"
    data = payload["data"]
    assert isinstance(data, dict)
    assert data["reason"] == "anime_ambiguity"
    assert data["clarification_id"] == 1
    assert "candidates" in data
    assert isinstance(data["candidates"], list)


@pytest.mark.integration
async def test_runtime_clarify_candidate_has_required_fields(async_client) -> None:
    payload = await _turn(async_client, "涼宮")

    data = payload["data"]
    assert isinstance(data, dict)
    candidates = data.get("candidates", [])
    assert isinstance(candidates, list)
    assert len(candidates) >= 1
    candidate = candidates[0]
    assert isinstance(candidate, dict)
    for key in ("id", "title", "points_count"):
        assert key in candidate


# ── Message quality ───────────────────────────────────────────────────


@pytest.mark.integration
async def test_message_is_not_static_template(async_client) -> None:
    payload = await _turn(async_client, "你好")

    message = str(payload.get("message", ""))
    assert message, "message must be non-empty"
    static_patterns = [
        "該当する巡礼地が見つかりませんでした",
        "没有找到相关的巡礼地",
    ]
    assert message not in static_patterns
