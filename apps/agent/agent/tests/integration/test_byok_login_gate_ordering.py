"""P3 ordering: `byok_requires_login` (403) precedes header-shape validation
(400) (#284 T3).

An anonymous caller with **malformed** BYOK headers must still see 403
`byok_requires_login` — the actionable rejection for their situation — not
400 `invalid_request`, which would both leak that BYOK exists and mask the
real reason (they're not logged in) behind a decoy validation error.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI

from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

pytestmark = pytest.mark.integration

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}
BYOK_HEADERS = {
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": "sk-fake-secret-value",
    "X-BYOK-Model": "byok-test-model",
    "X-BYOK-Base-Url": "https://byok.example.test/v1",
}


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _app() -> tuple[FastAPI, MagicMock]:
    db = build_stub_db()
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(success=True, status="ok", intent="qa")
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    app, _ = build_app(runtime_api=runtime, db=db)
    return app, runtime


async def test_malformed_byok_headers_from_anonymous_caller_still_get_403() -> None:
    """`X-BYOK-Key` blank (would 400 for a logged-in caller) — for an
    anonymous caller this must resolve to the login gate first."""
    app, runtime = _app()
    headers = ANON_HEADERS | {
        "X-BYOK-Provider": "openai-compatible",
        "X-BYOK-Key": "   ",
    }
    async with async_client(app) as client:
        response = await client.post("/v1/chat", json=_body(), headers=headers)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"
    assert runtime.handle.await_count == 0


@pytest.mark.parametrize(
    "user_type_header",
    [{}, {"X-User-Type": "authenticated"}],
    ids=["missing_user_type", "wrong_user_type_value"],
)
async def test_anon_id_prefix_gates_byok_even_without_the_literal_anonymous_type(
    user_type_header: dict[str, str],
) -> None:
    """Regression (issue #741, production bypass): the login gate must use
    the same `is_anonymous_identity` predicate quota metering already
    trusts. An `anon_`-prefixed X-User-Id with a missing or mistyped
    X-User-Type is anonymous by that convention even though it never equals
    the literal string "anonymous" — before the fix, a caller shaped
    exactly like this cleared `_byok_login_rejection`'s bare
    `user_type != ANONYMOUS_USER_TYPE` check and reached the real
    `build_byok_model` call (observed in production as a 400
    egress-validation response instead of the expected 403).

    Every existing test in this file pairs `X-User-Id` with an exact
    `X-User-Type: anonymous` — this is the blind spot none of them covered.
    """
    app, runtime = _app()
    headers = (
        {"X-User-Id": "anon_0123456789abcdef0123456789abcdef"}
        | user_type_header
        | {
            "X-BYOK-Provider": "openai-compatible",
            "X-BYOK-Key": "sk-fake-secret-value",
            "X-BYOK-Model": "byok-test-model",
            "X-BYOK-Base-Url": "https://byok.example.test/v1",
        }
    )
    with patch(
        "agent.interfaces.routes.chat.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not resolve a BYOK model")),
    ):
        async with async_client(app) as client:
            response = await client.post("/v1/chat", json=_body(), headers=headers)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"
    assert runtime.handle.await_count == 0
