"""Strict, versioned session state for the agent redesign."""

from __future__ import annotations

from typing import Literal, NewType, Self, TypeAlias, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

from agent.domain.compaction_retention import RetainedEntityLedger
from agent.domain.fact_ledger import FactLedger

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

    kind: Literal["bangumi", "nearby", "multi"]
    rows: list[PointState] = Field(default_factory=list)
    row_count: int = 0
    metadata: SearchMetadataState | None = None
    nearby_groups: list[NearbyGroupState] | None = None
    anime_id: str | None = None
    anime_ids: list[str] | None = None
    omitted_work_ids: list[str] | None = None
    partial: bool = False


class TimedStopState(_SessionModel):
    """Strict persisted stop within a timed route."""

    cluster_id: str
    name: str
    arrive: str
    depart: str
    dwell_minutes: int
    lat: float
    lng: float
    photo_count: int
    points: list[PointState] = Field(default_factory=list)


class TransitLegState(_SessionModel):
    """Strict persisted walking leg between timed stops."""

    from_id: str
    to_id: str
    mode: Literal["walk"]
    duration_minutes: int
    distance_m: float


class TimedItineraryState(_SessionModel):
    """Strict session-local snapshot of a timed itinerary."""

    stops: list[TimedStopState] = Field(default_factory=list)
    legs: list[TransitLegState] = Field(default_factory=list)
    total_minutes: int = 0
    total_distance_m: float = 0.0
    spot_count: int = 0
    pacing: Literal["chill", "normal", "packed"] = "normal"
    start_time: str = "09:00"
    export_google_maps_url: list[str] = Field(default_factory=list)
    export_ics: str = ""


class RoutePayloadState(_SessionModel):
    """Full route payload addressed by a server-owned route ref."""

    ordered_points: list[PointState] = Field(default_factory=list)
    timed_itinerary: TimedItineraryState | None = None
    summary: RouteSummaryState | None = None
    source_ref: ResultRef | None = None


class OrderedCandidate(_SessionModel):
    """Trusted candidate display data in stable order."""

    id: str
    title: str
    cover_url: str | None = None
    city: str | None = None
    points_count: int | None = None
    lat: float | None = None
    lng: float | None = None
    effective_radius_m: int | None = Field(default=None, gt=0)


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


class StaleRef(_SessionModel):
    """Typed, non-throwing outcome for an unknown or evicted registry ref."""

    status: Literal["stale_ref"] = "stale_ref"


SearchResultLookup: TypeAlias = SearchPayloadState | StaleRef
RouteLookup: TypeAlias = RoutePayloadState | StaleRef


class SessionState(_SessionModel):
    """Versioned identity, candidate, search, and route carrier."""

    current_anime: CurrentAnime | None = None
    search_results: dict[ResultRef, SearchPayloadState] = Field(default_factory=dict)
    search_result_lru: list[ResultRef] = Field(default_factory=list)
    routes: dict[RouteRef, RoutePayloadState] = Field(default_factory=dict)
    route_lru: list[RouteRef] = Field(default_factory=list)
    pending_clarification: PendingClarification | None = None
    geocode_staging: GeocodeStaging | None = None
    last_result_ref: ResultRef | None = None
    clarification_revision: int = 0
    fact_ledger: FactLedger = Field(default_factory=FactLedger)
    compaction_retained_entities: RetainedEntityLedger = Field(
        default_factory=RetainedEntityLedger
    )

    @model_validator(mode="after")
    def _bound_restored_registries(self) -> Self:
        fields = self.model_fields_set
        self.search_result_lru = _restore_lru(
            self.search_results,
            self.search_result_lru,
            "search_result_lru" in fields,
        )
        self.route_lru = _restore_lru(
            self.routes, self.route_lru, "route_lru" in fields
        )
        self.compaction_retained_entities.enforce_bounds()
        return self

    def store_search_result(self, ref: ResultRef, payload: SearchPayloadState) -> None:
        """Store and mark a search payload as the most recently used."""
        _store_lru(self.search_results, self.search_result_lru, ref, payload)
        self.last_result_ref = ref

    def next_search_ref(self, kind: str, seed: int) -> ResultRef:
        """Return the first collision-free opaque search ref at or above seed."""
        while ResultRef(f"search:{kind}:{seed}") in self.search_results:
            seed += 1
        return ResultRef(f"search:{kind}:{seed}")

    def get_search_result(self, ref: ResultRef) -> SearchResultLookup:
        """Return a search payload or a typed stale-ref outcome."""
        payload = self.search_results.get(ref)
        if payload is None:
            return StaleRef()
        _store_lru(self.search_results, self.search_result_lru, ref, payload)
        return payload

    def store_route(self, ref: RouteRef, payload: RoutePayloadState) -> None:
        """Store and mark a route payload as the most recently used."""
        _store_lru(self.routes, self.route_lru, ref, payload)

    def next_route_ref(self, kind: str, seed: int) -> RouteRef:
        """Return the first collision-free opaque route ref at or above seed."""
        while RouteRef(f"route:{kind}:{seed}") in self.routes:
            seed += 1
        return RouteRef(f"route:{kind}:{seed}")

    def get_route(self, ref: RouteRef) -> RouteLookup:
        """Return a route payload or a typed stale-ref outcome."""
        payload = self.routes.get(ref)
        if payload is None:
            return StaleRef()
        _store_lru(self.routes, self.route_lru, ref, payload)
        return payload

    def is_empty(self) -> bool:
        """Return whether the state carries only model defaults."""
        return not self.model_dump(exclude_defaults=True, exclude_none=True)


def _store_lru(
    registry: dict[RefT, PayloadT], lru: list[RefT], ref: RefT, payload: PayloadT
) -> None:
    registry[ref] = payload
    if ref in lru:
        lru.remove(ref)
    lru.append(ref)
    _trim_lru(registry, lru)


def _restore_lru(
    registry: dict[RefT, PayloadT], lru: list[RefT], explicit: bool
) -> list[RefT]:
    candidates = lru if explicit else list(registry)
    ordered = list(dict.fromkeys(ref for ref in candidates if ref in registry))
    trimmed = ordered[-MAX_REFS:]
    for ref in set(registry) - set(trimmed):
        registry.pop(ref)
    return trimmed


def _trim_lru(registry: dict[RefT, PayloadT], lru: list[RefT]) -> None:
    while len(lru) > MAX_REFS:
        registry.pop(lru.pop(0), None)
