"""AI SDK UI stream frames over pydantic-ai Vercel chunk types.

Encodes every SSE frame the chat endpoint emits. The pydantic-ai chunk
models live here and never leak past this module; callers handle plain
frame strings only.
"""

from __future__ import annotations

from collections.abc import Mapping

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

from animichi.agents.runtime_deps import StepEvent
from animichi.interfaces.chat_wire import chat_response_wire
from animichi.interfaces.schemas import GRACEFUL_TERMINAL_STATUSES, PublicAPIResponse

RESPONSE_DATA_ID = "response"
_SDK_VERSION = 6
_ERROR_TEXT = "Something went wrong. Please try again."


def encode_frame(chunk: BaseChunk) -> str:
    """Encode one AI SDK chunk as a full SSE data frame."""
    return f"data: {chunk.encode(_SDK_VERSION)}\n\n"


def encode_data_chunk(part_payload: Mapping[str, object]) -> str:
    """Encode one overwritable data part under the shared response ID."""
    return encode_frame(
        DataChunk(type="data-response", id=RESPONSE_DATA_ID, data=part_payload)
    )


def encode_start_chunk() -> str:
    """Encode the stream start part."""
    return encode_frame(StartChunk())


def encode_start_step_chunk() -> str:
    """Encode the first step start part."""
    return encode_frame(StartStepChunk())


def encode_finish_step_chunk() -> str:
    """Encode the final step finish part."""
    return encode_frame(FinishStepChunk())


def encode_finish_chunk(finish_reason: str) -> str:
    """Encode the stream finish part for the given reason."""
    return encode_frame(FinishChunk(finish_reason=finish_reason))


def encode_done_chunk() -> str:
    """Encode the terminal done part."""
    return encode_frame(DoneChunk())


def encode_error_chunk() -> str:
    """Encode the generic error part without leaking exception detail."""
    return encode_frame(ErrorChunk(error_text=_ERROR_TEXT))


def start_frames() -> list[str]:
    """Frames opening every stream: start, then the first step."""
    return [encode_start_chunk(), encode_start_step_chunk()]


def data_frames(response: PublicAPIResponse) -> list[str]:
    """Data parts for a response: intent first, full wire payload second."""
    return [
        encode_data_chunk({"intent": response.intent}),
        encode_data_chunk(chat_response_wire(response)),
    ]


def response_frames(response: PublicAPIResponse) -> list[str]:
    """Terminal frames for a completed response."""
    finish_reason = "error" if _is_failure(response) else "stop"
    return [
        *data_frames(response),
        encode_finish_step_chunk(),
        encode_finish_chunk(finish_reason),
        encode_done_chunk(),
    ]


def error_frames() -> list[str]:
    """Terminal frames for a failed turn."""
    return [
        encode_error_chunk(),
        encode_finish_step_chunk(),
        encode_finish_chunk("error"),
        encode_done_chunk(),
    ]


def _is_failure(response: PublicAPIResponse) -> bool:
    return not response.success and response.status not in GRACEFUL_TERMINAL_STATUSES


class ToolPartTranslator:
    """Map running/done step events onto AI SDK tool parts with stable IDs."""

    def __init__(self) -> None:
        self._active: set[str] = set()

    def translate(self, step: StepEvent) -> list[str]:
        if step.status == "running":
            return self._begin(step)
        if step.status == "done":
            return self._finish(step)
        return self._error(step.call_id)

    def _begin(self, step: StepEvent) -> list[str]:
        self._active.add(step.call_id)
        return [
            encode_frame(
                ToolInputStartChunk(tool_call_id=step.call_id, tool_name=step.tool)
            ),
            encode_frame(
                ToolInputAvailableChunk(
                    tool_call_id=step.call_id,
                    tool_name=step.tool,
                    input=step.data,
                )
            ),
        ]

    def _finish(self, step: StepEvent) -> list[str]:
        self._active.discard(step.call_id)
        return [
            encode_frame(
                ToolOutputAvailableChunk(tool_call_id=step.call_id, output=step.data)
            )
        ]

    def _error(self, call_id: str) -> list[str]:
        self._active.discard(call_id)
        return [
            encode_frame(
                ToolOutputErrorChunk(tool_call_id=call_id, error_text=_ERROR_TEXT)
            )
        ]

    def terminal_errors(self) -> list[str]:
        return [
            frame for call_id in list(self._active) for frame in self._error(call_id)
        ]
