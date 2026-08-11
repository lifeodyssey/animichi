"""Unit tests for the BYOK probe capability (`ProbeModelCredential`, #953).

Pins the orchestration seam the route used to own by hand: egress
pre-validation surfaces the dedicated `egress_blocked` code, the model is
built with the response cap installed at construction, the one-shot probe
turn maps onto the generated `ByokProbeResponse` boundary model, the
per-request BYOK client is closed on every path, and the completion log never
echoes the credential. `build_byok_model` and `probe_byok_model` are mocked
at the capability's import site — no network, no real model, no timing
asserts (the timeout path uses an immediate-timeout fake `asyncio`).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Coroutine
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from structlog import testing

from animichi.agents.byok_models import ByokCredential, ByokError
from animichi.agents.byok_probe import ProbeResult
from animichi.infrastructure.egress_errors import EgressBlocked, EgressBlockReason
from animichi.infrastructure.egress_transport import CappedResponseTransport
from animichi.interfaces.boundary.agent_models import ByokProbeResponse
from animichi.interfaces.services.byok_probe import (
    ProbeModelCredential,
    ProbeRejection,
)

CAPABILITY = "animichi.interfaces.services.byok_probe"

ANTHROPIC_CREDENTIAL = ByokCredential(
    provider="anthropic", key="sk-fake-secret", model="claude-x"
)

_OK_RESULT = ProbeResult(has_vision=True, reachable=True, error_code=None)


class _ClosingClient:
    def __init__(self) -> None:
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


def _built_model(client: _ClosingClient) -> object:
    return SimpleNamespace(model=object(), client=client)


def _patched_build(client: _ClosingClient) -> AsyncMock:
    return AsyncMock(return_value=_built_model(client))


async def test_success_maps_the_probe_result_onto_the_generated_response() -> None:
    client = _ClosingClient()
    with (
        patch(f"{CAPABILITY}.build_byok_model", _patched_build(client)),
        patch(
            f"{CAPABILITY}.probe_byok_model",
            AsyncMock(return_value=_OK_RESULT),
        ),
    ):
        response = await ProbeModelCredential().probe(ANTHROPIC_CREDENTIAL)

    assert response == ByokProbeResponse(vision=True, reachable=True, error_code=None)
    assert client.closed is True


async def test_the_response_cap_is_installed_at_construction() -> None:
    """#479 P2 review follow-up: the capability builds the model with
    `transport_wrapper=CappedResponseTransport` — the cap is installed at
    construction time, never as a post-hoc `client._transport` reassignment."""
    with (
        patch(f"{CAPABILITY}.build_byok_model", AsyncMock()) as build_mock,
        patch(f"{CAPABILITY}.probe_byok_model", AsyncMock(return_value=_OK_RESULT)),
    ):
        await ProbeModelCredential().probe(ANTHROPIC_CREDENTIAL)

    assert build_mock.await_args is not None
    assert build_mock.await_args.kwargs["transport_wrapper"] is CappedResponseTransport


async def test_egress_blocked_pre_validation_raises_the_dedicated_code() -> None:
    with (
        patch(
            f"{CAPABILITY}.validate_base_url",
            AsyncMock(
                side_effect=EgressBlocked(
                    EgressBlockReason.ADDRESS_NOT_ROUTABLE, detail="127.0.0.1"
                )
            ),
        ),
        patch(
            f"{CAPABILITY}.build_byok_model",
            AsyncMock(side_effect=AssertionError("must not build a model")),
        ),
    ):
        with pytest.raises(ProbeRejection) as exc_info:
            await ProbeModelCredential().probe(
                ByokCredential(
                    provider="openai-compatible",
                    key="sk-fake-secret",
                    model="m",
                    base_url="https://127.0.0.1/v1",
                )
            )

    assert exc_info.value.code == "egress_blocked"
    assert exc_info.value.message == "base_url failed egress validation."


async def test_byok_error_from_model_build_raises_invalid_request() -> None:
    with patch(
        f"{CAPABILITY}.build_byok_model",
        AsyncMock(
            side_effect=ByokError("invalid_request", "X-BYOK-Key must not be blank.")
        ),
    ):
        with pytest.raises(ProbeRejection) as exc_info:
            await ProbeModelCredential().probe(ANTHROPIC_CREDENTIAL)

    assert exc_info.value.code == "invalid_request"
    assert exc_info.value.message == "X-BYOK-Key must not be blank."


async def test_the_client_is_closed_even_when_the_probe_turn_raises() -> None:
    client = _ClosingClient()
    with (
        patch(f"{CAPABILITY}.build_byok_model", _patched_build(client)),
        patch(
            f"{CAPABILITY}.probe_byok_model",
            AsyncMock(side_effect=RuntimeError("boom")),
        ),
    ):
        with pytest.raises(RuntimeError):
            await ProbeModelCredential().probe(ANTHROPIC_CREDENTIAL)

    assert client.closed is True


class _ImmediateAsyncio:
    CancelledError = asyncio.CancelledError
    TimeoutError = asyncio.TimeoutError

    @staticmethod
    def create_task(coro: Coroutine[object, object, object]) -> asyncio.Task[object]:
        return asyncio.create_task(coro)

    @staticmethod
    def gather(
        *tasks: Awaitable[object], return_exceptions: bool = False
    ) -> asyncio.Future[list[object]]:
        return asyncio.gather(*tasks, return_exceptions=return_exceptions)

    @staticmethod
    def timeout(_delay: float) -> asyncio.Timeout:
        return asyncio.timeout(0)


async def test_whole_operation_timeout_returns_unreachable_and_closes_the_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import animichi.interfaces.services.byok_probe as capability

    monkeypatch.setattr(capability, "asyncio", _ImmediateAsyncio())
    client = _ClosingClient()

    async def _hang(*_args: object, **_kwargs: object) -> object:
        await asyncio.Event().wait()
        return None

    with (
        patch(f"{CAPABILITY}.build_byok_model", _patched_build(client)),
        patch(f"{CAPABILITY}.probe_byok_model", AsyncMock(side_effect=_hang)),
    ):
        response = await ProbeModelCredential().probe(ANTHROPIC_CREDENTIAL)

    assert response == ByokProbeResponse(
        vision=False, reachable=False, error_code="provider_unreachable"
    )
    assert client.closed is True


async def test_completion_log_never_echoes_the_credential() -> None:
    client = _ClosingClient()
    with (
        testing.capture_logs() as captured,
        patch(f"{CAPABILITY}.build_byok_model", _patched_build(client)),
        patch(
            f"{CAPABILITY}.probe_byok_model",
            AsyncMock(return_value=_OK_RESULT),
        ),
    ):
        await ProbeModelCredential().probe(ANTHROPIC_CREDENTIAL)

    assert any(event.get("event") == "byok_probe_completed" for event in captured)
    serialized = repr(captured)
    assert "sk-fake-secret" not in serialized
