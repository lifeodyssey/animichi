"""BYOK metering scope: zero cost, non-zero tokens, no bleed into `anon` (#284 T4).

Completes the T4 AC that a BYOK turn is banked under `UsageScope "byok"` at
zero cost. Under the durable outbox (#1014 AC5) settle only enqueues the
usage row; the drain applies it once, so each test settles then drains.
"""

from __future__ import annotations

from datetime import date

import pytest
from pydantic_ai.usage import RunUsage

from animichi.agents.agent_result import AgentResult
from animichi.application.agent_turn import TurnSideEffects
from animichi.application.outbox import TurnOutbox
from animichi.config.settings import Settings
from animichi.interfaces.outbox_dispatch import (
    SettlementInputs,
    SettlementOutboxDispatcher,
)
from animichi.interfaces.public_api import (
    PublicAPIRequest,
    RuntimeAPI,
    _RuntimeTurnSettlement,
)
from animichi.interfaces.usage_metering import UsagePrices
from animichi.tests.unit.outbox_fakes import MemoryOutbox

_PRICED_SETTINGS = Settings(
    model_input_cost_per_mtok_usd=2.0, model_output_cost_per_mtok_usd=8.0
)


class _UsageRepoDouble:
    """Records accumulate_usage_on calls and sums a (date, scope) bucket."""

    def __init__(self) -> None:
        self.calls: list[tuple[date, str, int, int, float]] = []
        self._totals: dict[tuple[date, str], float] = {}

    async def accumulate_usage_on(
        self,
        session: object,
        *,
        usage_date: date,
        scope: str,
        requests: int,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        del session, requests
        self.calls.append((usage_date, scope, input_tokens, output_tokens, cost_usd))
        key = (usage_date, scope)
        self._totals[key] = self._totals.get(key, 0.0) + cost_usd

    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float:
        return self._totals.get((usage_date, scope), 0.0)


class _Db:
    def __init__(self, usage: object, outbox: MemoryOutbox) -> None:
        self.usage = usage
        self.outbox = outbox


def _api(db: object) -> RuntimeAPI:
    return RuntimeAPI(
        db,
        catalog=object(),
        model_http_client=object(),
        settings=_PRICED_SETTINGS,
    )


async def _settle_and_drain(
    db: _Db,
    result: AgentResult,
    user_id: str,
    user_type: str,
    *,
    is_byok: bool,
) -> _UsageRepoDouble:
    api = _api(db)
    settlement = _RuntimeTurnSettlement(
        api,
        request=PublicAPIRequest(text="x"),
        user_id=user_id,
        user_type=user_type,
        is_byok=is_byok,
    )
    await settlement.settle(
        TurnSideEffects(
            result=result,
            session_id=None,
            turn_key="turn-1",
            user_id=user_id,
            user_type=user_type,
            is_byok=is_byok,
            settle_quota=False,
            elapsed_ms=0,
            intent="qa",
            status="ok",
            request_text="x",
        )
    )
    repo = db.usage
    dispatcher = SettlementOutboxDispatcher(
        SettlementInputs(
            usage_repo=repo,
            anon_quota_repo=None,
            request_audit_repo=None,
            messages_repo=None,
            prices=UsagePrices(2.0, 8.0),
        )
    )
    await TurnOutbox(store=db.outbox).drain(dispatcher)
    return repo


def _result(usage: RunUsage) -> AgentResult:
    from animichi.agents.runtime_models import QAResponseModel

    return AgentResult(
        output=QAResponseModel(message="hi"),
        intent="qa",
        session_state=object(),
        steps=[],
        new_messages=[],
        usage=usage,
    )


async def test_a_byok_turn_is_banked_at_zero_cost_with_nonzero_tokens() -> None:
    repo = _UsageRepoDouble()
    outbox = MemoryOutbox()
    usage = RunUsage(input_tokens=1200, output_tokens=340, requests=1)

    await _settle_and_drain(
        _Db(repo, outbox), _result(usage), "user-1", "human", is_byok=True
    )

    assert len(repo.calls) == 1
    _date, scope, input_tokens, output_tokens, cost_usd = repo.calls[0]
    assert scope == "byok"
    assert cost_usd == 0.0
    assert input_tokens == 1200
    assert output_tokens == 340
    del _date


async def test_a_non_byok_turn_is_still_priced_normally() -> None:
    repo = _UsageRepoDouble()
    outbox = MemoryOutbox()
    usage = RunUsage(input_tokens=1000, output_tokens=1000, requests=1)

    await _settle_and_drain(
        _Db(repo, outbox), _result(usage), "user-1", "human", is_byok=False
    )

    assert len(repo.calls) == 1
    _date, scope, _in, _out, cost_usd = repo.calls[0]
    assert scope == "user"
    assert cost_usd > 0.0
    del _date


async def test_a_byok_turn_never_moves_todays_anon_spend_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from animichi.interfaces.usage_metering import anonymous_budget_verdict

    fixed_today = date(2026, 8, 3)
    monkeypatch.setattr(
        "animichi.interfaces.usage_metering.utc_today", lambda now=None: fixed_today
    )

    repo = _UsageRepoDouble()
    outbox = MemoryOutbox()
    usage = RunUsage(input_tokens=500, output_tokens=200, requests=1)
    await _settle_and_drain(
        _Db(repo, outbox), _result(usage), "anon_abc", "anonymous", is_byok=True
    )

    verdict = await anonymous_budget_verdict(repo, budget_usd=1.0)
    assert verdict.spent_usd == 0.0
    assert verdict.is_exhausted is False
    assert repo.calls[0][1] == "byok"
    assert repo.calls[0][0] == fixed_today
