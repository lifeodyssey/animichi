"""Durable-outbox replay dedup (issue #1014, AC5).

A replayed settle of an already-settled turn hits the idempotent enqueue (the
durable (turn_key, kind) rows already exist), so it creates no new row and
applies nothing.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from animichi.application.outbox_port import OutboxEntry
from animichi.config.settings import Settings
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.tests.unit.outbox_fakes import MemoryOutbox

ANON_USER_ID = "anon_0123456789abcdef0123456789abcdef"
PRICED = Settings(model_input_cost_per_mtok_usd=2.0, model_output_cost_per_mtok_usd=8.0)
KINDS = ("usage", "quota", "audit")


def _db() -> tuple[MagicMock, MemoryOutbox]:
    """A db double with a recording usage meter and a durable outbox."""
    outbox = MemoryOutbox()
    db = MagicMock()
    db.session = AsyncMock()
    db.outbox = outbox
    db.usage = AsyncMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=1)
    return db, outbox


def _api(db: MagicMock) -> RuntimeAPI:
    return RuntimeAPI(db, settings=PRICED, model_http_client=MagicMock())


async def test_replay_of_already_settled_turn_creates_no_rows() -> None:
    """A replay hits the idempotent enqueue (rows exist) so nothing is created."""
    outbox = MemoryOutbox()
    for kind in KINDS:
        await outbox.enqueue(
            OutboxEntry(turn_key="turn-r", kind=kind, session_id="s-r")
        )
    db, _ = _db()
    before = len(outbox.rows)

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
    # No new rows were created and the replay applied nothing.
    assert len(outbox.rows) == before
    assert outbox.delivered == set()
    db.usage.accumulate_usage.assert_not_awaited()
    db.anon_quota.increment_and_count.assert_not_awaited()
