"""AI SDK UI stream frames over pydantic-ai Vercel chunk types.

Encodes every SSE frame the chat endpoint emits; callers handle plain frame
strings only. The data-part projection (TURN-4 #955) maps the internal
response onto the /v1/chat wire shape — the strict zod contract in
``packages/contract/src/chat-data-parts.ts`` is the authority.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from pydantic import JsonValue
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
from animichi.interfaces.schemas import (
    GRACEFUL_TERMINAL_STATUSES,
    JsonObject,
    PublicAPIResponse,
)

RESPONSE_DATA_ID = "response"
_SDK_VERSION = 6
_ERROR_TEXT = "Something went wrong. Please try again."


def encode_frame(chunk: BaseChunk) -> str:
    """Encode one AI SDK chunk as a full SSE data frame."""
    return f"data: {chunk.encode(_SDK_VERSION)}\n\n"


def encode_data_chunk(part_payload: Mapping[str, object]) -> str:
    """One overwritable data part under the shared response ID."""
    return encode_frame(
        DataChunk(type="data-response", id=RESPONSE_DATA_ID, data=part_payload)
    )


def encode_start_chunk() -> str:
    return encode_frame(StartChunk())


def encode_start_step_chunk() -> str:
    """The first step start part."""
    return encode_frame(StartStepChunk())


def encode_finish_step_chunk() -> str:
    return encode_frame(FinishStepChunk())


def encode_finish_chunk(finish_reason: str) -> str:
    return encode_frame(FinishChunk(finish_reason=finish_reason))


def encode_done_chunk() -> str:
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


def chat_response_wire(response: PublicAPIResponse) -> JsonObject:
    """Project the internal response onto the /v1/chat wire data part.

    Pure dict mapping — no handwritten DTO classes. The Session offer
    (``revision`` + ``session_digest``, TURN-4 #955) rides on it for the web
    to echo back.
    """
    wire = dict(response.model_dump(mode="json", exclude_none=True))
    wire["data"] = _wire_data(response)
    return wire


_CLARIFY_WIRE_KEYS = frozenset({"reason", "clarification_id", "candidates", "outcome"})
_CANDIDATE_WIRE_KEYS = frozenset(
    {
        "id",
        "bangumi_id",
        "title",
        "title_cn",
        "cover_url",
        "year",
        "points_count",
        "lat",
        "lng",
    }
)


def _wire_data(response: PublicAPIResponse) -> JsonObject:
    if response.intent in {"search_bangumi", "search_nearby"}:
        return {"results": _search_results(response.data)}
    if response.intent in {"plan_route", "plan_selected", "plan_multi", "partial"}:
        return {
            "results": _search_results(response.data),
            "itinerary": _itinerary(response.data),
        }
    if response.intent == "clarify":
        return _clarify_data(response.data)
    return {}


def _clarify_data(data: JsonObject) -> JsonObject:
    """Project the clarify payload, stripping internal candidate fields."""
    values = cast(
        JsonObject, _compact({k: data[k] for k in _CLARIFY_WIRE_KEYS if k in data})
    )
    raw_candidates = values.get("candidates")
    cleaned: list[JsonObject] = []
    if isinstance(raw_candidates, list):
        for candidate in raw_candidates:
            if isinstance(candidate, dict):
                cleaned.append(
                    cast(
                        JsonObject,
                        _compact(
                            {
                                k: candidate[k]
                                for k in _CANDIDATE_WIRE_KEYS
                                if k in candidate
                            }
                        ),
                    )
                )
    values["candidates"] = cast(JsonValue, cleaned)
    return values


def _compact(value: object) -> object:
    if isinstance(value, dict):
        return {key: _compact(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_compact(item) for item in value if item is not None]
    return value


_SEARCH_WIRE_KEYS = frozenset(
    {
        "kind",
        "bangumi_id",
        "title",
        "row_count",
        "status",
        "strategy",
        "summary",
        "rows",
    }
)


def _search_results(data: JsonObject) -> JsonObject:
    raw = data.get("results")
    if not isinstance(raw, dict):
        return {}
    values = cast(
        JsonObject,
        _compact({key: raw[key] for key in _SEARCH_WIRE_KEYS if key in raw}),
    )
    bangumi_id = raw.get("bangumi_id", raw.get("anime_id"))
    if bangumi_id is not None:
        values["bangumi_id"] = bangumi_id
    metadata = raw.get("metadata")
    if isinstance(metadata, dict):
        values["title"] = raw.get("title", metadata.get("anime_title"))
    return values


_ITINERARY_WIRE_KEYS = frozenset(
    {
        "id",
        "version",
        "ordered_points",
        "point_count",
        "cover_url",
        "anime_title",
        "anime_title_cn",
        "truncated",
        "shown_cluster_count",
        "total_cluster_count",
        "timed_itinerary",
        "status",
        "total_walk_minutes",
    }
)


def _itinerary(data: JsonObject) -> JsonObject:
    raw = data.get("route")
    if not isinstance(raw, dict):
        return {}
    return cast(
        JsonObject,
        _compact({key: raw[key] for key in _ITINERARY_WIRE_KEYS if key in raw}),
    )


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
