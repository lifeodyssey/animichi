"""Progressive AI SDK UI message stream over pydantic-ai Vercel chunk types.

Emits the standard AI SDK UI message stream on `/v1/chat`: tool parts for
tool-call progress, and custom `data-response` parts overwritten in place by a
single ID so the discriminated `intent` field is readable ahead of the rest.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import suppress

import structlog
from pydantic_ai.ui.vercel_ai.response_types import (
    BaseChunk,
    DataChunk,
    DoneChunk,
    ErrorChunk,
    FinishChunk,
    FinishStepChunk,
    StartChunk,
    StartStepChunk,
    ToolInputAvailableChunk,
    ToolInputStartChunk,
    ToolOutputAvailableChunk,
)

from agent.agents.runtime_deps import OnStep, StepEvent
from agent.interfaces.schemas import PublicAPIResponse

logger = structlog.get_logger(__name__)

RESPONSE_DATA_ID = "response"
_SDK_VERSION = 6
_ERROR_TEXT = "Something went wrong. Please try again."

ChatHandler = Callable[[OnStep], Awaitable[PublicAPIResponse]]
_Queue = asyncio.Queue["BaseChunk | None"]


class _ToolPartTranslator:
    """Map running/done step events onto AI SDK tool parts with stable IDs."""

    def __init__(self) -> None:
        self._call_ids: dict[str, str] = {}
        self._count = 0

    def translate(self, step: StepEvent) -> list[BaseChunk]:
        if step.status == "running":
            return self._begin(step)
        return self._finish(step)

    def _begin(self, step: StepEvent) -> list[BaseChunk]:
        self._count += 1
        call_id = f"{step.tool}-{self._count}"
        self._call_ids[step.tool] = call_id
        return [
            ToolInputStartChunk(tool_call_id=call_id, tool_name=step.tool),
            ToolInputAvailableChunk(
                tool_call_id=call_id, tool_name=step.tool, input=step.data
            ),
        ]

    def _finish(self, step: StepEvent) -> list[BaseChunk]:
        call_id = self._call_ids.get(step.tool, f"{step.tool}-0")
        return [ToolOutputAvailableChunk(tool_call_id=call_id, output=step.data)]


def _data_parts(response: PublicAPIResponse) -> list[BaseChunk]:
    return [
        DataChunk(
            type="data-response", id=RESPONSE_DATA_ID, data={"intent": response.intent}
        ),
        DataChunk(
            type="data-response",
            id=RESPONSE_DATA_ID,
            data=response.model_dump(mode="json"),
        ),
    ]


def _response_chunks(response: PublicAPIResponse) -> list[BaseChunk]:
    return [
        *_data_parts(response),
        FinishStepChunk(),
        FinishChunk(finish_reason="stop"),
        DoneChunk(),
    ]


def _error_chunks() -> list[BaseChunk]:
    return [
        ErrorChunk(error_text=_ERROR_TEXT),
        FinishStepChunk(),
        FinishChunk(finish_reason="error"),
        DoneChunk(),
    ]


async def _put_all(queue: _Queue, chunks: Sequence[BaseChunk]) -> None:
    for chunk in chunks:
        await queue.put(chunk)


def _make_on_step(queue: _Queue) -> OnStep:
    translator = _ToolPartTranslator()

    async def on_step(step: StepEvent) -> None:
        await _put_all(queue, translator.translate(step))

    return on_step


async def _produce(handler: ChatHandler, queue: _Queue) -> None:
    await _put_all(queue, [StartChunk(), StartStepChunk()])
    try:
        response = await handler(_make_on_step(queue))
    except Exception as exc:
        logger.exception("chat_stream_error", error=str(exc))
        await _put_all(queue, _error_chunks())
    else:
        await _put_all(queue, _response_chunks(response))
    await queue.put(None)


async def _drain(queue: _Queue) -> AsyncIterator[BaseChunk]:
    while True:
        chunk = await queue.get()
        if chunk is None:
            return
        yield chunk


def _frame(chunk: BaseChunk) -> str:
    return f"data: {chunk.encode(_SDK_VERSION)}\n\n"


async def _settle(task: asyncio.Task[None]) -> None:
    if task.done():
        await task
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def stream_chat(handler: ChatHandler) -> AsyncIterator[str]:
    """Yield SSE frames for one chat turn: start -> tools -> data -> finish."""
    queue: _Queue = asyncio.Queue()
    task = asyncio.create_task(_produce(handler, queue))
    try:
        async for chunk in _drain(queue):
            yield _frame(chunk)
    finally:
        await _settle(task)
