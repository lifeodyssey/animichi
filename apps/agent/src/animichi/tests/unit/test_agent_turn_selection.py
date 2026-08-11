"""Selection turns through the public selection oracle (TURN-4 #955).

AgentTurn dispatches point/candidate selection kinds to the adapter port,
which validates through ``validate_candidate_selection`` and executes
deterministically through the Catalog; the Session offer echo is pinned too.
"""

from __future__ import annotations

from typing import Literal
from unittest.mock import AsyncMock, MagicMock, patch

from animichi.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    SessionState,
)
from animichi.clients.catalog_client import Itinerary, Point, SearchResult
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.tests.eval.mock_catalog_client import MockCatalogClient


class _Catalog(MockCatalogClient):
    def __init__(self, results: dict[str, SearchResult]) -> None:
        super().__init__()
        self.results = results

    async def points_by_bangumi_id(self, bangumi_id: str) -> SearchResult:
        self.calls.append(("points_by_bangumi_id", (bangumi_id,)))
        return self.results.get(bangumi_id, SearchResult())

    async def plan_itinerary(
        self,
        point_ids: list[str],
        *,
        origin: tuple[float, float] | None = None,
        pacing: Literal["chill", "normal", "packed"] | None = None,
    ) -> Itinerary:
        del origin, pacing
        self.calls.append(("plan_itinerary", (tuple(point_ids),)))
        points = {
            point.id: point for result in self.results.values() for point in result.rows
        }
        ordered = [points[pid] for pid in point_ids if pid in points]
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


SEEDED = {
    "1": SearchResult(rows=[_point("a", "1"), _point("shared", "1")]),
    "2": SearchResult(rows=[_point("shared", "2"), _point("b", "2")]),
}


def _pending_state() -> SessionState:
    candidates = [
        OrderedCandidate(id="1", title="One", lat=35.0, lng=135.0),
        OrderedCandidate(id="2", title="Two", lat=36.0, lng=136.0),
    ]
    pending = PendingClarification(
        reason="anime_ambiguity",
        candidate_ids=["1", "2"],
        ordered_candidates=candidates,
        revision=4,
    )
    return SessionState(pending_clarification=pending, clarification_revision=4)


async def test_stale_candidate_selection_is_rejected_by_the_oracle() -> None:
    """Mutation target: collapsing the oracle admits a stale id → red."""
    store = InMemorySessionStore()
    await store.set(
        "s-1", {"session_state_v2": _pending_state().model_dump(mode="json")}
    )
    api = RuntimeAPI(
        MagicMock(),
        session_store=store,
        catalog=MockCatalogClient(),
        model_http_client=MagicMock(),
    )
    request = PublicAPIRequest(
        text="",
        session_id="s-1",
        selected_candidate_ids=["1"],
        clarification_id=9,
    )

    response = await api.handle(request)

    assert response.success is False
    assert response.errors[0].code == "invalid_selection"
    assert response.intent == "clarify"


async def test_valid_candidate_selection_runs_multi_selection() -> None:
    store = InMemorySessionStore()
    await store.set(
        "s-1", {"session_state_v2": _pending_state().model_dump(mode="json")}
    )
    catalog = _Catalog(SEEDED)
    api = RuntimeAPI(
        MagicMock(),
        session_store=store,
        catalog=catalog,
        model_http_client=MagicMock(),
    )
    request = PublicAPIRequest(
        text="",
        session_id="s-1",
        selected_candidate_ids=["1", "2"],
        clarification_id=4,
    )

    response = await api.handle(request)

    assert response.success is True
    assert response.intent == "plan_multi"
    assert ("points_by_bangumi_id", ("1",)) in catalog.calls
    assert ("points_by_bangumi_id", ("2",)) in catalog.calls


async def test_point_selection_turn_plans_the_selected_route() -> None:
    catalog = _Catalog(SEEDED)
    api = RuntimeAPI(
        MagicMock(),
        session_store=InMemorySessionStore(),
        catalog=catalog,
        model_http_client=MagicMock(),
    )
    request = PublicAPIRequest(
        text="",
        session_id="s-1",
        selected_point_ids=["a", "b"],
        origin="Kyoto Station",
    )

    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(side_effect=AssertionError("model must not run")),
    ):
        response = await api.handle(request)

    assert response.success is True
    assert response.intent == "plan_selected"
    assert ("plan_itinerary", (("a", "b"),)) in catalog.calls


async def test_session_offer_revision_and_digest_are_echoed_on_the_response() -> None:
    api = RuntimeAPI(
        MagicMock(),
        session_store=InMemorySessionStore(),
        catalog=MockCatalogClient(),
        model_http_client=MagicMock(),
    )
    result = make_run_agent_stub_result()
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(return_value=result),
    ):
        response = await api.handle(
            PublicAPIRequest(text="京吹の聖地", session_id="s-1")
        )

    assert response.revision == 1
    assert isinstance(response.session_digest, str)
    assert len(response.session_digest) == 64


def make_run_agent_stub_result() -> object:
    from animichi.agents.agent_result import AgentResult
    from animichi.agents.runtime_models import QAResponseModel

    return AgentResult(
        output=QAResponseModel(message="ok"),
        intent="general_qa",
        session_state=SessionState(),
    )
