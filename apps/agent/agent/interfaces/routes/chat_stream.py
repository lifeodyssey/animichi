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
    ToolOutputErrorChunk,
)

from agent.agents.runtime_deps import OnStep, StepEvent
from agent.interfaces.chat_wire import chat_response_wire
from agent.interfaces.schemas import GRACEFUL_TERMINAL_STATUSES, PublicAPIResponse

logger = structlog.get_logger(__name__)

RESPONSE_DATA_ID = "response"
_SDK_VERSION = 6
_ERROR_TEXT = "Something went wrong. Please try again."

ChatHandler = Callable[[OnStep], Awaitable[PublicAPIResponse]]
_Queue = asyncio.Queue["str | None"]


class _ToolPartTranslator:
    """Map running/done step events onto AI SDK tool parts with stable IDs."""

    def __init__(self) -> None:
        self._active: set[str] = set()

    def translate(self, step: StepEvent) -> list[BaseChunk]:
        if step.status == "running":
            return self._begin(step)
        if step.status == "done":
            return self._finish(step)
        return self._error(step.call_id)

    def _begin(self, step: StepEvent) -> list[BaseChunk]:
        self._active.add(step.call_id)
        return [
            ToolInputStartChunk(tool_call_id=step.call_id, tool_name=step.tool),
            ToolInputAvailableChunk(
                tool_call_id=step.call_id, tool_name=step.tool, input=step.data
            ),
        ]

    def _finish(self, step: StepEvent) -> list[BaseChunk]:
        self._active.discard(step.call_id)
        return [ToolOutputAvailableChunk(tool_call_id=step.call_id, output=step.data)]

    def _error(self, call_id: str) -> list[BaseChunk]:
        self._active.discard(call_id)
        return [ToolOutputErrorChunk(tool_call_id=call_id, error_text=_ERROR_TEXT)]

    def terminal_errors(self) -> list[BaseChunk]:
        chunks = [
            chunk for call_id in list(self._active) for chunk in self._error(call_id)
        ]
        return chunks


def _data_parts(response: PublicAPIResponse) -> list[BaseChunk]:
    return [
        DataChunk(
            type="data-response", id=RESPONSE_DATA_ID, data={"intent": response.intent}
        ),
        DataChunk(
            type="data-response",
            id=RESPONSE_DATA_ID,
            data=chat_response_wire(response),
        ),
    ]


def _response_chunks(response: PublicAPIResponse) -> list[BaseChunk]:
    finish_reason = "error" if _is_failure(response) else "stop"
    return [
        *_data_parts(response),
        FinishStepChunk(),
        FinishChunk(finish_reason=finish_reason),
        DoneChunk(),
    ]


def _is_failure(response: PublicAPIResponse) -> bool:
    return not response.success and response.status not in GRACEFUL_TERMINAL_STATUSES


def _error_chunks() -> list[BaseChunk]:
    return [
        ErrorChunk(error_text=_ERROR_TEXT),
        FinishStepChunk(),
        FinishChunk(finish_reason="error"),
        DoneChunk(),
    ]


async def _put_all(queue: _Queue, chunks: Sequence[BaseChunk]) -> None:
    for chunk in chunks:
        await queue.put(_frame(chunk))


def _make_on_step(queue: _Queue, translator: _ToolPartTranslator) -> OnStep:
    async def on_step(step: StepEvent) -> None:
        await _put_all(queue, translator.translate(step))

    return on_step


async def _handle_error(
    queue: _Queue, translator: _ToolPartTranslator, exc: Exception
) -> None:
    logger.exception("chat_stream_error", error=str(exc))
    await _put_all(queue, [*translator.terminal_errors(), *_error_chunks()])


async def _produce(handler: ChatHandler, queue: _Queue) -> None:
    translator = _ToolPartTranslator()
    await _put_all(queue, [StartChunk(), StartStepChunk()])
    try:
        response = await handler(_make_on_step(queue, translator))
        await _put_all(queue, _terminal_chunks(translator, response))
    except Exception as exc:
        await _handle_error(queue, translator, exc)
    finally:
        await queue.put(None)


def _terminal_chunks(
    translator: _ToolPartTranslator, response: PublicAPIResponse
) -> list[BaseChunk]:
    return [*translator.terminal_errors(), *_response_chunks(response)]


async def _drain(queue: _Queue) -> AsyncIterator[str]:
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
        async for frame in _drain(queue):
            yield frame
    finally:
        await _settle(task)
