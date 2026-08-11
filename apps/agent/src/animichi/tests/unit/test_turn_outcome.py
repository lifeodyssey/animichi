"""TurnOutcome lifecycle + sweep tests (TURN-3 #951).

Proves the card's acceptance: owner killed after reserve (released) and after
dispatch (tombstoned, never replayed), next-admission reconciliation order,
bounded batches, concurrent claim safety, phase-aware cancellation, exactly-
once settlement, and the uncertain-provider no-replay rule.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta
from typing import Any

from animichi.application.turn_admission import AdmissionPolicy, TurnAdmission
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import SettleOutcome, TurnRef
from animichi.tests.unit.turn_admission_fakes import (
    FakeTurnReservationStore,
    _admission,
    _request,
)

START = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
LEASE = 300


class _Clock:
    def __init__(self, now: datetime = START) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: int) -> None:
        self.now = self.now + timedelta(seconds=seconds)


class _RecordingStore:
    """Wraps the fake, recording the call order of the lifecycle methods."""

    def __init__(self, inner: FakeTurnReservationStore) -> None:
        self._inner = inner
        self.order: list[str] = []

    async def reserve(self, request: Any) -> Any:
        self.order.append("reserve")
        return await self._inner.reserve(request)

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        self.order.append("dispatch")
        return await self._inner.dispatch(ref, owner=owner)

    async def settle(self, ref: TurnRef, *, owner: str, outcome: SettleOutcome) -> bool:
        self.order.append("settle")
        return await self._inner.settle(ref, owner=owner, outcome=outcome)

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        self.order.append("release")
        return await self._inner.release(ref, owner=owner)

    async def sweep(self, **kwargs: Any) -> Any:
        self.order.append("sweep")
        return await self._inner.sweep(**kwargs)


def _outcome(
    store: FakeTurnReservationStore,
    *,
    clock: _Clock | None = None,
    sweep_batch: int = 50,
) -> tuple[TurnOutcome, _Clock]:
    resolved_clock = clock or _Clock()
    store.use_clock(resolved_clock)
    outcome = TurnOutcome(
        store=store,
        admission=_admission(store, now=resolved_clock),
        now=resolved_clock,
        lease_seconds=LEASE,
        sweep_batch=sweep_batch,
    )
    return outcome, resolved_clock


def _ref(session_id: str | None = "s-1", turn_key: str = "turn-1") -> TurnRef:
    return TurnRef(session_id=session_id, turn_key=turn_key)


async def test_owner_killed_after_reserve_is_released_by_the_sweep() -> None:
    store = FakeTurnReservationStore()
    outcome, clock = _outcome(store)
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
    outcome, clock = _outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    assert await outcome.dispatch(_ref(), owner=verdict.owner) is True

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


async def test_admit_sweeps_before_reserving_next_admission() -> None:
    store = FakeTurnReservationStore()
    recorder = _RecordingStore(store)
    clock = _Clock()
    outcome = TurnOutcome(
        store=recorder,
        admission=_admission(recorder, now=clock),
        now=clock,
    )
    await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert recorder.order == ["sweep", "reserve"]


async def test_sweep_is_bounded_to_the_configured_batch() -> None:
    store = FakeTurnReservationStore()
    for i in range(3):
        store.seed_reservation(
            session_id=None,
            turn_key=f"turn-{i}",
            status="reserved",
            lease_expires_at=START - timedelta(seconds=1),
        )
    outcome, _ = _outcome(store, sweep_batch=2)
    report = await outcome.sweep()
    assert report.released == 2
    assert len(store.reservations) == 1


async def test_concurrent_sweeps_do_not_double_claim() -> None:
    store = FakeTurnReservationStore()
    for i in range(4):
        store.seed_reservation(
            session_id=None,
            turn_key=f"turn-{i}",
            status="reserved",
            lease_expires_at=START - timedelta(seconds=1),
        )
    outcome, _ = _outcome(store, sweep_batch=50)

    async def sweep() -> int:
        report = await outcome.sweep()
        return report.released

    reports = await asyncio.gather(sweep(), sweep())
    assert sum(reports) == 4
    assert len(store.reservations) == 0


async def test_cancel_before_dispatch_releases_and_allows_retry() -> None:
    store = FakeTurnReservationStore()
    outcome, _ = _outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    assert await outcome.release(_ref(), owner=verdict.owner) is True
    assert len(store.reservations) == 0

    retry = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert retry.admitted is True


async def test_cancel_after_dispatch_settles_failed_not_released() -> None:
    store = FakeTurnReservationStore()
    outcome, _ = _outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    await outcome.dispatch(_ref(), owner=verdict.owner)
    await outcome.settle(_ref(), owner=verdict.owner, outcome="failed")

    replay = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert replay.admitted is False
    assert replay.rejection is not None
    assert replay.rejection.reason == "turn_failed"


async def test_settlement_side_effects_run_exactly_once() -> None:
    store = FakeTurnReservationStore()
    outcome, _ = _outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    await outcome.dispatch(_ref(), owner=verdict.owner)
    applied: list[int] = []

    async def on_settled() -> None:
        applied.append(1)

    first = await outcome.settle(
        _ref(), owner=verdict.owner, outcome="completed", on_settled=on_settled
    )
    second = await outcome.settle(
        _ref(), owner=verdict.owner, outcome="completed", on_settled=on_settled
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
        _ref(), owner="o", outcome="completed", on_settled=on_settled
    )
    assert won is True
    assert applied == [1]


async def test_release_and_dispatch_noop_without_a_store() -> None:
    outcome = TurnOutcome(store=None, admission=None)
    assert await outcome.dispatch(_ref(), owner="o") is True
    assert await outcome.release(_ref(), owner="o") is True


async def test_dispatch_fails_when_lease_is_lost() -> None:
    store = FakeTurnReservationStore()
    outcome, clock = _outcome(store)
    verdict = await outcome.admit(_request(session_id="s-1", turn_key="turn-1"))
    assert verdict.owner is not None
    clock.advance(LEASE + 1)
    assert await outcome.dispatch(_ref(), owner=verdict.owner) is False


async def test_quota_read_is_not_an_increment_at_admission() -> None:
    store = FakeTurnReservationStore()
    clock = _Clock()
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
