"""Every named tool-outcome model must emit a real, named JSON schema.

S7.8: FastMCP.from_openapi (S7.4, not yet wired) needs each tool's return
type to generate a proper outputSchema. This proves model_json_schema()
produces named `properties` for every discriminated-outcome member and for
TranslateTitleResult, across module boundaries with no mocking.
"""

from __future__ import annotations

import pytest
from pydantic import BaseModel

from animichi.agents.tool_outcomes import (
    ItineraryEmpty,
    ItineraryOk,
    ItineraryPendingSync,
    ItineraryStaleRef,
    ItineraryUpstreamDown,
    NearbyEmpty,
    NearbyMissingLocation,
    NearbyOk,
    NearbyPlaceAmbiguous,
    NearbyPlaceUnresolved,
    NearbyUpstreamDown,
    ResolveAmbiguous,
    ResolveNotFound,
    ResolveResolved,
    ResolveUpstreamDown,
    SearchEmpty,
    SearchOk,
    SearchUpstreamDown,
    TranslateTitleResult,
)

_ModelWithProperties = tuple[type[BaseModel], frozenset[str]]

_MODELS_WITH_EXPECTED_PROPERTIES: tuple[_ModelWithProperties, ...] = (
    (ResolveResolved, frozenset({"outcome", "bangumi_id", "anime_title"})),
    (ResolveAmbiguous, frozenset({"outcome", "clarification_reason", "candidate_ids"})),
    (ResolveNotFound, frozenset({"outcome", "clarification_reason"})),
    (ResolveUpstreamDown, frozenset({"outcome"})),
    (
        SearchOk,
        frozenset({"outcome", "result_ref", "row_count", "anime_title", "partial"}),
    ),
    (SearchEmpty, frozenset({"outcome", "anime_title", "partial"})),
    (SearchUpstreamDown, frozenset({"outcome"})),
    (NearbyOk, frozenset({"outcome", "result_ref", "row_count"})),
    (NearbyEmpty, frozenset({"outcome"})),
    (
        NearbyPlaceAmbiguous,
        frozenset({"outcome", "clarification_reason", "place_candidate_ids"}),
    ),
    (NearbyPlaceUnresolved, frozenset({"outcome", "clarification_reason"})),
    (NearbyMissingLocation, frozenset({"outcome", "clarification_reason"})),
    (NearbyUpstreamDown, frozenset({"outcome"})),
    (
        ItineraryOk,
        frozenset({"status", "itinerary_ref", "point_count", "total_minutes"}),
    ),
    (ItineraryEmpty, frozenset({"status"})),
    (ItineraryStaleRef, frozenset({"status"})),
    (ItineraryPendingSync, frozenset({"status"})),
    (ItineraryUpstreamDown, frozenset({"status"})),
    (
        TranslateTitleResult,
        frozenset({"original", "translated", "source", "confidence"}),
    ),
)


@pytest.mark.parametrize(
    ("model_type", "expected_properties"), _MODELS_WITH_EXPECTED_PROPERTIES
)
def test_tool_outcome_model_emits_named_json_schema(
    model_type: type[BaseModel], expected_properties: frozenset[str]
) -> None:
    schema = model_type.model_json_schema()

    assert set(schema["properties"]) == expected_properties
