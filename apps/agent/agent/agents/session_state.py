"""Strict, versioned session state for the agent redesign."""

from __future__ import annotations

from typing import Literal, NewType, Self, TypeAlias, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

from agent.agents.models import TimedItinerary

MAX_REFS = 8

ResultRef = NewType("ResultRef", str)
RouteRef = NewType("RouteRef", str)

RefT = TypeVar("RefT")
PayloadT = TypeVar("PayloadT")


class _SessionModel(BaseModel):
    """Base for strict persisted state models."""

    model_config = ConfigDict(extra="forbid")


class PointState(_SessionModel):
    """Strict point snapshot stored in the versioned session registry."""

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


class SearchMetadataState(_SessionModel):
    """Metadata accompanying a stored search payload."""

    anime_title: str | None = None
    anime_title_cn: str | None = None
    cover_url: str | None = None
    data_origin: str | None = None
    source: str | None = None
    radius_m: int | None = None
    cache: str | None = None


class NearbyGroupState(_SessionModel):
    """One stored nearby-search anime group."""

    bangumi_id: str
    title: str
    cover_url: str | None = None
    points_count: int | None = None
    closest_distance_m: float | None = None


class RouteSummaryState(_SessionModel):
    """Counts and totals for a stored route."""

    point_count: int
    total_minutes: int
    total_distance_m: float
    clusters: int
    with_coordinates: int
    without_coordinates: int


class CurrentAnime(_SessionModel):
    """Stable anime identity carried across turns."""

    bangumi_id: str
    title: str


class SearchPayloadState(_SessionModel):
    """Full search payload addressed by a server-owned result ref."""

    kind: Literal["bangumi", "nearby"]
    rows: list[PointState] = Field(default_factory=list)
    row_count: int = 0
    metadata: SearchMetadataState | None = None
    nearby_groups: list[NearbyGroupState] | None = None
    anime_id: str | None = None
    partial: bool = False


class RoutePayloadState(_SessionModel):
    """Full route payload addressed by a server-owned route ref."""

    ordered_points: list[PointState] = Field(default_factory=list)
    timed_itinerary: TimedItinerary | None = None
    summary: RouteSummaryState | None = None
    source_ref: ResultRef | None = None


class OrderedCandidate(_SessionModel):
    """Trusted candidate display data in stable order."""

    id: str
    title: str
    cover_url: str | None = None
    city: str | None = None
    points_count: int | None = None


ClarificationReason: TypeAlias = Literal[
    "anime_ambiguity",
    "place_ambiguity",
    "place_too_broad",
    "unknown_place",
    "missing_location",
    "anime_not_found",
]


class PendingClarification(_SessionModel):
    """Sole authoritative candidate oracle for a pending clarification."""

    reason: ClarificationReason
    candidate_ids: list[str] = Field(default_factory=list)
    ordered_candidates: list[OrderedCandidate] = Field(default_factory=list)
    revision: int


class GeocodeStaging(_SessionModel):
    """Pre-clarification staging for trusted geocoder candidates."""

    candidates: list[OrderedCandidate] = Field(default_factory=list)


class RouteStaleRef(_SessionModel):
    """Typed, non-throwing outcome for an unknown or evicted search ref."""

    status: Literal["stale_ref"] = "stale_ref"


SearchResultLookup: TypeAlias = SearchPayloadState | RouteStaleRef


class SessionState(_SessionModel):
    """Versioned identity, candidate, search, and route carrier."""

    current_anime: CurrentAnime | None = None
    search_results: dict[ResultRef, SearchPayloadState] = Field(default_factory=dict)
    routes: dict[RouteRef, RoutePayloadState] = Field(default_factory=dict)
    pending_clarification: PendingClarification | None = None
    geocode_staging: GeocodeStaging | None = None
    last_result_ref: ResultRef | None = None
    clarification_revision: int = 0

    @model_validator(mode="after")
    def _bound_restored_registries(self) -> Self:
        _trim_lru(self.search_results)
        _trim_lru(self.routes)
        return self

    def store_search_result(self, ref: ResultRef, payload: SearchPayloadState) -> None:
        """Store and mark a search payload as the most recently used."""
        _store_lru(self.search_results, ref, payload)
        self.last_result_ref = ref

    def get_search_result(self, ref: ResultRef) -> SearchResultLookup:
        """Return a search payload or a typed stale-ref outcome."""
        payload = self.search_results.get(ref)
        if payload is None:
            return RouteStaleRef()
        _store_lru(self.search_results, ref, payload)
        return payload

    def store_route(self, ref: RouteRef, payload: RoutePayloadState) -> None:
        """Store and mark a route payload as the most recently used."""
        _store_lru(self.routes, ref, payload)

    def get_route(self, ref: RouteRef) -> RoutePayloadState | None:
        """Return a route payload and update its recency when present."""
        payload = self.routes.get(ref)
        if payload is not None:
            _store_lru(self.routes, ref, payload)
        return payload

    def is_empty(self) -> bool:
        """Return whether the state carries only model defaults."""
        return not self.model_dump(exclude_defaults=True, exclude_none=True)


def _store_lru(registry: dict[RefT, PayloadT], ref: RefT, payload: PayloadT) -> None:
    registry.pop(ref, None)
    registry[ref] = payload
    _trim_lru(registry)


def _trim_lru(registry: dict[RefT, PayloadT]) -> None:
    while len(registry) > MAX_REFS:
        oldest = next(iter(registry))
        del registry[oldest]
