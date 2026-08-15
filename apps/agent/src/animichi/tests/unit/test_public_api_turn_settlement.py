"""RuntimeAPI.handle settlement through TurnOutcome (TURN-3 #951).

Proves the reserved-turn lifecycle at the handle boundary: dispatch at the
dispatch-certainty point, exactly-once terminal settlement (settle enqueues
usage + quota + audit rows; the drain applies them once), and CAS-loss /
dispatch-loss paths. The raising-turn and pre-dispatch-death paths live in
``test_public_api_turn_drain.py``.
"""

from __future__ import annotations

from unittest.mock import patch

from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.tests.unit.conftest_public_api import make_run_agent_stub
from animichi.tests.unit.public_api_fakes import (
    ANON_USER_ID,
    OWNER,
    TURN_REF,
    DispatchLosingStore,
    MemoryStore,
    drain,
    make_api,
    make_db,
    make_outcome,
    metered_result,
)


async def _run_metered(api: RuntimeAPI, outcome: object) -> None:
    stub = make_run_agent_stub(metered_result())
    with patch("animichi.interfaces.public_api.run_animichi_agent", side_effect=stub):
        await api.handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=outcome,
            turn_ref=TURN_REF,
            owner=OWNER,
        )


async def test_reserved_turn_dispatches_and_settles_completed_exactly_once() -> None:
    db, outbox = make_db()
    store = MemoryStore()
    await _run_metered(make_api(db), make_outcome(store))
    assert ("dispatch", "s-1", "turn-1", OWNER) in store.calls
    assert ("settle", "s-1", "turn-1", OWNER, "completed") in store.calls
    assert ("release",) not in [c[:1] for c in store.calls]
    # Settle enqueued the effects; draining applies usage + quota exactly once.
    assert outbox.pending_kinds() == {"usage", "quota", "audit"}
    await drain(db, outbox)
    db.usage.accumulate_usage_on.assert_awaited_once()
    db.anon_quota.increment_and_count_on.assert_awaited_once()


async def test_settlement_side_effects_are_skipped_when_the_cas_loses() -> None:
    db, outbox = make_db()
    store = MemoryStore(settle_wins=False)
    await _run_metered(make_api(db), make_outcome(store))
    assert ("settle", "s-1", "turn-1", OWNER, "completed") in store.calls
    assert outbox.pending_kinds() == set()
    db.usage.accumulate_usage_on.assert_not_awaited()
    db.anon_quota.increment_and_count_on.assert_not_awaited()


async def test_dispatch_loss_never_runs_the_provider_and_releases() -> None:
    """Dispatch-certainty guard: provider never runs; reservation released."""
    db, outbox = make_db()
    store = DispatchLosingStore()
    api = make_api(db)
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        side_effect=AssertionError("provider must not run"),
    ) as run_agent:
        response = await api.handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=make_outcome(store),
            turn_ref=TURN_REF,
            owner=OWNER,
        )
    run_agent.assert_not_awaited()
    assert response.success is False
    assert response.errors[0].code == "turn_lease_lost"
    assert ("release", "s-1", "turn-1", OWNER) in store.calls
    assert ("settle",) not in [c[:1] for c in store.calls]
