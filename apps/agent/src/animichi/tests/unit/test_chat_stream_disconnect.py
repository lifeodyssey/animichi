"""Disconnect regressions for the progressive chat stream."""

from __future__ import annotations

import asyncio

import pytest

from animichi.agents.runtime_deps import OnStep
from animichi.interfaces.routes import chat_stream as chat_stream_module
from animichi.interfaces.routes.chat_stream import stream_chat
from animichi.interfaces.schemas import PublicAPIResponse


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
