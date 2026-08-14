"""Wire the durable outbox into turn settlement (issue #1014, AC5).

Proves ``_RuntimeTurnSettlement.settle`` enqueues the three external effects
on a fresh settle, applies them once, and marks the rows delivered; and that
a replayed settle of the same turn (enqueue idempotent on (turn_key, kind))
creates no new row and never re-applies the effects (C3 exact-once dedup).
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic_ai.usage import RunUsage

from animichi.agents.agent_result import AgentResult
from animichi.application.outbox_port import OutboxEntry, OutboxRow
from animichi.application.turn_admission_port import ReservationOutcome, ReserveRequest
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import SweepReport, TurnRef
from animichi.config.settings import Settings
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.tests.unit.conftest_public_api import make_result, make_run_agent_stub

ANON_USER_ID = "anon_0123456789abcdef0123456789abcdef"
PRICED = Settings(model_input_cost_per_mtok_usd=2.0, model_output_cost_per_mtok_usd=8.0)
KINDS = ("usage", "quota", "audit")


class _FakeOutbox:
    """A durable in-memory OutboxStore: enqueue idempotent, CAS delivered."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], object] = {}
        self.delivered: set[tuple[str, str]] = set()
        self.enqueue_calls: list[OutboxEntry] = []
        self.mark_calls: list[tuple[str, str, str]] = []

    async def enqueue(self, entry: OutboxEntry) -> bool:
        self.enqueue_calls.append(entry)
        key = (entry.turn_key, entry.kind)
        if key in self.rows:
            return False
        self.rows[key] = entry
        return True

    async def drain(self, *, now: datetime, batch_size: int) -> list[OutboxRow]:
        return []

    async def mark_delivered(self, row_id: object, *, success: bool) -> bool:
        return True

    async def mark_delivered_for(
        self,
        session_id: str | None,
        turn_key: str,
        kind: str,
        *,
        success: bool,
    ) -> bool:
        self.mark_calls.append((str(session_id), turn_key, kind))
        return True


def _db(outbox: _FakeOutbox) -> MagicMock:
    db = MagicMock()
    db.session = AsyncMock()
    db.outbox = outbox
    db.usage = AsyncMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=1)
    db.feedback = MagicMock()
    return db


def _metered() -> AgentResult:
    result = make_result()
    result.usage = RunUsage(input_tokens=1_000_000, output_tokens=500_000, requests=1)
    return result


def _api(db: MagicMock) -> RuntimeAPI:
    return RuntimeAPI(db, settings=PRICED, model_http_client=MagicMock())


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
        self, *, now: object, owner: str, batch_size: int, lease_seconds: int
    ) -> SweepReport:
        del now, owner, batch_size, lease_seconds
        return SweepReport()


def _outcome() -> TurnOutcome:
    return TurnOutcome(store=_RecordingStore(), admission=None)


async def test_fresh_settle_enqueues_applies_and_marks_delivered() -> None:
    outbox = _FakeOutbox()
    db = _db(outbox)
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
    assert len(outbox.enqueue_calls) == 3
    assert {e.kind for e in outbox.enqueue_calls} == {"usage", "quota", "audit"}
    # The stored payload is JSON-safe (dict), not the frozen dataclass.
    for e in outbox.enqueue_calls:
        assert isinstance(e.payload, dict)
        assert isinstance(e.payload.get("usage"), list)
        assert e.payload.get("session_id") is not None
    assert {c[2] for c in outbox.mark_calls} == {"usage", "quota", "audit"}
    db.usage.accumulate_usage.assert_awaited_once()
    db.anon_quota.increment_and_count.assert_awaited_once()


async def test_replay_of_already_settled_turn_does_not_reapply() -> None:
    """A replay hits the idempotent enqueue (rows exist) so settle skips apply."""
    outbox = _FakeOutbox()
    # Pre-populate the durable rows as if the first settle already ran.
    for kind in KINDS:
        await outbox.enqueue(
            OutboxEntry(turn_key="turn-r", kind=kind, session_id="s-r")
        )
    outbox.mark_calls.clear()
    db = _db(outbox)

    # A direct replay re-settles; verify enqueue (rows exist) suppresses apply.
    from animichi.application.turn_types import TurnSideEffects
    from animichi.interfaces.public_api import _RuntimeTurnSettlement

    settlement = _RuntimeTurnSettlement(
        _api(db),
        request=PublicAPIRequest(text="x"),
        user_id=None,
        user_type=None,
        is_byok=False,
    )
    await settlement.settle(
        TurnSideEffects(
            result=None,
            session_id="s-r",
            turn_key="turn-r",
            user_id=None,
            user_type=None,
            is_byok=False,
            settle_quota=False,
            elapsed_ms=1,
            intent="replayed",
            status="ok",
            request_text="x",
        )
    )
    assert outbox.enqueue_calls[-1].kind == "audit"
    assert not outbox.mark_calls  # nothing new was created, so no mark
    db.usage.accumulate_usage.assert_not_awaited()
    db.anon_quota.increment_and_count.assert_not_awaited()
