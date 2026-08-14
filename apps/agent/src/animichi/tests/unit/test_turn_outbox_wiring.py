"""Wire the durable outbox into turn settlement (issue #1014, AC5).

``_RuntimeTurnSettlement.settle`` ENQUEUES only — a fresh settle records the
three durable rows (never applying inline), and the transactional background
drain applies each effect exactly once on the store's session. This file
owns the fresh-settle path; the replay-dedup contract lives in
``test_turn_outbox_drain.py``.
"""

from __future__ import annotations

from unittest.mock import patch

from animichi.application.outbox import TurnOutbox
from animichi.interfaces.public_api import PublicAPIRequest
from animichi.interfaces.usage_metering import UsagePrices
from animichi.tests.unit.conftest_public_api import make_run_agent_stub
from animichi.tests.unit.public_api_fakes import (
    ANON_USER_ID,
    OWNER,
    TURN_REF,
    MemoryStore,
    make_api,
    make_db,
    make_dispatcher,
    make_outcome,
    metered_result,
)


async def test_fresh_settle_enqueues_and_drain_applies_once() -> None:
    db, outbox = make_db()
    stub = make_run_agent_stub(metered_result())
    with patch("animichi.interfaces.public_api.run_animichi_agent", side_effect=stub):
        await make_api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=make_outcome(MemoryStore()),
            turn_ref=TURN_REF,
            owner=OWNER,
        )
    # Settle only enqueues the three durable rows; nothing applied inline.
    assert len(outbox.rows) == 3
    assert {e.kind for e in outbox.rows} == {"usage", "quota", "audit"}
    db.usage.accumulate_usage.assert_not_awaited()
    db.anon_quota.increment_and_count.assert_not_awaited()
    # The drain applies usage + quota exactly once via the store transaction.
    dispatcher = make_dispatcher(
        db,
        audit_repo=db.feedback,
        messages_repo=db.session,
        prices=UsagePrices(0.0, 0.0),
    )
    delivered = await TurnOutbox(store=outbox).drain(dispatcher)
    assert delivered == 3
    db.usage.accumulate_usage_on.assert_awaited_once()
    db.anon_quota.increment_and_count_on.assert_awaited_once()
    # Delivered rows are not re-applied on a second drain.
    assert await TurnOutbox(store=outbox).drain(dispatcher) == 0
    db.usage.accumulate_usage_on.assert_awaited_once()
