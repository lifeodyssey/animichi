"""TurnOutcome (TURN-3 #951) — owns the turn lifecycle and its sweep.

The caller immediately uses this use case: ``admit`` sweeps stale leases
(pre-admission reconciliation) before delegating to :class:`TurnAdmission`,
``dispatch`` marks the dispatch-certainty point, ``settle`` lands a turn in a
terminal state exactly once (the CAS guard — only the lease holder wins, so
usage/quota/audit side effects run once), and ``release`` drops a
never-dispatched reservation. The sweep is bounded and demand-driven only
(startup + before admission); there is no scheduler, queue, or Workflow.
"""

from __future__ import annotations

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

    async def admit(self, request: AdmissionRequest) -> AdmissionVerdict:
        """Sweep stale leases, then admit (pre-admission reconciliation)."""
        if self._admission is None:
            raise RuntimeError("TurnOutcome.admit requires an admission use case")
        try:
            await self.sweep()
        except Exception:
            # Same posture as the startup sweep: a failed reconciliation must
            # not reject the turn — the stale rows stay for the next pass.
            logger.warning("pre_admission_sweep_failed", exc_info=True)
        return await self._admission(request)

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
    ) -> bool:
        """Land the turn in a terminal state, applying side effects once.

        Without a store (no reservation seam) the side effects run directly —
        the direct-handle fallback for replay/direct turn paths.
        """
        if self._store is None:
            if on_settled is not None:
                await on_settled()
            return True
        won = await self._store.settle(ref, owner=owner, outcome=outcome)
        if won and on_settled is not None:
            await on_settled()
        return won
