"""API-level turn idempotency identity contract (issue #1014, AC1).

AC1 scopes the turn/idempotency identity to (caller, operation): retrying the
SAME turn_key under the same caller is ONE committed turn (the retry replays the
stored result without re-running the model); a DIFFERENT turn_key under the same
caller is a fresh turn. Asserted through ``RuntimeAPI.handle`` (the public_api
boundary), type: api.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from pydantic_ai.usage import RunUsage

from animichi.agents.agent_result import AgentResult
from animichi.config.settings import Settings
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.tests.unit.conftest_public_api import make_result, make_run_agent_stub
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore

ANON_USER_ID = "anon_0123456789abcdef0123456789abcdef"
PRICED = Settings(model_input_cost_per_mtok_usd=2.0, model_output_cost_per_mtok_usd=8.0)
TURN_KEY = "turn-ac1"
SESSION_ID = "s-ac1"


def _metered() -> AgentResult:
    result = make_result()
    result.usage = RunUsage(input_tokens=1000, output_tokens=500, requests=1)
    return result


def _api(store: FakeTurnReservationStore) -> RuntimeAPI:
    db = MagicMock()
    db.session = AsyncMock()
    db.usage = AsyncMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=1)
    return RuntimeAPI(
        db,
        settings=PRICED,
        turn_store=store,
        model_http_client=MagicMock(),
    )


def _request() -> PublicAPIRequest:
    return PublicAPIRequest(text="京吹の聖地", session_id=SESSION_ID)


async def test_same_turn_key_under_the_same_caller_is_one_committed_turn() -> None:
    """AC1: a retry of the same turn_key replays the stored result — the model
    runs once, and the second handle does not dispatch/settle a second turn."""
    store = FakeTurnReservationStore()
    api = _api(store)
    stub = make_run_agent_stub(_metered())
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent", side_effect=stub
    ) as runner:
        await api.handle(
            _request(), user_id=ANON_USER_ID, user_type="anonymous", turn_key=TURN_KEY
        )
        await api.handle(
            _request(), user_id=ANON_USER_ID, user_type="anonymous", turn_key=TURN_KEY
        )
    run = runner.call_count
    assert run == 1, "the model must run exactly once across the idempotent retry"
    assert run == 1
    # The first turn settled completed; the replay adds no settle/release.
    assert store.settle_calls == [
        ("s-ac1", TURN_KEY, store.settle_calls[0][2], "completed")
    ]
    assert store.release_calls == []


async def test_a_different_turn_key_under_the_same_caller_is_a_fresh_turn() -> None:
    """AC1: the identity is scoped to the operation — a new turn_key re-runs."""
    store = FakeTurnReservationStore()
    api = _api(store)
    stub = make_run_agent_stub(_metered())
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent", side_effect=stub
    ) as runner:
        await api.handle(
            _request(),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            turn_key="turn-ac1-a",
        )
        await api.handle(
            _request(),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            turn_key="turn-ac1-b",
        )
    assert runner.call_count == 2
    assert store.settle_calls[0][1] == "turn-ac1-a"
    assert store.settle_calls[1][1] == "turn-ac1-b"


async def test_caller_scoping_rejects_a_second_caller_on_the_same_operation() -> None:
    """AC1: the idempotency identity is scoped to the caller — a second caller
    retrying the SAME turn_key on a session owned by the first is rejected, never
    replayed back the first caller's result."""
    store = FakeTurnReservationStore()
    store.seed_session(SESSION_ID, ANON_USER_ID)
    api = _api(store)
    stub = make_run_agent_stub(_metered())
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent", side_effect=stub
    ) as runner:
        await api.handle(
            _request(), user_id=ANON_USER_ID, user_type="anonymous", turn_key=TURN_KEY
        )
        await api.handle(
            _request(), user_id="user-7", user_type="human", turn_key=TURN_KEY
        )
    assert runner.call_count == 1
    # The cross-caller retry was rejected (ownership): the model never ran a
    # second time and no cross-caller replay was served.
    assert store.release_calls == []
