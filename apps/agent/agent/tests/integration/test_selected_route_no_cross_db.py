"""Lock SD-3(1) / issue #273 against selected-route cross-DB reads.

Before #294, ``db.points.get_points_by_ids`` surfaced stale Supabase rows here.
"""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.agents.catalog_adapter import build_search_payload
from agent.clients.catalog_client import PilgrimagePoint
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.infrastructure.supabase.client import SupabaseClient
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.eval.mock_catalog_client import FIXTURE_POINTS, MockCatalogClient


def _catalog_points() -> list[PilgrimagePoint]:
    return [point.model_copy(deep=True) for point in FIXTURE_POINTS["115908"][:2]]


@pytest.fixture
def divergent_db() -> MagicMock:
    db = MagicMock(spec=SupabaseClient)
    db.points.get_points_by_ids = AsyncMock(
        return_value=[
            {
                "id": "p004",
                "name": "STALE-SUPABASE-p004",
                "latitude": 0.0,
                "longitude": 0.0,
            },
            {
                "id": "p005",
                "name": "STALE-SUPABASE-p005",
                "latitude": 1.0,
                "longitude": 1.0,
            },
        ]
    )
    db.session.upsert_session = AsyncMock()
    db.session.upsert_conversation = AsyncMock()
    db.user_memory.get_user_memory = AsyncMock(return_value=None)
    db.user_memory.upsert_user_memory = AsyncMock()
    db.session.update_conversation_title = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-1")
    db.pool.fetch = AsyncMock(return_value=[])
    return db


@pytest.fixture
async def selected_response(divergent_db: MagicMock) -> PublicAPIResponse:
    api = RuntimeAPI(
        divergent_db,
        session_store=InMemorySessionStore(),
        catalog=MockCatalogClient(),
    )
    return await api.handle(
        PublicAPIRequest(selected_point_ids=["p004", "p005"], locale="ja")
    )


def _response_rows(response: PublicAPIResponse) -> list[dict[str, object]]:
    route = cast(dict[str, object], response.data["route"])
    return cast(list[dict[str, object]], route["ordered_points"])


async def test_selected_route_succeeds_with_catalog_points(
    selected_response: PublicAPIResponse,
) -> None:
    assert selected_response.success is True
    assert selected_response.intent == "plan_selected"
    assert _response_rows(selected_response) == [
        point.model_dump(mode="json") for point in _catalog_points()
    ]


async def test_selected_route_never_reads_stale_supabase(
    divergent_db: MagicMock, selected_response: PublicAPIResponse
) -> None:
    assert "STALE-SUPABASE-" not in selected_response.model_dump_json()
    divergent_db.points.get_points_by_ids.assert_not_awaited()


async def test_selected_route_rows_match_same_session_search(
    selected_response: PublicAPIResponse,
) -> None:
    search = build_search_payload(_catalog_points(), tool="search_bangumi")
    assert _response_rows(selected_response) == search["rows"]
