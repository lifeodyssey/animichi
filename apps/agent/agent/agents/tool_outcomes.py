"""Compact discriminated outcomes returned by model-callable data tools."""

from __future__ import annotations

from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field


class _Outcome(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ResolveResolved(_Outcome):
    outcome: Literal["resolved"] = "resolved"
    bangumi_id: str
    anime_title: str


class ResolveAmbiguous(_Outcome):
    outcome: Literal["needs_disambiguation"] = "needs_disambiguation"
    clarification_reason: Literal["anime_ambiguity"] = "anime_ambiguity"
    candidate_ids: list[str] = Field(min_length=2)


class ResolveNotFound(_Outcome):
    outcome: Literal["not_found"] = "not_found"
    clarification_reason: Literal["anime_not_found"] = "anime_not_found"


class ResolveUpstreamDown(_Outcome):
    outcome: Literal["upstream_unavailable"] = "upstream_unavailable"


ResolveResult: TypeAlias = Annotated[
    ResolveResolved | ResolveAmbiguous | ResolveNotFound | ResolveUpstreamDown,
    Field(discriminator="outcome"),
]


class SearchOk(_Outcome):
    outcome: Literal["ok"] = "ok"
    result_ref: str
    row_count: int = Field(ge=1)
    anime_title: str | None = None
    partial: bool = False


class SearchEmpty(_Outcome):
    outcome: Literal["empty"] = "empty"
    anime_title: str | None = None


SearchToolResult: TypeAlias = Annotated[
    SearchOk | SearchEmpty, Field(discriminator="outcome")
]


class NearbyOk(_Outcome):
    outcome: Literal["ok"] = "ok"
    result_ref: str
    row_count: int = Field(ge=1)


class NearbyEmpty(_Outcome):
    outcome: Literal["empty"] = "empty"


class NearbyPlaceAmbiguous(_Outcome):
    outcome: Literal["place_ambiguity"] = "place_ambiguity"
    clarification_reason: Literal["place_ambiguity"] = "place_ambiguity"
    place_candidate_ids: list[str] = Field(min_length=2)


class NearbyPlaceUnresolved(_Outcome):
    outcome: Literal["place_unresolved"] = "place_unresolved"
    clarification_reason: Literal["place_too_broad", "unknown_place"]


class NearbyMissingLocation(_Outcome):
    outcome: Literal["missing_location"] = "missing_location"
    clarification_reason: Literal["missing_location"] = "missing_location"


NearbyToolResult: TypeAlias = Annotated[
    NearbyOk
    | NearbyEmpty
    | NearbyPlaceAmbiguous
    | NearbyPlaceUnresolved
    | NearbyMissingLocation,
    Field(discriminator="outcome"),
]


class RouteOk(_Outcome):
    status: Literal["ok"] = "ok"
    route_ref: str
    point_count: int = Field(ge=1)
    total_minutes: int


class RouteEmpty(_Outcome):
    status: Literal["empty"] = "empty"


class RouteStaleRef(_Outcome):
    status: Literal["stale_ref"] = "stale_ref"


RouteToolResult: TypeAlias = Annotated[
    RouteOk | RouteEmpty | RouteStaleRef, Field(discriminator="status")
]
