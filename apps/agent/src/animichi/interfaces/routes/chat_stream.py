"""Progressive AI SDK UI message stream over encoded SSE frames.

Emits the standard AI SDK UI message stream on `/v1/chat`: tool parts for
tool-call progress, and custom `data-response` parts overwritten in place by a
single ID so the discriminated `intent` field is readable ahead of the rest.
Frame encoding lives in `interfaces.chat_stream_frames`.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import suppress

import structlog

from animichi.agents.runtime_deps import OnStep, StepEvent
from animichi.interfaces.chat_stream_frames import (
    RESPONSE_DATA_ID,
    ToolPartTranslator,
    error_frames,
    response_frames,
    start_frames,
)
from animichi.interfaces.schemas import PublicAPIResponse

__all__ = ["RESPONSE_DATA_ID"]

logger = structlog.get_logger(__name__)

ChatHandler = Callable[[OnStep], Awaitable[PublicAPIResponse]]
_Queue = asyncio.Queue["str | None"]
_PRODUCER_CANCEL_GRACE_SECONDS = 0.25
_DETACHED_PRODUCERS: set[asyncio.Task[None]] = set()


async def _put_all(queue: _Queue, frames: Sequence[str]) -> None:
    for frame in frames:
        await queue.put(frame)


def _make_on_step(queue: _Queue, translator: ToolPartTranslator) -> OnStep:
    async def on_step(step: StepEvent) -> None:
        await _put_all(queue, translator.translate(step))

    return on_step


async def _handle_error(
    queue: _Queue, translator: ToolPartTranslator, exc: Exception
) -> None:
    logger.exception("chat_stream_error", error=str(exc))
    await _put_all(queue, [*translator.terminal_errors(), *error_frames()])


async def _produce(handler: ChatHandler, queue: _Queue) -> None:
    translator = ToolPartTranslator()
    await _put_all(queue, start_frames())
    try:
        response = await handler(_make_on_step(queue, translator))
        await _put_all(queue, _terminal_frames(translator, response))
    except Exception as exc:
        await _handle_error(queue, translator, exc)
    finally:
        await queue.put(None)


def _terminal_frames(
    translator: ToolPartTranslator, response: PublicAPIResponse
) -> list[str]:
    return [*translator.terminal_errors(), *response_frames(response)]


async def _drain(queue: _Queue) -> AsyncIterator[str]:
    while True:
        chunk = await queue.get()
        if chunk is None:
            return
        yield chunk


def _consume_result(task: asyncio.Task[None]) -> None:
    _DETACHED_PRODUCERS.discard(task)
    with suppress(asyncio.CancelledError):
        task.exception()


def _track_result(task: asyncio.Task[None]) -> None:
    _DETACHED_PRODUCERS.add(task)
    task.add_done_callback(_consume_result)


def _finish_or_track(task: asyncio.Task[None]) -> None:
    if task.done():
        _consume_result(task)
        return
    _track_result(task)


async def _wait_for_result(task: asyncio.Task[None]) -> bool:
    try:
        done, _ = await asyncio.wait({task}, timeout=_PRODUCER_CANCEL_GRACE_SECONDS)
    except asyncio.CancelledError:
        _finish_or_track(task)
        raise
    return task in done


async def _settle(task: asyncio.Task[None], turn_key: str | None) -> None:
    if task.done():
        _consume_result(task)
        return
    # The producer is still running while the consumer stopped pulling
    # frames early — the only way that happens is the client disconnecting
    # mid-stream (P0 §2.1). Log unconditionally, before the cancellation
    # grace wait, so the line lands whether or not the producer cancels
    # promptly.
    task.cancel()
    logger.warning("chat_stream_client_disconnected", turn_key=turn_key)
    if await _wait_for_result(task):
        _consume_result(task)
        return
    _track_result(task)
    logger.warning("chat_stream_cancel_timeout", turn_key=turn_key)


async def stream_chat(
    handler: ChatHandler, turn_key: str | None = None
) -> AsyncIterator[str]:
    """Yield SSE frames for one chat turn: start -> tools -> data -> finish."""
    queue: _Queue = asyncio.Queue()
    task = asyncio.create_task(_produce(handler, queue))
    try:
        async for frame in _drain(queue):
            yield frame
    finally:
        await _settle(task, turn_key)
