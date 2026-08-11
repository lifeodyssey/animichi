"""TurnOutcome lifecycle + ordering tests (TURN-3 #951).

Phase-aware cancellation (release before dispatch, settle failed after),
the exactly-once CAS guard, lease-lost dispatch, no-store fallbacks, the
pre-admission sweep order, and the read-never-increment quota gate. The
sweep itself is pinned in ``test_turn_outcome_sweep``.
"""

from __future__ import annotations

from datetime import date

from animichi.application.turn_admission import AdmissionPolicy, TurnAdmission
from animichi.application.turn_outcome import TurnOutcome
from animichi.tests.unit.turn_admission_fakes import (
    FakeTurnReservationStore,
    _admission,
    _request,
)
from animichi.tests.unit.turn_outcome_fakes import (
    LEASE,
    Clock,
    RecordingStore,
    make_outcome,
    ref,
)


async def test_admit_sweeps_before_reserving_next_admission() -> None:
    store = FakeTurnReservationStore()
    recorder = RecordingStore(store)
    clock = Clock()
    outcome = TurnOutcome(
        store=recorder,
        admission=_admission(recorder, now=clock),
        now=clock,
    )
    await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert recorder.order == ["sweep", "reserve"]


async def test_cancel_before_dispatch_releases_and_allows_retry() -> None:
    store = FakeTurnReservationStore()
    outcome, _ = make_outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    assert await outcome.release(ref(), owner=verdict.owner) is True
    assert len(store.reservations) == 0

    retry = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert retry.admitted is True


async def test_cancel_after_dispatch_settles_failed_not_released() -> None:
    store = FakeTurnReservationStore()
    outcome, _ = make_outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    await outcome.dispatch(ref(), owner=verdict.owner)
    await outcome.settle(ref(), owner=verdict.owner, outcome="failed")

    replay = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert replay.admitted is False
    assert replay.rejection is not None
    assert replay.rejection.reason == "turn_failed"


async def test_settlement_side_effects_run_exactly_once() -> None:
    store = FakeTurnReservationStore()
    outcome, _ = make_outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    await outcome.dispatch(ref(), owner=verdict.owner)
    applied: list[int] = []

    async def on_settled() -> None:
        applied.append(1)

    first = await outcome.settle(
        ref(), owner=verdict.owner, outcome="completed", on_settled=on_settled
    )
    second = await outcome.settle(
        ref(), owner=verdict.owner, outcome="completed", on_settled=on_settled
    )
    assert first is True
    assert second is False
    assert applied == [1]


async def test_settle_without_a_store_applies_side_effects_directly() -> None:
    outcome = TurnOutcome(store=None, admission=None)
    applied: list[int] = []

    async def on_settled() -> None:
        applied.append(1)

    won = await outcome.settle(
        ref(), owner="o", outcome="completed", on_settled=on_settled
    )
    assert won is True
    assert applied == [1]


async def test_release_and_dispatch_noop_without_a_store() -> None:
    outcome = TurnOutcome(store=None, admission=None)
    assert await outcome.dispatch(ref(), owner="o") is True
    assert await outcome.release(ref(), owner="o") is True


async def test_dispatch_fails_when_lease_is_lost() -> None:
    store = FakeTurnReservationStore()
    outcome, clock = make_outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    clock.advance(LEASE + 1)
    assert await outcome.dispatch(ref(), owner=verdict.owner) is False


async def test_quota_read_is_not_an_increment_at_admission() -> None:
    store = FakeTurnReservationStore()
    clock = Clock()
    quota_repo = _RecordingQuota()
    admission = TurnAdmission(
        store=store,
        policy=AdmissionPolicy(quota=3),
        anon_quota_repo=quota_repo,
        now=clock,
    )
    outcome = TurnOutcome(store=store, admission=admission, now=clock)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.admitted is True
    assert quota_repo.reads == 1
    assert quota_repo.increments == 0


class _RecordingQuota:
    """AnonQuotaCounter double recording read vs increment calls."""

    def __init__(self) -> None:
        self.reads = 0
        self.increments = 0

    async def count_for(self, *, usage_date: date, anon_id: str) -> int:
        del usage_date, anon_id
        self.reads += 1
        return 0

    async def increment_and_count(self, *, usage_date: date, anon_id: str) -> int:
        del usage_date, anon_id
        self.increments += 1
        return 1


async def test_admit_without_an_admission_use_case_fails_loudly() -> None:
    outcome = TurnOutcome(store=None, admission=None)
    try:
        await outcome.admit(_request())
    except RuntimeError as exc:
        assert "requires an admission use case" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
