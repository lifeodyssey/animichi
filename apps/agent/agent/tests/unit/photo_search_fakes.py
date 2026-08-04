"""Shared fakes for photo-search tests (unit + integration)."""

from __future__ import annotations

import hashlib
from pathlib import Path

from pydantic_ai.usage import RunUsage

from agent.agents.photo_vision import (
    RecognizeCall,
    VisionCallResult,
    VisionProviderKind,
    VisionRecognitionFailed,
)
from agent.clients.catalog_client import (
    AnimeCandidate,
    PilgrimagePoint,
    ResolveAmbiguous,
    ResolveNotFound,
    ResolveOutcome,
    ResolveResolved,
    SearchResult,
)
from agent.clients.errors import APIError

VISION_FIXTURES = Path(__file__).resolve().parents[5] / "fixtures" / "vision"
YOURNAME_FIXTURE = VISION_FIXTURES / "yourname_screenshot.jpg"
LANDSCAPE_FIXTURE = VISION_FIXTURES / "unknown_landscape.jpg"

YOURNAME_TITLE = "君の名は。"
YOURNAME_BANGUMI_ID = "160209"
NEARBY_TITLE = "けいおん!"
NEARBY_BANGUMI_ID = "9912"
UNRESOLVABLE_TITLE = "謎のアニメ"


def digest(image: bytes) -> str:
    return hashlib.sha256(image).hexdigest()


def recognize_stub(
    titles: list[str], provider_kind: VisionProviderKind = "platform"
) -> RecognizeCall:
    """A `RecognizeCall` that always answers with a fixed candidate list —
    stands in for a resolved `agent.agents.photo_vision.recognize_photo`
    closure in pipeline tests that don't care how recognition happened."""

    async def call() -> VisionCallResult:
        return VisionCallResult(titles, provider_kind, RunUsage(requests=1))

    return call


def recognize_unavailable() -> RecognizeCall:
    """A `RecognizeCall` standing in for both providers being exhausted."""

    async def call() -> VisionCallResult:
        raise VisionRecognitionFailed()

    return call


def suga_shrine_point() -> PilgrimagePoint:
    return PilgrimagePoint(
        id="p1",
        name="須賀神社",
        bangumi_id=YOURNAME_BANGUMI_ID,
        latitude=35.685,
        longitude=139.72,
        title=YOURNAME_TITLE,
    )


def nearby_point() -> PilgrimagePoint:
    return PilgrimagePoint(
        id="n1",
        name="豊郷小学校",
        bangumi_id=NEARBY_BANGUMI_ID,
        latitude=35.2,
        longitude=136.2,
        title=NEARBY_TITLE,
    )


class FakeCatalog:
    """Resolves 君の名は。 to 160209; nearby returns one けいおん! point."""

    def __init__(self, nearby_points: list[PilgrimagePoint] | None = None) -> None:
        self.nearby_points = (
            nearby_points if nearby_points is not None else [nearby_point()]
        )
        self.nearby_calls: list[tuple[float, float, int]] = []
        self.resolved_queries: list[str] = []

    async def resolve(self, query: str) -> ResolveOutcome:
        self.resolved_queries.append(query)
        if query == YOURNAME_TITLE:
            match = AnimeCandidate(bangumi_id=YOURNAME_BANGUMI_ID, title=YOURNAME_TITLE)
            return ResolveResolved(outcome="resolved", match=match)
        return ResolveNotFound(outcome="not_found", reason="anime_not_found")

    async def points_by_work_id(self, work_id: str) -> SearchResult:
        return SearchResult(rows=[suga_shrine_point()])

    async def nearby(
        self, lat: float, lng: float, radius_m: int = 5000
    ) -> list[PilgrimagePoint]:
        self.nearby_calls.append((lat, lng, radius_m))
        return self.nearby_points


class AmbiguousCatalog(FakeCatalog):
    async def resolve(self, query: str) -> ResolveOutcome:
        candidates = [
            AnimeCandidate(bangumi_id="1", title="響け!ユーフォニアム"),
            AnimeCandidate(bangumi_id="2", title="響け!ユーフォニアム2"),
        ]
        return ResolveAmbiguous(
            outcome="needs_disambiguation",
            reason="anime_ambiguity",
            candidates=candidates,
        )


class DownCatalog(FakeCatalog):
    async def resolve(self, query: str) -> ResolveOutcome:
        raise APIError("catalog down")

    async def nearby(
        self, lat: float, lng: float, radius_m: int = 5000
    ) -> list[PilgrimagePoint]:
        raise APIError("catalog down")
