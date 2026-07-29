"""Strict Python projection for the public chat data-part contract."""

from __future__ import annotations

from typing import Literal, cast

from pydantic import BaseModel, ConfigDict

from agent.interfaces.schemas import JsonObject, PublicAPIResponse

ChatIntent = Literal[
    "search_bangumi",
    "search_nearby",
    "plan_route",
    "plan_selected",
    "plan_multi",
    "general_qa",
    "greet_user",
    "clarify",
    "partial",
    "blocked",
    "unknown",
    "error",
]


class _WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StreamPoint(_WireModel):
    id: str | None = None
    name: str | None = None
    name_cn: str | None = None
    bangumi_id: str | None = None
    episode: int | None = None
    time_seconds: int | None = None
    screenshot_url: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    title: str | None = None
    title_cn: str | None = None
    distance_m: float | None = None
    origin: str | None = None
    cover_url: str | None = None
    city: str | None = None
    lat: float | None = None
    lng: float | None = None
    ep: int | None = None


class SearchResults(_WireModel):
    kind: Literal["bangumi", "nearby", "multi"] | None = None
    bangumi_id: str | int | None = None
    title: str | None = None
    row_count: int | None = None
    status: str | None = None
    strategy: str | None = None
    summary: JsonObject | None = None
    rows: list[StreamPoint] | None = None


class TimedStop(_WireModel):
    cluster_id: str
    name: str
    arrive: str
    depart: str
    dwell_minutes: int
    lat: float
    lng: float
    photo_count: int


class TransitLeg(_WireModel):
    from_id: str
    to_id: str
    mode: Literal["walk", "transit"]
    duration_minutes: int
    distance_m: float


class TimedItinerary(_WireModel):
    stops: list[TimedStop]
    legs: list[TransitLeg]
    total_minutes: int
    total_distance_m: float
    spot_count: int | None = None
    pacing: Literal["chill", "normal", "packed"] | None = None
    start_time: str | None = None
    export_google_maps_url: list[str] | None = None
    export_ics: str | None = None


class StreamRoute(_WireModel):
    id: str | None = None
    version: str | None = None
    ordered_points: list[str] | list[StreamPoint] | None = None
    point_count: int | None = None
    cover_url: str | None = None
    anime_title: str | None = None
    anime_title_cn: str | None = None
    truncated: bool | None = None
    shown_cluster_count: int | None = None
    total_cluster_count: int | None = None
    timed_itinerary: TimedItinerary | None = None
    status: str | None = None
    total_walk_minutes: float | None = None


class ClarificationCandidate(_WireModel):
    bangumi_id: str | None = None
    title: str | None = None
    title_cn: str | None = None
    cover_url: str | None = None
    year: int | None = None
    points_count: int | None = None
    id: str | None = None
    lat: float | None = None
    lng: float | None = None


class SearchData(_WireModel):
    results: SearchResults | None = None


class RouteData(_WireModel):
    results: SearchResults | None = None
    route: StreamRoute | None = None


class ClarificationData(_WireModel):
    reason: str | None = None
    clarification_id: int | None = None
    candidates: list[ClarificationCandidate] | None = None
    outcome: JsonObject | None = None


class PublicAPIErrorWire(_WireModel):
    code: str
    message: str
    details: JsonObject | None = None


class UIWire(_WireModel):
    component: str


class ChatResponseWire(_WireModel):
    intent: ChatIntent
    success: bool | None = None
    status: str | None = None
    session_id: str | None = None
    message: str | None = None
    data: SearchData | RouteData | ClarificationData | JsonObject | None = None
    session: JsonObject | None = None
    route_history: list[JsonObject] | None = None
    errors: list[PublicAPIErrorWire] | None = None
    ui: UIWire | None = None
    generated_title: str | None = None
    debug: JsonObject | None = None


def _search_results(data: JsonObject) -> SearchResults | None:
    raw = data.get("results")
    if not isinstance(raw, dict):
        return None
    values = dict(raw)
    values["bangumi_id"] = raw.get("bangumi_id", raw.get("anime_id"))
    metadata = raw.get("metadata")
    if isinstance(metadata, dict):
        values["title"] = raw.get("title", metadata.get("anime_title"))
    return SearchResults.model_validate(values, extra="ignore")


def _route(data: JsonObject) -> StreamRoute | None:
    raw = data.get("route")
    return (
        StreamRoute.model_validate(raw, extra="ignore")
        if isinstance(raw, dict)
        else None
    )


def _wire_data(
    response: PublicAPIResponse,
) -> SearchData | RouteData | ClarificationData | JsonObject:
    if response.intent in {"search_bangumi", "search_nearby"}:
        return SearchData(results=_search_results(response.data))
    if response.intent in {"plan_route", "plan_selected", "plan_multi", "partial"}:
        return RouteData(
            results=_search_results(response.data), route=_route(response.data)
        )
    if response.intent == "clarify":
        return ClarificationData.model_validate(response.data, extra="ignore")
    return {}


def chat_response_wire(response: PublicAPIResponse) -> JsonObject:
    """Project an internal response into the exact strict Zod wire shape."""
    wire = ChatResponseWire.model_validate(
        response, from_attributes=True, extra="ignore"
    )
    wire.data = _wire_data(response)
    return cast(JsonObject, wire.model_dump(mode="json", exclude_none=True))
