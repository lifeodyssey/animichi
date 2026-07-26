"""Shared fakes for photo-search tests (unit + integration)."""

from __future__ import annotations

import hashlib
from pathlib import Path

from agent.agents.vision_supply_router import VisionRecognition
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


class KeyedVisionStub:
    """Maps exact image bytes to recognised titles; count matches by default."""

    def __init__(
        self, mapping: dict[str, list[str]], reported_count: int | None = None
    ) -> None:
        self._mapping = mapping
        self._reported_count = reported_count
        self.calls = 0

    async def recognize(self, images: list[bytes], locale: str) -> VisionRecognition:
        self.calls += 1
        titles = list(self._mapping.get(digest(images[0]), []))
        count = self._reported_count if self._reported_count is not None else len(images)
        return VisionRecognition(reported_image_count=count, candidate_titles=titles)


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
        self.nearby_points = nearby_points if nearby_points is not None else [nearby_point()]
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
