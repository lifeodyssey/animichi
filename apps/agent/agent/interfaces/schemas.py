"""Pydantic request/response schemas for the public API surface.

Extracted from public_api.py to reduce module size and allow reuse
by multiple adapters (FastAPI, workers, etc.).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, JsonValue, TypeAdapter, model_validator

JsonObject = dict[str, JsonValue]
_JSON_OBJECT_ADAPTER = TypeAdapter(JsonObject)


def as_json_object(value: object) -> JsonObject:
    """Validate an arbitrary boundary value as a recursive JSON object."""
    return _JSON_OBJECT_ADAPTER.validate_python(value)


GRACEFUL_TERMINAL_STATUSES: frozenset[str] = frozenset(
    {"needs_clarification", "partial", "blocked", "empty", "too_large"}
)


class PublicAPIRequest(BaseModel):
    """Public request contract for runtime execution."""

    text: str = Field(default="", description="User message to process")
    session_id: str | None = Field(
        default=None,
        description="Optional session identifier for persisting conversation state",
    )
    model: str | None = Field(
        default=None,
        description="Optional override for the runtime model used by the pipeline",
    )
    locale: Literal["ja", "zh", "en"] = Field(
        default="ja",
        description="Response locale: ja (Japanese), zh (Chinese), or en (English)",
    )
    include_debug: bool = Field(
        default=False,
        description="Include plan and step-level details in the response",
    )
    selected_point_ids: list[str] | None = Field(
        default=None,
        description="Optional point IDs to route directly without planner execution.",
    )
    selected_candidate_ids: list[str] | None = Field(
        default=None,
        description="Stable anime/place IDs selected from the pending clarify card.",
    )
    clarification_id: int | None = Field(
        default=None,
        strict=True,
        description="Pending clarification revision used to reject stale choices.",
    )
    origin: str | None = Field(
        default=None,
        description="Optional departure location for selected-point routing.",
    )
    origin_lat: float | None = Field(
        default=None,
        ge=-90.0,
        le=90.0,
        description="Optional departure latitude for coordinate-based origin.",
    )
    origin_lng: float | None = Field(
        default=None,
        ge=-180.0,
        le=180.0,
        description="Optional departure longitude for coordinate-based origin.",
    )

    @model_validator(mode="after")
    def validate_request(self) -> PublicAPIRequest:
        self.text = self.text.strip()
        if self.origin is not None:
            self.origin = self.origin.strip() or None
        self.selected_point_ids = _normalize_ids(self.selected_point_ids)
        self.selected_candidate_ids = _normalize_ids(self.selected_candidate_ids)
        point_mode = self.selected_point_ids is not None
        candidate_mode = self.selected_candidate_ids is not None
        if point_mode and candidate_mode:
            raise ValueError(
                "selected_point_ids and selected_candidate_ids are exclusive"
            )
        if (point_mode or candidate_mode) and self.text:
            raise ValueError("selection requests cannot also include text")
        if candidate_mode != (self.clarification_id is not None):
            raise ValueError(
                "clarification_id is required iff selected_candidate_ids is provided"
            )
        if not self.text and not point_mode and not candidate_mode:
            raise ValueError("text cannot be blank outside a selection request")
        # Coordinate origin fields must be provided together
        if (self.origin_lat is None) != (self.origin_lng is None):
            raise ValueError(
                "origin_lat and origin_lng must both be provided or both omitted"
            )
        return self


def _normalize_ids(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    normalized = list(
        dict.fromkeys(value for raw in values if (value := str(raw).strip()))
    )
    return normalized or None


class PublicAPIError(BaseModel):
    """Stable error payload for public callers."""

    code: str
    message: str
    details: JsonObject = Field(default_factory=dict)


class PublicAPIResponse(BaseModel):
    """Public response contract for runtime execution."""

    success: bool
    status: str
    intent: str
    session_id: str | None = None
    message: str = ""
    data: JsonObject = Field(default_factory=dict)
    session: JsonObject = Field(default_factory=dict)
    route_history: list[JsonObject] = Field(default_factory=list)
    errors: list[PublicAPIError] = Field(default_factory=list)
    ui: dict[str, str] | None = Field(
        default=None,
        description="Optional Generative UI descriptor: {component}",
    )
    generated_title: str | None = Field(
        default=None,
        description="LLM-generated conversation title (first interaction only)",
    )
    debug: JsonObject | None = None
