"""Neutral photo-search response envelope (AGENT-1 #952).

The pipeline (``agents.photo_search``) produces these shapes; the route maps
them to the generated boundary models (``interfaces.boundary.agent_models``).
Context-local by design — generated wire models do not become domain entities.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from animichi.application.model_turn_port import ModelTurnUsage
from animichi.application.photo_offers import OfferSignals

ClarifyReason = Literal["photo_unrecognized", "photo_ambiguous"]


@dataclass(frozen=True)
class PhotoPoint:
    id: str
    name: str
    bangumi_id: str
    episode: int
    screenshot_url: str
    latitude: float
    longitude: float
    title: str
    city: str | None = None


@dataclass(frozen=True)
class PhotoResults:
    bangumi_id: str
    title: str
    row_count: int
    rows: tuple[PhotoPoint, ...]


@dataclass(frozen=True)
class PhotoCandidate:
    id: str
    title: str
    bangumi_id: str | None = None


@dataclass(frozen=True)
class PhotoSearchData:
    results: PhotoResults | None = None
    reason: ClarifyReason | None = None
    candidates: tuple[PhotoCandidate, ...] = ()


@dataclass(frozen=True)
class PhotoSearchEnvelope:
    intent: Literal["search_bangumi", "clarify"]
    data: PhotoSearchData


@dataclass(frozen=True)
class PipelineOutcome:
    """The recognition+resolve pipeline's neutral result."""

    envelope: PhotoSearchEnvelope
    signals: OfferSignals
    usage: ModelTurnUsage | None = None
    provider_kind: Literal["byok", "platform"] | None = None
