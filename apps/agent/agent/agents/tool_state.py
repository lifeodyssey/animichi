"""Typed, session-scoped state accumulated by agent tools."""

from __future__ import annotations

from typing import Literal, TypeAlias, cast

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from agent.agents.models import TimedItinerary, ToolName
from agent.agents.session_state import SessionState

LegacyPayload: TypeAlias = dict[str, JsonValue]


class _LegacyCompatibleModel(BaseModel):
    """Retain unknown fields hydrated by the persisted search-session seed."""

    model_config = ConfigDict(extra="allow")


class _RuntimePayloadModel(BaseModel):
    """Reject unknown fields in payloads written only by typed runtime code."""

    model_config = ConfigDict(extra="forbid")


class PointState(_LegacyCompatibleModel):
    """A search or route point; fields are optional for legacy session rows."""

    id: str | None = None
    name: str | None = None
    name_cn: str | None = None
    episode: int | None = None
    time_seconds: int | None = None
    screenshot_url: str | None = None
    bangumi_id: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    title: str | None = None
    title_cn: str | None = None
    distance_m: float | None = None
    origin: str | None = None
    cover_url: str | None = None
    city: str | None = None


class CandidateState(_RuntimePayloadModel):
    """Resolve/clarify candidate shared by live tools and session backfill."""

    title: str
    bangumi_id: str | None = None
    cover_url: str | None = None
    city: str | None = None
    points_count: int | None = None
    spot_count: int | None = None


class ResolveAnimeState(_RuntimePayloadModel):
    """State emitted by ``resolve_anime``."""

    bangumi_id: str | None = None
    title: str | None = None
    ambiguous: bool | None = None
    candidates: list[CandidateState] = Field(default_factory=list)


class SearchMetadataState(_LegacyCompatibleModel):
    """Anime metadata attached to a search payload."""

    anime_title: str | None = None
    anime_title_cn: str | None = None
    cover_url: str | None = None
    data_origin: str | None = None
    source: str | None = None
    radius_m: int | None = None
    cache: str | None = None


class NearbyGroupState(_LegacyCompatibleModel):
    """One anime grouping in nearby-search results."""

    bangumi_id: str
    title: str
    cover_url: str | None = None
    points_count: int | None = None
    closest_distance_m: float | None = None


class SearchSummaryState(_LegacyCompatibleModel):
    """Compact search result counts and provenance."""

    count: int
    source: str
    cache: str


class SearchState(_LegacyCompatibleModel):
    """Shared state shape for bangumi and nearby searches."""

    rows: list[PointState] = Field(default_factory=list)
    items: list[PointState] | None = None
    row_count: int = 0
    strategy: Literal["geo", "bangumi"] | None = None
    metadata: SearchMetadataState | None = None
    nearby_groups: list[NearbyGroupState] | None = None
    status: str | None = None
    empty: bool | None = None
    summary: SearchSummaryState | None = None


class RouteSummaryState(_RuntimePayloadModel):
    """Counts and distance totals attached to a planned route."""

    point_count: int
    total_minutes: int
    total_distance_m: float
    clusters: int
    with_coordinates: int
    without_coordinates: int


class RouteState(_RuntimePayloadModel):
    """State emitted by route planning and selected-point routing."""

    ordered_points: list[PointState] = Field(default_factory=list)
    timed_itinerary: TimedItinerary | None = None
    point_count: int = 0
    cover_url: str | None = None
    status: str | None = None
    summary: RouteSummaryState | None = None


class InfoState(_RuntimePayloadModel):
    """State emitted by greeting and general-QA tools."""

    message: str
    status: str


class ClarifyState(_RuntimePayloadModel):
    """State emitted by the clarification tool."""

    question: str
    options: list[str] = Field(default_factory=list)
    candidates: list[CandidateState] = Field(default_factory=list)
    status: Literal["needs_clarification"]
    action_required: str | None = None


ToolPayload: TypeAlias = (
    ResolveAnimeState | SearchState | RouteState | InfoState | ClarifyState
)


class ToolState(BaseModel):
    """Typed runtime state with an explicit legacy-dict serialization boundary."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    session: SessionState = Field(default_factory=SessionState)
    locale: str | None = None
    last_location: str | None = None
    origin_lat: float | None = None
    origin_lng: float | None = None
    resolve_candidates: list[CandidateState | str] | None = None
    pending_clarify: bool | None = None
    resolve_anime: ResolveAnimeState | None = None
    search_bangumi: SearchState | None = None
    search_nearby: SearchState | None = None
    plan_route: RouteState | None = None
    plan_selected: RouteState | None = None
    answer_question: InfoState | None = None
    greet_user: InfoState | None = None
    clarify: ClarifyState | None = None

    def set_payload(self, tool: ToolName, payload: object) -> None:
        """Validate a tool payload into its corresponding typed sub-state."""
        model_type = _PAYLOAD_MODELS[tool]
        setattr(self, tool.value, model_type.model_validate(payload))

    def remove_payload(self, tool: ToolName) -> None:
        """Clear a tool result before a new attempt."""
        setattr(self, tool.value, None)
        self.__pydantic_fields_set__.discard(tool.value)

    def payload_for(self, tool: str) -> LegacyPayload | None:
        """Serialize one tool payload for an existing wire/UI boundary."""
        payload = getattr(self, tool, None)
        if not isinstance(payload, BaseModel):
            return None
        return cast(LegacyPayload, _dump_model(payload))

    def has_payload(self, tool: str) -> bool:
        """Return whether a tool has populated state."""
        return isinstance(getattr(self, tool, None), BaseModel)

    def legacy_keys(self) -> set[str]:
        """Return keys present at the historical dictionary boundary."""
        return set(self.to_legacy_dict())

    def to_legacy_dict(self) -> LegacyPayload:
        """Serialize to the exact heterogeneous dict shape used historically."""
        return cast(
            LegacyPayload,
            self.model_dump(mode="json", exclude_unset=True, exclude={"session"}),
        )


def _dump_model(model: BaseModel) -> object:
    return model.model_dump(mode="json", exclude_unset=True)


_PAYLOAD_MODELS: dict[ToolName, type[ToolPayload]] = {
    ToolName.RESOLVE_ANIME: ResolveAnimeState,
    ToolName.SEARCH_BANGUMI: SearchState,
    ToolName.SEARCH_NEARBY: SearchState,
    ToolName.PLAN_ROUTE: RouteState,
    ToolName.PLAN_SELECTED: RouteState,
    ToolName.ANSWER_QUESTION: InfoState,
    ToolName.GREET_USER: InfoState,
    ToolName.CLARIFY: ClarifyState,
}
