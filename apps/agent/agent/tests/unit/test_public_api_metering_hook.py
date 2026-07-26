"""`RuntimeAPI.handle` must bank every turn into ``daily_usage`` (issue #274).

The metering hook in ``handle``'s finally block is the sole writer of the
table the anonymous daily-budget breaker (X4) reads. Nothing else pins that
one call, so a refactor that drops it would silently disarm the breaker.
These tests pin it at the ``handle`` level, on both the success path and the
raising path — a failed turn still burned tokens and must still be charged.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.usage import RunUsage

from agent.agents.agent_result import AgentResult
from agent.config.settings import Settings
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from agent.tests.unit.conftest_public_api import make_result, make_run_agent_stub

ANON_USER_ID = "anon_0123456789abcdef0123456789abcdef"
PRICED = Settings(model_input_cost_per_mtok_usd=2.0, model_output_cost_per_mtok_usd=8.0)


def _db() -> MagicMock:
    """A db double whose repos are async, with a recording usage meter."""
    db = MagicMock()
    db.pool.fetch = AsyncMock(return_value=[])
    db.session = AsyncMock()
    db.routes = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-1")
    db.usage = AsyncMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    return db


def _metered_result() -> AgentResult:
    result = make_result()
    result.usage = RunUsage(input_tokens=1_000_000, output_tokens=500_000, requests=1)
    return result


def _api(db: MagicMock) -> RuntimeAPI:
    return RuntimeAPI(db, settings=PRICED, model_http_client=MagicMock())


async def test_a_successful_turn_banks_its_usage_into_the_daily_meter() -> None:
    db = _db()
    stub = make_run_agent_stub(_metered_result())
    with patch("agent.interfaces.public_api.run_animichi_agent", side_effect=stub):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
        )
    db.usage.accumulate_usage.assert_awaited_once()


async def test_the_metered_turn_is_priced_and_scoped_to_the_anonymous_pool() -> None:
    db = _db()
    stub = make_run_agent_stub(_metered_result())
    with patch("agent.interfaces.public_api.run_animichi_agent", side_effect=stub):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
        )
    kwargs = db.usage.accumulate_usage.await_args.kwargs
    assert kwargs["scope"] == "anon"
    assert kwargs["input_tokens"] == 1_000_000
    assert kwargs["cost_usd"] == 6.0


async def test_a_logged_in_turn_is_banked_against_the_user_pool() -> None:
    db = _db()
    stub = make_run_agent_stub(_metered_result())
    with patch("agent.interfaces.public_api.run_animichi_agent", side_effect=stub):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"), user_id="user-1", user_type="human"
        )
    assert db.usage.accumulate_usage.await_args.kwargs["scope"] == "user"


async def test_a_turn_that_raises_after_the_agent_ran_is_still_metered() -> None:
    """Persistence blew up, but the model was already paid for."""
    db = _db()
    stub = make_run_agent_stub(_metered_result())
    with (
        patch("agent.interfaces.public_api.run_animichi_agent", side_effect=stub),
        patch(
            "agent.interfaces.public_api.persist_result",
            new=AsyncMock(side_effect=RuntimeError("session store down")),
        ),
        pytest.raises(RuntimeError),
    ):
        await _api(db).handle(
            PublicAPIRequest(text="京吹の聖地"),
            user_id=ANON_USER_ID,
            user_type="anonymous",
        )
    db.usage.accumulate_usage.assert_awaited_once()
