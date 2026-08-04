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

ANON_ID = "anon_0123456789abcdef0123456789abcdef"
ANON_HEADERS = {
    "X-User-Id": ANON_ID,
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


def _unresolvable_byok_model() -> object:
    """Patched onto `build_byok_model` so a login-gate regression that lets
    the caller through would fail loudly (an assertion) instead of silently
    constructing a real credential path."""
    return patch(
        "agent.interfaces.routes.chat.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not resolve a BYOK model")),
    )


async def _post_chat(headers: dict[str, str]) -> tuple[object, MagicMock]:
    app, runtime = _app()
    with _unresolvable_byok_model():
        async with async_client(app) as client:
            response = await client.post("/v1/chat", json=_body(), headers=headers)
    return response, runtime


async def _assert_login_gate_rejects(headers: dict[str, str]) -> None:
    response, runtime = await _post_chat(headers)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"
    assert runtime.handle.await_count == 0


async def test_malformed_byok_headers_from_anonymous_caller_still_get_403() -> None:
    """`X-BYOK-Key` blank (would 400 for a logged-in caller) — for an
    anonymous caller this must resolve to the login gate first."""
    headers = ANON_HEADERS | {
        "X-BYOK-Provider": "openai-compatible",
        "X-BYOK-Key": "   ",
    }
    await _assert_login_gate_rejects(headers)


async def test_anon_id_prefix_gates_byok_when_x_user_type_is_missing() -> None:
    """Regression (issue #741, production bypass): an `anon_`-prefixed
    X-User-Id is anonymous by that ID convention even with no X-User-Type
    header at all — the blind spot every pre-#741 test in this file missed
    by always pairing the two headers. See
    `test_anon_id_prefix_gates_byok_when_x_user_type_is_wrong` for the
    mistyped-value sibling and the fuller regression writeup."""
    headers = {"X-User-Id": ANON_ID} | BYOK_HEADERS
    await _assert_login_gate_rejects(headers)


async def test_anon_id_prefix_gates_byok_when_x_user_type_is_wrong() -> None:
    """Regression (issue #741, production bypass): the login gate must use
    the same `is_anonymous_identity` predicate quota metering already
    trusts, not a bare `user_type != ANONYMOUS_USER_TYPE` literal — an
    `anon_`-prefixed X-User-Id stays anonymous by that convention even when
    X-User-Type is present but mistyped (here: "authenticated"). Before the
    fix, a caller shaped exactly like this cleared the old check and reached
    the real `build_byok_model` call (observed in production as a 400
    egress-validation response instead of the expected 403)."""
    headers = {"X-User-Id": ANON_ID, "X-User-Type": "authenticated"} | BYOK_HEADERS
    await _assert_login_gate_rejects(headers)
