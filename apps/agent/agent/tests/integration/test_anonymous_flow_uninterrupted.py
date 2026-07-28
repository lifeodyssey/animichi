"""P5 login wall (issue #273 S1.7 Task 2): the anonymous happy path is never
interrupted by an auth challenge.

The browser ACs pin that no login dialog opens before the 「保存する」 tap. This is
the server-side half of the same invariant: the identical flow driven through
the runtime endpoint returns no 401/403 and carries no ``Authorization`` header
on any request, so the login wall is a product decision made in the client
rather than something the backend forces.

Uses ``httpx.AsyncClient`` + ``ASGITransport`` (the pattern in
``test_runtime_journey_contract.py``) because ``TestClient``'s portal thread
conflicts with asyncpg's event loop.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import ClarifyResponseModel, QAResponseModel
from agent.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    SessionState,
)
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.fastapi_service import create_fastapi_app
from agent.interfaces.public_api import RuntimeAPI

# The edge stamps anonymous callers with this exact wire format
# (``worker/anonymous.test.ts`` pins ``^anon_[0-9a-f]{32}$``).
_ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}

# search -> clarify -> route refinement -> conversational follow-up.
_FLOW = ("宇治站附近的圣地", "凉宫", "帮我规划路线", "你好")

_AUTH_CHALLENGES = (401, 403)


def _clarify_result() -> AgentResult:
    candidates = [
        OrderedCandidate(
            id="11291", title="凉宫春日的忧郁", points_count=2, city="西宫"
        )
    ]
    state = SessionState(
        pending_clarification=PendingClarification(
            reason="anime_ambiguity",
            candidate_ids=["11291"],
            ordered_candidates=candidates,
            revision=1,
        ),
        clarification_revision=1,
    )
    output = ClarifyResponseModel(
        reason="anime_ambiguity", message="你是指哪部凉宫？", candidate_ids=["11291"]
    )
    return AgentResult(
        output=output,
        intent="clarify",
        session_state=state,
        steps=[StepRecord(tool="clarify", success=True, model_initiated=False)],
    )


def _qa_result() -> AgentResult:
    return AgentResult(
        output=QAResponseModel(message="我可以帮你找动漫圣地。"),
        intent="general_qa",
        session_state=SessionState(),
    )


async def _fake_agent(**kwargs: object) -> AgentResult:
    text = str(kwargs.get("text", ""))
    return _clarify_result() if "凉宫" in text else _qa_result()


@pytest.fixture
async def anon_client(tc_db):
    runtime_api = RuntimeAPI(
        tc_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
    )
    app = create_fastapi_app(runtime_api=runtime_api, db=tc_db)
    app.state.runtime_api = runtime_api
    app.state.db_client = tc_db
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    with patch(
        "agent.interfaces.public_api.run_animichi_agent", side_effect=_fake_agent
    ):
        async with httpx.AsyncClient(
            transport=transport, base_url="https://test"
        ) as client:
            yield client


async def _turn(client: httpx.AsyncClient, text: str) -> httpx.Response:
    return await client.post(
        "/v1/runtime", json={"text": text, "locale": "zh"}, headers=_ANON_HEADERS
    )


@pytest.mark.integration
async def test_anonymous_flow_returns_no_auth_challenge(anon_client) -> None:
    for text in _FLOW:
        resp = await _turn(anon_client, text)
        assert resp.status_code not in _AUTH_CHALLENGES, (
            f"anonymous turn {text!r} was auth-challenged with {resp.status_code}"
        )
        assert resp.status_code == 200


@pytest.mark.integration
async def test_anonymous_flow_sends_no_authorization_header(anon_client) -> None:
    for text in _FLOW:
        resp = await _turn(anon_client, text)
        sent = {name.lower() for name in resp.request.headers}
        assert "authorization" not in sent
