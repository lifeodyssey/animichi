"""TurnOutcome (TURN-3 #951) — owns the turn lifecycle and its sweep.

The caller immediately uses this use case: ``admit`` delegates to
:class:`TurnAdmission` and reconciles stale leases alongside it,
``dispatch`` marks the dispatch-certainty point, ``settle`` lands a turn in a
terminal state exactly once (the CAS guard — only the lease holder wins, so
usage/quota/audit side effects run once), and ``release`` drops a
never-dispatched reservation. The sweep is bounded and demand-driven only
(startup + on admission); there is no scheduler, queue, or Workflow.

The reconciliation runs *off* the admitting request's critical path. It is
garbage collection, not a gate: reservations are keyed by ``turn_key`` and
every send mints a fresh one, so a stale lease left by a crashed turn never
blocks a new message. Awaiting it inside ``admit`` only added a full database
round trip — one this request has no reason to wait for — to every turn.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import structlog

from animichi.application.turn_admission import (
    DEFAULT_LEASE_SECONDS,
    AdmissionRequest,
    AdmissionVerdict,
    TurnAdmission,
)
from animichi.application.turn_outcome_port import (
    SettleOutcome,
    SweepReport,
    TurnOutcomeStore,
    TurnRef,
)

#: Bounded batch for every sweep run (a demand-driven ceiling, not a scheduler).
DEFAULT_SWEEP_BATCH = 50
_DEFAULT_SWEEP_OWNER = "sweep"

#: Settlement side effects (usage metering / quota / audit) applied on the win.
SettleCallback = Callable[[], Awaitable[None]]


logger = structlog.get_logger(__name__)


class TurnOutcome:
    """Owns reserved/running/terminal transitions + the demand-driven sweep."""

    def __init__(
        self,
        *,
        store: TurnOutcomeStore | None,
        admission: TurnAdmission | None = None,
        now: Callable[[], datetime] | None = None,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
        sweep_batch: int = DEFAULT_SWEEP_BATCH,
        sweep_owner: str = _DEFAULT_SWEEP_OWNER,
    ) -> None:
        self._store = store
        self._admission = admission
        self._now = now or (lambda: datetime.now(UTC))
        self._lease_seconds = lease_seconds
        self._sweep_batch = sweep_batch
        self._sweep_owner = sweep_owner
        self._reconciling: asyncio.Task[SweepReport] | None = None

    async def admit(self, request: AdmissionRequest) -> AdmissionVerdict:
        """Admit the turn, reconciling stale leases off its critical path."""
        if self._admission is None:
            raise RuntimeError("TurnOutcome.admit requires an admission use case")
        self.begin_reconciliation()
        return await self._admission(request)

    def begin_reconciliation(self) -> None:
        """Start one background sweep; at most one is ever in flight."""
        if self._reconciling is not None and not self._reconciling.done():
            return
        self._reconciling = asyncio.create_task(self._reconcile())

    async def drain_reconciliation(self) -> None:
        """Await the in-flight sweep (shutdown, and deterministic tests)."""
        task = self._reconciling
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)

    async def _reconcile(self) -> SweepReport:
        """Reclaim stale leases; a failure must never reject a turn."""
        try:
            return await self.sweep()
        except Exception:
            # Same posture as the startup sweep: the stale rows stay for the
            # next pass rather than turning garbage collection into an outage.
            logger.warning("background_sweep_failed", exc_info=True)
            return SweepReport()

    async def sweep(self) -> SweepReport:
        """Reclaim expired leases in one bounded batch."""
        if self._store is None:
            return SweepReport()
        return await self._store.sweep(
            now=self._now(),
            owner=self._sweep_owner,
            batch_size=self._sweep_batch,
            lease_seconds=self._lease_seconds,
        )

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        """Mark the dispatch-certainty point (reserved -> running)."""
        if self._store is None:
            return True
        return await self._store.dispatch(ref, owner=owner)

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        """Drop a never-dispatched reservation (never replayed)."""
        if self._store is None:
            return True
        return await self._store.release(ref, owner=owner)

    async def settle(
        self,
        ref: TurnRef,
        *,
        owner: str,
        outcome: SettleOutcome,
        on_settled: SettleCallback | None = None,
        outcome_payload: object | None = None,
    ) -> bool:
        """Land the turn in a terminal state, applying side effects once.

        Without a store (no reservation seam) the side effects run directly —
        the direct-handle fallback for replay/direct turn paths. A
        ``completed`` settle may carry ``outcome_payload`` (the opaque
        committed output) so the store persists it for exactly-once replay
        recovery (AC3).
        """
        if self._store is None:
            if on_settled is not None:
                await on_settled()
            return True
        won = await self._store.settle(
            ref, owner=owner, outcome=outcome, outcome_payload=outcome_payload
        )
        if won and on_settled is not None:
            await on_settled()
        return won
