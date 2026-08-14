"""RuntimeAPI.handle settlement on turn failure paths (TURN-3 #951).

Proves the reserved-turn failure branches at the handle boundary: a turn that
raises after the agent ran still settles completed and enqueues its usage for
a later drain; a turn that dies before dispatch is released, not settled.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from animichi.application.turn_outcome import TurnOutcome
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.tests.unit.conftest_public_api import make_run_agent_stub
from animichi.tests.unit.public_api_fakes import (
    ANON_USER_ID,
    OWNER,
    TURN_REF,
    MemoryStore,
    drain,
    make_api,
    make_db,
    make_outcome,
    metered_result,
)


async def _handle(api: RuntimeAPI, outcome: TurnOutcome) -> None:
    with pytest.raises(RuntimeError):
        await api.handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=outcome,
            turn_ref=TURN_REF,
            owner=OWNER,
        )


async def test_a_turn_that_raises_after_the_agent_ran_still_settles_and_meters() -> (
    None
):
    """Provider ran before persistence blew up; turn settles completed."""
    db, outbox = make_db()
    store = MemoryStore()
    outcome = make_outcome(store)
    api = make_api(db)
    stub = make_run_agent_stub(metered_result())
    with (
        patch("animichi.interfaces.public_api.run_animichi_agent", side_effect=stub),
        patch(
            "animichi.interfaces.public_api.persist_result",
            new=AsyncMock(side_effect=RuntimeError("session store down")),
        ),
    ):
        await _handle(api, outcome)
    assert ("settle", "s-1", "turn-1", OWNER, "completed") in store.calls
    assert not any(c[0] == "release" for c in store.calls)
    assert outbox.pending_kinds() == {"usage", "quota", "audit"}
    # A later drain meters the burned tokens exactly once.
    await drain(db, outbox)
    db.usage.accumulate_usage_on.assert_awaited_once()
    db.anon_quota.increment_and_count_on.assert_awaited_once()


async def test_a_turn_that_dies_before_dispatch_is_released_not_settled() -> None:
    db, outbox = make_db()
    store = MemoryStore()
    outcome = make_outcome(store)
    api = make_api(db)

    async def _session_boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("session store down")

    with patch(
        "animichi.interfaces.public_api.create_owned_session",
        side_effect=_session_boom,
    ):
        await _handle(api, outcome)
    assert ("release", "s-1", "turn-1", OWNER) in store.calls
    assert not any(c[0] == "settle" for c in store.calls)
    assert outbox.pending_kinds() == set()
    db.usage.accumulate_usage_on.assert_not_awaited()
    db.anon_quota.increment_and_count_on.assert_not_awaited()
