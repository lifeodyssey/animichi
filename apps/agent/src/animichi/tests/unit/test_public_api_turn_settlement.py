"""RuntimeAPI.handle settlement through TurnOutcome (TURN-3 #951).

Proves the reserved-turn lifecycle at the handle boundary: dispatch at the
dispatch-certainty point, exactly-once terminal settlement (usage + anon
quota + audit applied once), phase-aware release when the turn dies before
dispatch, and settle-failed when it dies after.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.usage import RunUsage

from animichi.agents.agent_result import AgentResult
from animichi.application.turn_admission_port import ReservationOutcome, ReserveRequest
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import SweepReport, TurnRef
from animichi.config.settings import Settings
from animichi.infrastructure.supabase.client import SupabaseClient
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.tests.unit.conftest_public_api import make_result, make_run_agent_stub

ANON_USER_ID = "anon_0123456789abcdef0123456789abcdef"
PRICED = Settings(model_input_cost_per_mtok_usd=2.0, model_output_cost_per_mtok_usd=8.0)
TURN_REF = TurnRef(session_id="s-1", turn_key="turn-1")
OWNER = "owner-1"


class _RecordingStore:
    """Lifecycle store double recording the transitions it wins."""

    def __init__(self, settle_wins: bool = True) -> None:
        self.calls: list[tuple[str, ...]] = []
        self.settle_wins = settle_wins

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        del request
        return ReservationOutcome(status="admitted", owner=OWNER)

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        self.calls.append(("dispatch", ref.session_id or "", ref.turn_key, owner))
        return True

    async def settle(self, ref: TurnRef, *, owner: str, outcome: str) -> bool:
        self.calls.append(
            ("settle", ref.session_id or "", ref.turn_key, owner, outcome)
        )
        return self.settle_wins

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        self.calls.append(("release", ref.session_id or "", ref.turn_key, owner))
        return True

    async def sweep(
        self, *, now: object, owner: str, batch_size: int, lease_seconds: int
    ) -> SweepReport:
        del now, owner, batch_size
        return SweepReport()


def _db() -> MagicMock:
    db = MagicMock(spec=SupabaseClient)
    db.pool.fetch = AsyncMock(return_value=[])
    db.session = AsyncMock()
    db.usage = AsyncMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=1)
    return db


def _metered_result() -> AgentResult:
    result = make_result()
    result.usage = RunUsage(input_tokens=1_000_000, output_tokens=500_000, requests=1)
    return result


def _api(db: MagicMock) -> RuntimeAPI:
    return RuntimeAPI(db, settings=PRICED, model_http_client=MagicMock())


def _outcome(store: _RecordingStore) -> TurnOutcome:
    return TurnOutcome(store=store, admission=None)


async def test_reserved_turn_dispatches_and_settles_completed_exactly_once() -> None:
    db = _db()
    store = _RecordingStore()
    stub = make_run_agent_stub(_metered_result())
    with patch("animichi.interfaces.public_api.run_animichi_agent", side_effect=stub):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=_outcome(store),
            turn_ref=TURN_REF,
            owner=OWNER,
        )
    assert ("dispatch", "s-1", "turn-1", OWNER) in store.calls
    assert ("settle", "s-1", "turn-1", OWNER, "completed") in store.calls
    assert ("release",) not in [c[:1] for c in store.calls]
    db.usage.accumulate_usage.assert_awaited_once()
    db.anon_quota.increment_and_count.assert_awaited_once()


async def test_a_turn_that_raises_after_the_agent_ran_still_settles_and_meters() -> (
    None
):
    """The provider call completed and produced a response before persistence
    blew up, so the turn settles ``completed`` — and the burned tokens are
    still metered (the old route-owned fail branch is gone)."""
    db = _db()
    store = _RecordingStore()
    stub = make_run_agent_stub(_metered_result())
    with (
        patch("animichi.interfaces.public_api.run_animichi_agent", side_effect=stub),
        patch(
            "animichi.interfaces.public_api.persist_result",
            new=AsyncMock(side_effect=RuntimeError("session store down")),
        ),
        pytest.raises(RuntimeError),
    ):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=_outcome(store),
            turn_ref=TURN_REF,
            owner=OWNER,
        )
    assert ("settle", "s-1", "turn-1", OWNER, "completed") in store.calls
    assert not any(c[0] == "release" for c in store.calls)
    db.usage.accumulate_usage.assert_awaited_once()
    db.anon_quota.increment_and_count.assert_awaited_once()


async def test_a_turn_that_dies_before_dispatch_is_released_not_settled() -> None:
    db = _db()
    store = _RecordingStore()

    async def _session_boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("session store down")

    with (
        patch(
            "animichi.interfaces.public_api.create_owned_session",
            side_effect=_session_boom,
        ),
        pytest.raises(RuntimeError),
    ):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=_outcome(store),
            turn_ref=TURN_REF,
            owner=OWNER,
        )
    assert ("release", "s-1", "turn-1", OWNER) in store.calls
    assert not any(c[0] == "settle" for c in store.calls)
    db.usage.accumulate_usage.assert_not_awaited()
    db.anon_quota.increment_and_count.assert_not_awaited()


async def test_settlement_side_effects_are_skipped_when_the_cas_loses() -> None:
    db = _db()
    store = _RecordingStore(settle_wins=False)
    stub = make_run_agent_stub(_metered_result())
    with patch("animichi.interfaces.public_api.run_animichi_agent", side_effect=stub):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=_outcome(store),
            turn_ref=TURN_REF,
            owner=OWNER,
        )
    assert ("settle", "s-1", "turn-1", OWNER, "completed") in store.calls
    db.usage.accumulate_usage.assert_not_awaited()
    db.anon_quota.increment_and_count.assert_not_awaited()


class _DispatchLosingStore(_RecordingStore):
    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        self.calls.append(("dispatch", ref.session_id or "", ref.turn_key, owner))
        return False


async def test_dispatch_loss_never_runs_the_provider_and_releases() -> None:
    """Dispatch-certainty guard: when the lease is already gone, the agent
    must not run (the call would be uncertain) and the reservation is
    released, not settled."""
    db = _db()
    store = _DispatchLosingStore()
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        side_effect=AssertionError("provider must not run"),
    ) as run_agent:
        response = await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=_outcome(store),
            turn_ref=TURN_REF,
            owner=OWNER,
        )
    run_agent.assert_not_awaited()
    assert response.success is False
    assert response.errors[0].code == "turn_lease_lost"
    assert ("release", "s-1", "turn-1", OWNER) in store.calls
    assert ("settle",) not in [c[:1] for c in store.calls]
