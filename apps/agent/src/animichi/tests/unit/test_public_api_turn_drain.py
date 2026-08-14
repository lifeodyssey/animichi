"""RuntimeAPI.handle settlement on turn failure paths (TURN-3 #951).

Proves the reserved-turn failure branches at the handle boundary: a turn that
raises after the agent ran still settles completed and enqueues its usage for
a later drain; a turn that dies before dispatch is released, not settled.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
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
PRICED_TOKENS = UsagePrices(input_usd_per_mtok=2.0, output_usd_per_mtok=8.0)
TURN_REF = TurnRef(session_id="s-1", turn_key="turn-1")
OWNER = "owner-1"


class _RecordingStore:
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


def _db() -> tuple[MagicMock, MemoryOutbox]:
    outbox = MemoryOutbox()
    db = MagicMock()
    db.session = AsyncMock()
    db.outbox = outbox
    db.usage = AsyncMock()
    db.usage.accumulate_usage_on = AsyncMock(return_value=None)
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count_on = AsyncMock(return_value=1)
    return db, outbox


def _metered_result() -> AgentResult:
    result = make_result()
    result.usage = RunUsage(input_tokens=1_000_000, output_tokens=500_000, requests=1)
    return result


def _api(db: MagicMock) -> RuntimeAPI:
    return RuntimeAPI(db, settings=PRICED, model_http_client=MagicMock())


def _outcome(store: _RecordingStore) -> TurnOutcome:
    return TurnOutcome(store=store, admission=None)


async def _drain(db: MagicMock, outbox: MemoryOutbox) -> None:
    await TurnOutbox(store=outbox).drain(
        SettlementOutboxDispatcher(
            SettlementInputs(
                usage_repo=db.usage,
                anon_quota_repo=db.anon_quota,
                request_audit_repo=None,
                messages_repo=None,
                prices=PRICED_TOKENS,
            )
        )
    )


async def test_a_turn_that_raises_after_the_agent_ran_still_settles_and_meters() -> (
    None
):
    """Provider ran before persistence blew up; turn settles completed."""
    db, outbox = _db()
    store = _RecordingStore()
    stub = make_run_agent_stub(_metered_result())
    with (
        patch("animichi.interfaces.public_api.run_animichi_agent", side_effect=stub),
        patch(
            "animichi.interfaces.public_api.persist_result",
            new=AsyncMock(side_effect=RuntimeError("session store down")),
        ),
        pytest.raises(RuntimeError),
    ):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=_outcome(store),
            turn_ref=TURN_REF,
            owner=OWNER,
        )
    assert ("settle", "s-1", "turn-1", OWNER, "completed") in store.calls
    assert not any(c[0] == "release" for c in store.calls)
    assert outbox.pending_kinds() == {"usage", "quota", "audit"}
    # A later drain meters the burned tokens exactly once.
    await _drain(db, outbox)
    db.usage.accumulate_usage_on.assert_awaited_once()
    db.anon_quota.increment_and_count_on.assert_awaited_once()


async def test_a_turn_that_dies_before_dispatch_is_released_not_settled() -> None:
    db, outbox = _db()
    store = _RecordingStore()

    async def _session_boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("session store down")

    with (
        patch(
            "animichi.interfaces.public_api.create_owned_session",
            side_effect=_session_boom,
        ),
        pytest.raises(RuntimeError),
    ):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
            outcome=_outcome(store),
            turn_ref=TURN_REF,
            owner=OWNER,
        )
    assert ("release", "s-1", "turn-1", OWNER) in store.calls
    assert not any(c[0] == "settle" for c in store.calls)
    assert outbox.pending_kinds() == set()
    db.usage.accumulate_usage_on.assert_not_awaited()
    db.anon_quota.increment_and_count_on.assert_not_awaited()
