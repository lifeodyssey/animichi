"""Wire the durable outbox into turn settlement (issue #1014, AC5).

``_RuntimeTurnSettlement.settle`` ENQUEUES only — a fresh settle records the
three durable rows (never applying inline), and the transactional background
drain applies each effect exactly once on the store\'s session. This file
owns the fresh-settle path; the replay-dedup contract lives in
``test_turn_outbox_drain.py``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

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
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.interfaces.usage_metering import UsagePrices
from animichi.tests.unit.conftest_public_api import make_result, make_run_agent_stub
from animichi.tests.unit.outbox_fakes import MemoryOutbox

ANON_USER_ID = "anon_0123456789abcdef0123456789abcdef"
PRICED = Settings(model_input_cost_per_mtok_usd=2.0, model_output_cost_per_mtok_usd=8.0)


def _db() -> tuple[MagicMock, MemoryOutbox]:
    """A db double with a recording usage meter and a durable outbox."""
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


def _metered() -> AgentResult:
    result = make_result()
    result.usage = RunUsage(input_tokens=1_000_000, output_tokens=500_000, requests=1)
    return result


def _api(db: MagicMock) -> RuntimeAPI:
    return RuntimeAPI(db, settings=PRICED, model_http_client=MagicMock())


def _dispatcher(db: MagicMock) -> SettlementOutboxDispatcher:
    return SettlementOutboxDispatcher(
        SettlementInputs(
            usage_repo=db.usage,
            anon_quota_repo=db.anon_quota,
            request_audit_repo=db.feedback,
            messages_repo=db.session,
            prices=UsagePrices(0.0, 0.0),
        )
    )


class _RecordingStore:
    """Lifecycle store double that always wins dispatch/settle."""

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        del request
        return ReservationOutcome(status="admitted", owner="owner-1")

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        del ref, owner
        return True

    async def settle(
        self,
        ref: TurnRef,
        *,
        owner: str,
        outcome: str,
        outcome_payload: object | None = None,
    ) -> bool:
        del ref, owner, outcome, outcome_payload
        return True

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        del ref, owner
        return True

    async def sweep(
        self,
        *,
        now: object,
        owner: str,
        batch_size: int,
        lease_seconds: int,
    ) -> SweepReport:
        del now, owner, batch_size, lease_seconds
        return SweepReport()


def _outcome() -> TurnOutcome:
    return TurnOutcome(store=_RecordingStore(), admission=None)


async def test_fresh_settle_enqueues_and_drain_applies_once() -> None:
    db, outbox = _db()
    stub = make_run_agent_stub(_metered())
    with patch("animichi.interfaces.public_api.run_animichi_agent", side_effect=stub):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=_outcome(),
            turn_ref=TurnRef(session_id="s-1", turn_key="turn-1"),
            owner="owner-1",
        )
    # Settle only enqueues the three durable rows; nothing applied inline.
    assert len(outbox.rows) == 3
    assert {e.kind for e in outbox.rows} == {"usage", "quota", "audit"}
    db.usage.accumulate_usage.assert_not_awaited()
    db.anon_quota.increment_and_count.assert_not_awaited()
    # The drain applies usage + quota exactly once via the store transaction.
    delivered = await TurnOutbox(store=outbox).drain(_dispatcher(db))
    assert delivered == 3
    db.usage.accumulate_usage_on.assert_awaited_once()
    db.anon_quota.increment_and_count_on.assert_awaited_once()
    # Delivered rows are not re-applied on a second drain.
    assert await TurnOutbox(store=outbox).drain(_dispatcher(db)) == 0
    db.usage.accumulate_usage_on.assert_awaited_once()
