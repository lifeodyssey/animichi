"""P5 login wall (issue #273 S1.7 Task 2): the anonymous happy path is never
interrupted by an auth challenge.

The browser ACs pin that no login dialog opens before the 「保存する」 tap. This is
the server-side half of the same invariant: the identical flow driven through
the runtime endpoint returns no 401/403, so the login wall is a product decision
made in the client rather than something the backend forces.

Every assertion here is on **app** behaviour — the route's declared security, the
`_reject_credentialed_anonymous` guard, and the missing-identity status — rather
than on headers the test itself constructed, which no production change could
falsify.

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
async def test_runtime_declares_no_bearer_requirement(anon_client) -> None:
    """The route must not *demand* a credential the anonymous client cannot mint.

    Asserted against the app's own OpenAPI schema rather than against headers the
    test constructed: adding an `HTTPBearer` dependency to `/v1/runtime` — the
    production change that would break the anonymous flow — turns this red.
    """
    schema = (await anon_client.get("/openapi.json")).json()
    operation = schema["paths"]["/v1/runtime"]["post"]
    assert not operation.get("security"), operation.get("security")
    assert not schema.get("components", {}).get("securitySchemes")


@pytest.mark.integration
async def test_anonymous_stamp_with_a_credential_is_rejected(anon_client) -> None:
    """The app enforces the flow's no-`Authorization` property; the test does not
    merely restate its own request headers.

    `_reject_credentialed_anonymous` (issue #441) refuses an anonymous stamp that
    arrives with a credential, so a client that leaked a stale bearer into the
    anonymous flow would be 401'd — which is exactly the interruption the P5
    invariant forbids. Deleting that guard, or having the web client attach a
    header while signed out, turns this red.
    """
    resp = await anon_client.post(
        "/v1/runtime",
        json={"text": _FLOW[0], "locale": "zh"},
        headers={**_ANON_HEADERS, "Authorization": "Bearer stale-token"},
    )
    assert resp.status_code == 401

    clean = await _turn(anon_client, _FLOW[0])
    assert clean.status_code == 200


@pytest.mark.integration
async def test_identityless_request_is_never_auth_challenged(anon_client) -> None:
    """Even with no edge-stamped identity at all, the route answers rather than
    challenging: no 401/403 and no ``WWW-Authenticate`` for the client to react
    to. Adding an authentication dependency here — the change that would put a
    login in front of the anonymous flow — turns this red. The exact success
    status is deliberately not pinned, so a future stricter *request* validation
    stays free to return 4xx without faking an auth challenge.
    """
    resp = await anon_client.post(
        "/v1/runtime", json={"text": _FLOW[0], "locale": "zh"}
    )
    assert resp.status_code not in _AUTH_CHALLENGES
    assert "www-authenticate" not in {name.lower() for name in resp.headers}
