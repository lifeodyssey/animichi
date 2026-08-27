"""Disconnect regressions for the progressive chat stream."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from animichi.agents.runtime_deps import OnStep
from animichi.interfaces.routes import chat_stream as chat_stream_module
from animichi.interfaces.routes.chat_stream import stream_chat
from animichi.interfaces.schemas import PublicAPIResponse


async def test_finish_or_track_consumes_completed_producer() -> None:
    task = asyncio.create_task(asyncio.sleep(0))
    await task

    chat_stream_module._finish_or_track(task)

    assert task not in chat_stream_module._DETACHED_PRODUCERS


async def test_disconnect_does_not_wait_for_cancellation_resistant_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "animichi.interfaces.routes.chat_stream._PRODUCER_CANCEL_GRACE_SECONDS", 0
    )
    release = asyncio.Event()
    cancelled = asyncio.Event()

    async def resists_cancel(_on_step: OnStep) -> PublicAPIResponse:
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()
        return PublicAPIResponse(success=True, status="ok", intent="greet_user")

    frames = stream_chat(resists_cancel)
    await anext(frames)
    try:
        await frames.aclose()
        await asyncio.sleep(0)
        assert cancelled.is_set()
        assert len(chat_stream_module._DETACHED_PRODUCERS) == 1
    finally:
        release.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
    assert chat_stream_module._DETACHED_PRODUCERS == set()


async def test_cancelled_cleanup_still_tracks_the_resistant_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "animichi.interfaces.routes.chat_stream._PRODUCER_CANCEL_GRACE_SECONDS", 30
    )
    release = asyncio.Event()
    cancelled = asyncio.Event()

    async def resists_cancel(_on_step: OnStep) -> PublicAPIResponse:
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()
        return PublicAPIResponse(success=True, status="ok", intent="greet_user")

    frames = stream_chat(resists_cancel)
    await anext(frames)
    cleanup = asyncio.create_task(frames.aclose())
    try:
        await cancelled.wait()
        cleanup.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cleanup
        assert len(chat_stream_module._DETACHED_PRODUCERS) == 1
    finally:
        release.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
    assert chat_stream_module._DETACHED_PRODUCERS == set()


class _BlockedHandler:
    """A ``ChatHandler`` that blocks until released — stands in for a
    provider that never gets the chance to finish before the client goes
    away, without resisting cancellation like `resists_cancel` does."""

    def __init__(self) -> None:
        self.release = asyncio.Event()

    async def __call__(self, _on_step: OnStep) -> PublicAPIResponse:
        await self.release.wait()
        return PublicAPIResponse(success=True, status="ok", intent="greet_user")


async def test_disconnect_logs_the_turn_key_unconditionally(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """P0 SSE §2.1: a client disconnect must leave an observable log line —
    the prior behaviour absorbed the cancellation via ``_consume_result``
    without recording anything, so a user report of a dropped connection had
    no server-side evidence to match against. The log must fire even when
    the producer cancels promptly (not only on the ``chat_stream_cancel_timeout``
    slow path), so this test never touches the grace-period constant."""
    mock_logger = MagicMock()
    monkeypatch.setattr(chat_stream_module, "logger", mock_logger)
    handler = _BlockedHandler()

    frames = stream_chat(handler, turn_key="turn-disconnect-1")
    await anext(frames)
    try:
        await frames.aclose()
    finally:
        handler.release.set()
        await asyncio.sleep(0)
    mock_logger.warning.assert_any_call(
        "chat_stream_client_disconnected", turn_key="turn-disconnect-1"
    )


async def test_disconnect_after_producer_finishes_still_logs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A `task.done()` producer is not proof the client saw every frame: an
    early `aclose()` can land after the producer already queued its last
    frame but before `_drain` pulled it. The old `if task.done(): return`
    short-circuit skipped the disconnect log for exactly this case."""
    mock_logger = MagicMock()
    monkeypatch.setattr(chat_stream_module, "logger", mock_logger)

    async def instant(_on_step: OnStep) -> PublicAPIResponse:
        return PublicAPIResponse(success=True, status="ok", intent="greet_user")

    frames = stream_chat(instant, turn_key="turn-disconnect-2")
    await anext(frames)  # only the first frame; the producer already ran to completion
    await frames.aclose()

    mock_logger.warning.assert_any_call(
        "chat_stream_client_disconnected", turn_key="turn-disconnect-2"
    )
