"""`RuntimeAPI.handle` must bank every turn into ``daily_usage`` (issue #274).

The durable outbox (#1014 AC5) is the sole writer: ``settle`` enqueues the
usage row, and the drain banks it once under the correct scope/pricing. These
tests pin that contract at the ``handle`` level on both the success and the
raising path — a failed turn still burned tokens and must still be charged.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.usage import RunUsage

from animichi.agents.agent_result import AgentResult
from animichi.application.outbox import TurnOutbox
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
    db.usage.accumulate_usage_on = AsyncMock(return_value=None)
    return db, outbox


def _metered_result() -> AgentResult:
    result = make_result()
    result.usage = RunUsage(input_tokens=1_000_000, output_tokens=500_000, requests=1)
    return result


def _api(db: MagicMock) -> RuntimeAPI:
    return RuntimeAPI(db, settings=PRICED, model_http_client=MagicMock())


def _dispatcher(db: MagicMock) -> SettlementOutboxDispatcher:
    return SettlementOutboxDispatcher(
        SettlementInputs(
            usage_repo=db.usage,
            anon_quota_repo=None,
            request_audit_repo=None,
            messages_repo=None,
            prices=UsagePrices(2.0, 8.0),
        )
    )


async def _handle_and_drain(
    db: MagicMock,
    outbox: MemoryOutbox,
    *,
    is_byok: bool = False,
    user_id: str | None = None,
    user_type: str | None = "anonymous",
) -> None:
    stub = make_run_agent_stub(_metered_result())
    with patch("animichi.interfaces.public_api.run_animichi_agent", side_effect=stub):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=user_id,
            user_type=user_type,
            is_byok=is_byok,
        )
    await TurnOutbox(store=outbox).drain(_dispatcher(db))


async def test_a_successful_turn_banks_its_usage_into_the_daily_meter() -> None:
    db, outbox = _db()
    await _handle_and_drain(db, outbox)
    db.usage.accumulate_usage_on.assert_awaited_once()


async def test_the_metered_turn_is_priced_and_scoped_to_the_anonymous_pool() -> None:
    db, outbox = _db()
    await _handle_and_drain(db, outbox)
    kwargs = db.usage.accumulate_usage_on.await_args.kwargs
    assert kwargs["scope"] == "anon"
    assert kwargs["input_tokens"] == 1_000_000
    assert kwargs["cost_usd"] == 6.0


async def test_a_logged_in_turn_is_banked_against_the_user_pool() -> None:
    db, outbox = _db()
    await _handle_and_drain(db, outbox, user_id="user-1", user_type="human")
    assert db.usage.accumulate_usage_on.await_args.kwargs["scope"] == "user"


async def test_a_byok_turn_is_banked_at_zero_cost_but_full_token_counts() -> None:
    """#284 T3: BYOK cost_usd is always zero; tokens are still recorded."""
    db, outbox = _db()
    await _handle_and_drain(
        db, outbox, is_byok=True, user_id="user-1", user_type="human"
    )
    kwargs = db.usage.accumulate_usage_on.await_args.kwargs
    assert kwargs["scope"] == "byok"
    assert kwargs["cost_usd"] == 0.0
    assert kwargs["input_tokens"] == 1_000_000
    assert kwargs["output_tokens"] == 500_000


async def test_a_turn_that_raises_after_the_agent_ran_is_still_metered() -> None:
    """Persistence blew up, but the model was already paid for."""
    db, outbox = _db()
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
        )
    await TurnOutbox(store=outbox).drain(_dispatcher(db))
    db.usage.accumulate_usage_on.assert_awaited_once()
