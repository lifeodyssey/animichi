"""byok_probe teardown-path unit tests (TURN-2 #949).

The live probe behaviour (real Agent + HTTP transport) is covered by the
integration suite; these hermetic tests pin the timeout/cancel bookkeeping:
a fake ``Agent`` that hangs lets the immediate-timeout fake ``asyncio``
exercise the ``_cancel_and_await`` teardown without any network.
"""

from __future__ import annotations

import asyncio

import pytest

from animichi.agents import byok_probe as bp
from animichi.agents.byok_probe import ProbeResult, _cancel_and_await, probe_byok_model


class _ImmediateAsyncio:
    CancelledError = asyncio.CancelledError
    TimeoutError = asyncio.TimeoutError

    @staticmethod
    def create_task(coro: object) -> asyncio.Task[object]:
        return asyncio.create_task(coro)  # type: ignore[arg-type]

    @staticmethod
    def gather(*tasks: object, return_exceptions: bool = False) -> object:
        return asyncio.gather(*tasks, return_exceptions=return_exceptions)  # type: ignore[arg-type]

    @staticmethod
    def timeout(_delay: float) -> asyncio.Timeout:
        return asyncio.timeout(0)


class _HangingAgent:
    def __init__(self, *args: object, **kwargs: object) -> None:
        del args, kwargs

    async def run(self, _message: object) -> object:
        await asyncio.Event().wait()
        return None


@pytest.mark.asyncio
async def test_probe_timeout_cancels_the_run_task_and_returns_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(bp, "asyncio", _ImmediateAsyncio())
    monkeypatch.setattr(bp, "Agent", _HangingAgent)
    result = await probe_byok_model(object())  # type: ignore[arg-type]
    assert result == ProbeResult(
        has_vision=False, reachable=False, error_code="provider_unreachable"
    )


@pytest.mark.asyncio
async def test_probe_outer_cancel_still_cancels_the_run_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(bp, "asyncio", _ImmediateAsyncio())
    monkeypatch.setattr(bp, "Agent", _HangingAgent)

    async def run() -> None:
        await probe_byok_model(object())  # type: ignore[arg-type]

    task = asyncio.create_task(run())
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_cancel_and_await_cancels_and_drains_the_task() -> None:
    task = asyncio.create_task(asyncio.Event().wait())
    await asyncio.sleep(0)
    await _cancel_and_await(task)
    assert task.cancelled()
