"""Unified RuntimeAPI selection dispatch with persisted pending state."""

from unittest.mock import MagicMock

import pytest

from agent.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    SessionState,
)
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.infrastructure.supabase.client import SupabaseClient
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from agent.interfaces.session_facade import normalize_session_state
from agent.tests.eval.mock_catalog_client import MockCatalogClient

pytest_plugins = ("agent.tests.conftest_db",)


async def _seed_pending(
    store: InMemorySessionStore,
    session_id: str,
    reason: str,
    candidates: list[OrderedCandidate],
) -> None:
    state = SessionState(
        pending_clarification=PendingClarification.model_validate(
            {
                "reason": reason,
                "candidate_ids": [item.id for item in candidates],
                "ordered_candidates": candidates,
                "revision": 3,
            }
        ),
        clarification_revision=3,
    )
    stored = normalize_session_state(None)
    stored["interactions"] = [
        {
            "context_delta": {"session_state_v2": state.model_dump(mode="json")},
            "new_messages": [],
        }
    ]
    await store.set(session_id, stored)


@pytest.mark.integration
async def test_anime_selection_bypasses_model_and_returns_multi_route(
    real_db: SupabaseClient,
) -> None:
    session_id = "phase1c-multi-dispatch"
    store = InMemorySessionStore()
    candidates = [
        OrderedCandidate(id="160209", title="君の名は。"),
        OrderedCandidate(id="115908", title="響け！ユーフォニアム"),
    ]
    await _seed_pending(store, session_id, "anime_ambiguity", candidates)
    await real_db.session.upsert_session(session_id, {}, metadata={})
    try:
        api = RuntimeAPI(
            real_db,
            session_store=store,
            catalog=MockCatalogClient(),
            model_http_client=MagicMock(),
        )
        response = await api.handle(
            PublicAPIRequest(
                session_id=session_id,
                selected_candidate_ids=["160209", "115908"],
                clarification_id=3,
            )
        )
        assert (response.intent, response.success) == ("plan_multi", True)
        assert {"results", "route"} <= response.data.keys()
    finally:
        await real_db.pool.execute(
            "DELETE FROM routes WHERE session_id = $1", session_id
        )
        await real_db.pool.execute("DELETE FROM sessions WHERE id = $1", session_id)


@pytest.mark.integration
async def test_place_selection_dispatches_to_staged_nearby_search(
    real_db: SupabaseClient,
) -> None:
    session_id = "phase1c-place-dispatch"
    store = InMemorySessionStore()
    candidate = OrderedCandidate(id="uji", title="Uji", lat=34.889, lng=135.807)
    await _seed_pending(store, session_id, "place_ambiguity", [candidate])
    await real_db.session.upsert_session(session_id, {}, metadata={})
    try:
        catalog = MockCatalogClient()
        api = RuntimeAPI(
            real_db, session_store=store, catalog=catalog, model_http_client=MagicMock()
        )
        response = await api.handle(
            PublicAPIRequest(
                session_id=session_id,
                selected_candidate_ids=["uji"],
                clarification_id=3,
            )
        )
        assert (response.intent, response.success) == ("search_nearby", True)
        assert all(call[0] != "geocode" for call in catalog.calls)
    finally:
        await real_db.pool.execute("DELETE FROM sessions WHERE id = $1", session_id)
