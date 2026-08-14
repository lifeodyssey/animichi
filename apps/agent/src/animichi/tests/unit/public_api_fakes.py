"""Shared fakes and scaffolding for RuntimeAPI.handle turn tests (TURN-3 #951).

These test files prove the reserved-turn lifecycle at the ``handle`` boundary
(dispatch, settle, release, drain) with a recording store double and a durable
in-process outbox.  Moving the store double, db double, and drain scaffolding
here keeps the per-test bodies focused on the branch they exercise.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from pydantic_ai.usage import RunUsage

from animichi.agents.agent_result import AgentResult
from animichi.application.outbox import TurnOutbox
from animichi.application.turn_admission_port import ReservationOutcome, ReserveRequest
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import SweepReport, TurnRef
from animichi.config.settings import Settings
from animichi.interfaces.outbox_dispatch import (
    SettlementInputs,
    SettlementOutboxDispatcher,
)
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.usage_metering import UsagePrices
from animichi.tests.unit.conftest_public_api import make_result
from animichi.tests.unit.outbox_fakes import MemoryOutbox

ANON_USER_ID = "anon_0123456789abcdef0123456789abcdef"
PRICED = Settings(model_input_cost_per_mtok_usd=2.0, model_output_cost_per_mtok_usd=8.0)
PRICED_TOKENS = UsagePrices(input_usd_per_mtok=2.0, output_usd_per_mtok=8.0)
TURN_REF = TurnRef(session_id="s-1", turn_key="turn-1")
OWNER = "owner-1"


class MemoryStore:
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

    async def settle(
        self,
        ref: TurnRef,
        *,
        owner: str,
        outcome: str,
        outcome_payload: object | None = None,
    ) -> bool:
        del outcome_payload
        self.calls.append(
            ("settle", ref.session_id or "", ref.turn_key, owner, outcome)
        )
        return self.settle_wins

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        self.calls.append(("release", ref.session_id or "", ref.turn_key, owner))
        return True

    async def sweep(
        self,
        *,
        now: object,
        owner: str,
        batch_size: int,
        lease_seconds: int,
    ) -> SweepReport:
        del now, owner, batch_size
        return SweepReport()


class DispatchLosingStore(MemoryStore):
    """Store double whose dispatch-certainty check fails (CAS loss on dispatch)."""

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        self.calls.append(("dispatch", ref.session_id or "", ref.turn_key, owner))
        return False


def make_db() -> tuple[MagicMock, MemoryOutbox]:
    """A db double with a recording usage meter, quota meter, and durable outbox."""
    outbox = MemoryOutbox()
    db = MagicMock()
    db.session = AsyncMock()
    db.outbox = outbox
    db.usage = AsyncMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.usage.accumulate_usage_on = AsyncMock(return_value=None)
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=1)
    db.anon_quota.increment_and_count_on = AsyncMock(return_value=1)
    db.feedback = MagicMock()
    db.feedback.insert_request_log_on = AsyncMock(return_value=None)
    return db, outbox


def metered_result() -> AgentResult:
    result = make_result()
    result.usage = RunUsage(input_tokens=1_000_000, output_tokens=500_000, requests=1)
    return result


def make_api(db: MagicMock) -> RuntimeAPI:
    return RuntimeAPI(db, settings=PRICED, model_http_client=MagicMock())


def make_outcome(store: MemoryStore) -> TurnOutcome:
    return TurnOutcome(store=store, admission=None)


def make_dispatcher(
    db: MagicMock,
    *,
    audit_repo: object | None = None,
    messages_repo: object | None = None,
    prices: UsagePrices = PRICED_TOKENS,
) -> SettlementOutboxDispatcher:
    return SettlementOutboxDispatcher(
        SettlementInputs(
            usage_repo=db.usage,
            anon_quota_repo=db.anon_quota,
            request_audit_repo=audit_repo,
            messages_repo=messages_repo,
            prices=prices,
        )
    )


async def drain(db: MagicMock, outbox: MemoryOutbox) -> int:
    """Drain the durable outbox and return the number of rows applied."""
    return await TurnOutbox(store=outbox).drain(make_dispatcher(db))
