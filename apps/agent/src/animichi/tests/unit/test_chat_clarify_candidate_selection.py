"""HTTP-seam proof: a structured clarify pick bypasses the model (W1 #1220).

The audit (docs/specs/2026-08-26-system-health-audit.md §1) found the
deterministic selection channel already complete server-side
(``execute_multi_selection``/``execute_place_selection``, wired through
``PublicAPIRequest.selected_candidate_ids`` + ``clarification_id`` since
TURN-4 #955) — the gap was that ``packages/contract`` never modeled the
shape and no test proved the *whole* HTTP request bypasses the model. Prior
art: ``test_agent_turn_selection.py`` proves this at the ``RuntimeAPI``
seam; ``test_chat_ownership.py`` proves a real (non-mocked) ``RuntimeAPI``
survives the full ``/v1/chat`` HTTP round trip. This file combines both:
POST the structured pick over HTTP and prove it never reaches the model.
"""

from __future__ import annotations

from typing import Literal
from unittest.mock import AsyncMock

import pytest

from animichi.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    SessionState,
)
from animichi.clients.catalog_client import Itinerary, Point, SearchResult
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.public_api import RuntimeAPI
from animichi.tests.db_doubles import build_persistence_double
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.unit.conftest_fastapi import async_client, build_app


class _Catalog(MockCatalogClient):
    """The stub catalog `execute_multi_selection` fans out to (per-work fetch
    + itinerary planning), so a successful response proves the deterministic
    path actually ran end to end rather than short-circuiting on an error."""

    def __init__(self, results: dict[str, SearchResult]) -> None:
        super().__init__()
        self.results = results

    async def points_by_bangumi_id(self, bangumi_id: str) -> SearchResult:
        self.calls.append(("points_by_bangumi_id", (bangumi_id,)))
        return self.results.get(bangumi_id, SearchResult())

    def _ordered_points(self, point_ids: list[str]) -> list[Point]:
        points = {
            point.id: point for result in self.results.values() for point in result.rows
        }
        return [points[pid] for pid in point_ids if pid in points]

    async def plan_itinerary(
        self,
        point_ids: list[str],
        *,
        origin: tuple[float, float] | None = None,
        pacing: Literal["chill", "normal", "packed"] | None = None,
    ) -> Itinerary:
        del origin, pacing
        self.calls.append(("plan_itinerary", (tuple(point_ids),)))
        ordered = self._ordered_points(point_ids)
        return Itinerary(
            ordered_points=ordered,
            point_count=len(ordered),
            cover_url="https://example.test/cover.jpg",
            anime_title="Works",
            anime_title_cn="作品",
        )


def _point(pid: str, work: str) -> Point:
    return Point(
        id=pid, name=pid, bangumi_id=work, latitude=35.0, longitude=135.0, title=work
    )


_SEEDED = {
    "115908": SearchResult(rows=[_point("a", "115908")]),
    "117696": SearchResult(rows=[_point("b", "117696")]),
}


def _pending_selection_state() -> SessionState:
    candidates = [
        OrderedCandidate(id="115908", title="One", lat=35.0, lng=135.0),
        OrderedCandidate(id="117696", title="Two", lat=36.0, lng=136.0),
    ]
    pending = PendingClarification(
        reason="anime_ambiguity",
        candidate_ids=["115908", "117696"],
        ordered_candidates=candidates,
        revision=4,
    )
    return SessionState(pending_clarification=pending, clarification_revision=4)


async def test_structured_candidate_pick_bypasses_the_model_over_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "animichi.interfaces.public_api.run_animichi_agent",
        AsyncMock(side_effect=AssertionError("model must not run")),
    )
    db = build_persistence_double()
    db.session.check_session_owner = AsyncMock(return_value=True)
    store = InMemorySessionStore()
    await store.set(
        "s-1", {"session_state_v2": _pending_selection_state().model_dump(mode="json")}
    )
    catalog = _Catalog(_SEEDED)
    runtime_api = RuntimeAPI(
        db, session_store=store, catalog=catalog, model_http_client=AsyncMock()
    )
    app, _ = build_app(runtime_api=runtime_api, db=db)

    body = {
        "messages": [],
        "selected_candidate_ids": ["115908", "117696"],
        "clarification_id": 4,
    }
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat",
            json=body,
            headers={"X-User-Id": "user-1", "X-Session-Id": "s-1"},
        )

    assert response.status_code == 200
    assert '"type":"data-response"' in response.text
    assert '"intent":"plan_multi"' in response.text
    assert '"type":"error"' not in response.text
    assert ("points_by_bangumi_id", ("115908",)) in catalog.calls
    assert ("points_by_bangumi_id", ("117696",)) in catalog.calls
    assert ("plan_itinerary", (("a", "b"),)) in catalog.calls
