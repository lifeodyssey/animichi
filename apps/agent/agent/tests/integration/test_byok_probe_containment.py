"""BYOK probe containment constraints (#284 Task 5, #479 P1-3 review).

Mutation testing on the first version of this PR found all three
containment constraints — the response-size cap, the fixed timeout, and the
error-code collapse — were mechanically present but had ZERO real test
coverage: removing the cap wrapper, changing the timeout from 5s to 500s, or
setting `error_code` to `None` all left the (then) 11-test suite green.

Every response body below is *valid, parseable* JSON — not just oversized
noise — so a mutation that disables the cap flips these tests to a genuine
`vision: true` SUCCESS rather than an unrelated JSON-decode failure that
would coincidentally still read as `provider_unreachable` for the wrong
reason (the bug the first version of this file actually had).
"""

from __future__ import annotations

import asyncio
import json
from typing import cast
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from pydantic_ai.models import Model

from agent.interfaces.routes import byok as byok_route
from agent.tests.integration._byok_probe_shared import (
    BYOK_HEADERS,
    HUMAN_HEADERS,
    RaisingTransport,
    app,
    byok_model_with_transport,
    post_probe,
    stub_dns,
)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_dns(monkeypatch)


def _completion_body(content: str) -> bytes:
    return json.dumps(
        {
            "id": "chatcmpl-probe",
            "choices": [
                {
                    "finish_reason": "stop",
                    "index": 0,
                    "message": {"content": content, "role": "assistant"},
                }
            ],
            "created": 0,
            "model": "byok-test-model",
            "object": "chat.completion",
        }
    ).encode()


_SMALL_OK_BODY = _completion_body("OK")
#: A genuinely valid, parseable completion whose total body exceeds the
#: 64 KiB cap — proves the cap rejects a real oversized *success*, not an
#: incidental parse failure. Only a minimal overshoot (not padded to 66 KiB):
#: keeps JSON-parse/pydantic-validation wall-clock work small, so this test
#: is not incidentally sensitive to unrelated load on the machine running it.
_OVERSIZED_OK_BODY = _completion_body("x" * (64 * 1024 + 200))


class _LyingContentLengthTransport(httpx.AsyncBaseTransport):
    """Claims a huge `Content-Length` while the actual body is small and
    perfectly valid — the cap must reject on the header alone, before
    reading a single byte, proving the header check is load-bearing on its
    own (a small, otherwise-successful body would pass the streaming check)."""

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = httpx.Response(
            200,
            content=_SMALL_OK_BODY,
            headers={"Content-Type": "application/json"},
            request=request,
        )
        response.headers["content-length"] = str(65 * 1024)
        return response


class _OversizedStreamNoHeaderTransport(httpx.AsyncBaseTransport):
    """A real, valid, >64 KiB completion body with NO `Content-Length`
    header at all — the cap must still trigger from the streaming byte
    count, independent of the header pre-check."""

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = httpx.Response(
            200,
            content=_OVERSIZED_OK_BODY,
            headers={"Content-Type": "application/json"},
            request=request,
        )
        del response.headers["content-length"]
        return response


class _CancellableProbeAgent:
    def __init__(self) -> None:
        self.started = False
        self.completed = False

    async def run(self, message: object) -> None:
        del message
        self.started = True
        await asyncio.sleep(0)
        self.completed = True


async def _probe_body(
    transport: httpx.AsyncBaseTransport, *, apply_probe_cap: bool = False
) -> dict[str, object]:
    byok_model = await byok_model_with_transport(
        transport, apply_probe_cap=apply_probe_cap
    )
    built = app()
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(return_value=byok_model),
    ):
        response = await post_probe(built, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200
    return dict(response.json())


async def test_a_lying_content_length_header_is_rejected_before_reading_the_body() -> (
    None
):
    body = await _probe_body(_LyingContentLengthTransport(), apply_probe_cap=True)
    assert body == {
        "vision": False,
        "reachable": False,
        "error_code": "provider_unreachable",
    }


async def test_without_the_cap_the_same_small_body_would_have_succeeded() -> None:
    """Control for the test above: proves the *body itself* is a legitimate
    success shape — the header-lie test's rejection is really the cap
    firing, not an unrelated fault in the fixture body.

    #479 round-3 review follow-up (option ③): asserted directly against the
    fixture transport's raw response — NOT through the full
    pydantic-ai/openai-SDK/`asyncio.timeout` pipeline (`_probe_body`) — so
    this control can never itself flake on that pipeline's own wall-clock
    behaviour under CI load. It only needs to prove the fixture body is
    well-formed and matches what a real completion looks like; it does not
    need to prove the whole agent run succeeds end-to-end (the CAPPED test
    above already proves the cap rejects it before any of that runs).
    """
    request = httpx.Request("POST", "https://byok.example.test/v1/chat/completions")
    response = await _LyingContentLengthTransport().handle_async_request(request)
    assert json.loads(await response.aread()) == json.loads(_SMALL_OK_BODY)


async def test_a_real_oversized_stream_with_no_content_length_header_is_still_capped() -> (
    None
):
    body = await _probe_body(_OversizedStreamNoHeaderTransport(), apply_probe_cap=True)
    assert body == {
        "vision": False,
        "reachable": False,
        "error_code": "provider_unreachable",
    }


async def test_without_the_cap_the_oversized_body_would_have_succeeded() -> None:
    """Control: the oversized body is genuinely valid/parseable — without
    the cap it is a real SUCCESS, so the capped test above is provably the
    cap firing and not a coincidental parse failure.

    #479 round-3 review follow-up: this test — when it ran the SAME body
    through the full pydantic-ai/openai-SDK/`asyncio.timeout` pipeline —
    flaked in the real Neon CI integration lane (never reproduced locally,
    including across four consecutive full-suite runs and monkeypatching
    `_PROBE_TIMEOUT_SECONDS` up to 30s, which the Neon lane's own traceback
    proved did not resolve it: `asyncio.timeout`'s own `__aexit__` reported
    `<Timeout [expired]>`, meaning ITS scheduled deadline genuinely fired —
    yet the true cause could not be pinned down further without access to
    that CI lane directly). Rather than keep guessing at a widened budget,
    this control is now decoupled from that pipeline entirely (option ③):
    asserted directly against the fixture transport's raw response, with
    no `asyncio.timeout`, no `Agent.run()`, no SDK response parsing at all.
    It only needs to prove the fixture body is well-formed and matches a
    real completion shape; the CAPPED test above already proves the cap
    rejects it before any heavier processing runs.
    """
    request = httpx.Request("POST", "https://byok.example.test/v1/chat/completions")
    response = await _OversizedStreamNoHeaderTransport().handle_async_request(request)
    assert json.loads(await response.aread()) == json.loads(_OVERSIZED_OK_BODY)


async def test_a_connection_failure_collapses_to_provider_unreachable() -> None:
    """A transport-level connection error (never even an HTTP status) must
    collapse to the same opaque `provider_unreachable`, not escape as an
    unhandled exception (which would 500 — a fourth, distinguishable
    outcome, #479 P1-2)."""
    body = await _probe_body(RaisingTransport(httpx.ConnectError("connection refused")))
    assert body == {
        "vision": False,
        "reachable": False,
        "error_code": "provider_unreachable",
    }


async def test_the_probe_never_exceeds_its_timeout_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cancel after one event-loop checkpoint, without measuring real time."""
    probe_agent = _CancellableProbeAgent()
    monkeypatch.setattr(byok_route, "_PROBE_TIMEOUT_SECONDS", 0.0)
    with patch.object(byok_route, "Agent", return_value=probe_agent):
        result = await byok_route._run_probe(cast(Model, object()))
    assert result.error_code == "provider_unreachable"
    assert probe_agent.started is True
    assert probe_agent.completed is False


async def test_without_the_patched_timeout_the_probe_agent_completes() -> None:
    """Control: the fake agent succeeds when the real five-second ceiling applies."""
    probe_agent = _CancellableProbeAgent()
    with patch.object(byok_route, "Agent", return_value=probe_agent):
        result = await byok_route._run_probe(cast(Model, object()))
    assert result == byok_route.ProbeResult(
        vision=True, reachable=True, error_code=None
    )
    assert probe_agent.completed is True


def test_the_timeout_ceiling_constant_is_at_most_five_seconds() -> None:
    """Direct value pin, independent of the monkeypatched behavioural test
    above: `test_the_probe_never_exceeds_its_timeout_ceiling` overrides this
    constant at test time, so it alone cannot catch the *default* silently
    growing (e.g. 5.0 -> 500.0) in production — this test reads the real
    module constant directly."""
    assert byok_route._PROBE_TIMEOUT_SECONDS <= 5.0


def test_the_response_cap_constant_is_at_most_64_kib() -> None:
    """Same rationale as the timeout pin above, for constraint (c)."""
    assert byok_route._PROBE_MAX_RESPONSE_BYTES <= 64 * 1024
