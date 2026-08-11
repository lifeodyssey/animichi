"""TurnOutcome sweep tests (TURN-3 #951).

The demand-driven sweep: owner killed after reserve is released, owner killed
after dispatch is tombstoned ``failed`` (never replayed), the batch bound
holds, and concurrent sweeps claim disjoint rows.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

from animichi.tests.unit.turn_admission_fakes import (
    FakeTurnReservationStore,
    _request,
)
from animichi.tests.unit.turn_outcome_fakes import (
    LEASE,
    START,
    make_outcome,
    ref,
)


def _seed_expired(store: FakeTurnReservationStore, count: int) -> None:
    for i in range(count):
        store.seed_reservation(
            session_id=None,
            turn_key=f"turn-{i}",
            status="reserved",
            lease_expires_at=START - timedelta(seconds=1),
        )


async def test_owner_killed_after_reserve_is_released_by_the_sweep() -> None:
    store = FakeTurnReservationStore()
    outcome, clock = make_outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.admitted is True
    assert len(store.reservations) == 1

    clock.advance(LEASE + 1)
    report = await outcome.sweep()

    assert report.released == 1
    assert report.failed == 0
    assert len(store.reservations) == 0


async def test_owner_killed_after_dispatch_is_tombstoned_never_replayed() -> None:
    store = FakeTurnReservationStore()
    outcome, clock = make_outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    assert await outcome.dispatch(ref(), owner=verdict.owner) is True

    clock.advance(LEASE + 1)
    report = await outcome.sweep()

    assert report.failed == 1
    assert report.released == 0
    replay = await outcome.admit(
        _request(session_id="s-1", turn_key="turn-1", expected_revision=1)
    )
    assert replay.admitted is False
    assert replay.rejection is not None
    assert replay.rejection.reason == "turn_failed"


async def test_sweep_is_bounded_to_the_configured_batch() -> None:
    store = FakeTurnReservationStore()
    _seed_expired(store, 3)
    outcome, _ = make_outcome(store, sweep_batch=2)
    report = await outcome.sweep()
    assert report.released == 2
    assert len(store.reservations) == 1


async def test_concurrent_sweeps_do_not_double_claim() -> None:
    store = FakeTurnReservationStore()
    _seed_expired(store, 4)
    outcome, _ = make_outcome(store, sweep_batch=50)

    async def sweep() -> int:
        report = await outcome.sweep()
        return report.released

    reports = await asyncio.gather(sweep(), sweep())
    assert sum(reports) == 4
    assert len(store.reservations) == 0
