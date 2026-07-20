"""Named Pydantic result models for the pilgrimage agent's tool functions.

Every ``@agent.tool`` / ``@agent.tool_plain`` function returns one of these
models instead of ``dict[str, object]``, so a future ``FastMCP.from_openapi``
introspection can generate a proper ``outputSchema`` per tool. Field names,
defaults, and nesting mirror the legacy dict payloads exactly — this module
is a type-narrowing layer, not a behavior change.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from agent.agents.models import TimedItinerary
from agent.agents.runtime_models import (
    NearbyGroupModel,
    PilgrimagePointModel,
    ResultsMetadataModel,
    ResultsSummaryModel,
)

# ── resolve_anime ────────────────────────────────────────────────────────


class ResolveCandidate(BaseModel):
    """A single anime work matched by resolve_anime."""

    title: str
    bangumi_id: str
    cover_url: str = ""
    city: str = ""
    points_count: int = 0


class ResolveAnimeResult(BaseModel):
    """Result of resolve_anime: a single match, an ambiguous set, or none."""

    bangumi_id: str = ""
    title: str = ""
    ambiguous: bool = False
    candidates: list[ResolveCandidate] = Field(default_factory=list)


# ── search_bangumi / search_nearby ──────────────────────────────────────


class SearchToolResult(BaseModel):
    """Full result of search_bangumi / search_nearby, stored in tool_state."""

    rows: list[PilgrimagePointModel] = Field(default_factory=list)
    items: list[PilgrimagePointModel] = Field(default_factory=list)
    row_count: int = 0
    strategy: str = ""
    metadata: ResultsMetadataModel = Field(default_factory=ResultsMetadataModel)
    nearby_groups: list[NearbyGroupModel] = Field(default_factory=list)
    status: str = "ok"
    empty: bool = False
    summary: ResultsSummaryModel = Field(default_factory=ResultsSummaryModel)


class SearchPreviewRow(BaseModel):
    """A minimal row shown to the LLM when a search result is large."""

    name: str
    episode: int


class SearchToolPreview(BaseModel):
    """Compact LLM-facing summary of a large SearchToolResult.

    Never stored in tool_state — the full SearchToolResult is always what
    reaches the response mapper; this is only what the model sees inline.
    """

    row_count: int = 0
    status: str = "ok"
    metadata: ResultsMetadataModel = Field(default_factory=ResultsMetadataModel)
    preview: list[SearchPreviewRow] = Field(default_factory=list)
    note: str = ""


# ── plan_route ───────────────────────────────────────────────────────────


class RouteSummary(BaseModel):
    """Route-specific summary counters (distinct shape from search summary)."""

    point_count: int = 0
    total_minutes: int = 0
    total_distance_m: float = 0.0
    clusters: int = 0
    with_coordinates: int = 0
    without_coordinates: int = 0


class RouteToolResult(BaseModel):
    """Full result of plan_route, stored in tool_state."""

    ordered_points: list[PilgrimagePointModel] = Field(default_factory=list)
    timed_itinerary: TimedItinerary = Field(default_factory=TimedItinerary)
    point_count: int = 0
    cover_url: str = ""
    status: str = "ok"
    summary: RouteSummary = Field(default_factory=RouteSummary)


# ── greet_user / general_qa ──────────────────────────────────────────────


class MessageToolResult(BaseModel):
    """Shared result shape for the two ephemeral echo tools."""

    message: str = ""
    status: str = "info"


# ── clarify ──────────────────────────────────────────────────────────────


class ClarifyCandidate(BaseModel):
    """An enriched clarify candidate. cover_url is None when unknown."""

    title: str
    cover_url: str | None = None
    spot_count: int = 0
    city: str = ""


class ClarifyToolResult(BaseModel):
    """Result of the clarify tool.

    ``action_required`` signals to the LLM that it must stop and return
    clarify_response now. Without it, some models (e.g. DeepSeek V4 Flash)
    continue calling search_bangumi instead of waiting for user input.
    """

    question: str = ""
    options: list[str] = Field(default_factory=list)
    candidates: list[ClarifyCandidate] = Field(default_factory=list)
    status: str = "needs_clarification"
    action_required: str = "return clarify_response"


# ── translate_anime_title ────────────────────────────────────────────────


class TranslateTitleResult(BaseModel):
    """Result of translate_anime_title."""

    original: str
    translated: str
    source: str
    confidence: float
