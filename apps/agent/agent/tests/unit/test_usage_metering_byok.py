"""BYOK metering scope: zero cost, non-zero tokens, no bleed into `anon` (#284 T4).

`scope_for_identity`'s own BYOK classification is already covered in
`test_usage_metering.py`; this file is the T4 AC that a completed BYOK turn
is actually *banked* under `UsageScope "byok"` with `cost_usd == 0.0` while
today's `anon` spend total is left untouched — the scope split, not just the
classifier, matters, since a bug that recorded the right scope but the wrong
price would still let a BYOK turn silently inflate the anonymous budget's
denominator or (worse) its numerator.
"""

from __future__ import annotations

from datetime import date
from typing import cast

from pydantic_ai.usage import RunUsage

from agent.agents.agent_result import AgentResult
from agent.clients.catalog_client import CatalogClientProtocol
from agent.config.settings import Settings
from agent.interfaces.public_api import RuntimeAPI

_PRICED_SETTINGS = Settings(
    model_input_cost_per_mtok_usd=2.0, model_output_cost_per_mtok_usd=8.0
)


class _UsageRepoDouble:
    """#479 P3 review follow-up: `total_cost_usd` used to ignore its `scope`
    argument entirely and always return `0.0` — every assertion that read
    `verdict.spent_usd == 0.0` would have passed even if `accumulate_usage`
    banked a BYOK turn's cost straight into the `anon` scope, because this
    double could never report anything else. It now sums the SAME
    `(usage_date, scope)` bucket `anonymous_budget_verdict` actually reads,
    so a real accounting bug shows up as a non-zero `spent_usd`.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[date, str, int, int, float]] = []
        self._totals: dict[tuple[date, str], float] = {}

    async def accumulate_usage(
        self,
        *,
        usage_date: date,
        scope: str,
        requests: int,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        del requests
        self.calls.append((usage_date, scope, input_tokens, output_tokens, cost_usd))
        key = (usage_date, scope)
        self._totals[key] = self._totals.get(key, 0.0) + cost_usd

    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float:
        return self._totals.get((usage_date, scope), 0.0)


class _Db:
    def __init__(self, usage: object) -> None:
        self.usage = usage


def _api(db: object) -> RuntimeAPI:
    return RuntimeAPI(
        db,
        catalog=cast(CatalogClientProtocol, object()),
        model_http_client=cast(object, object()),
        settings=_PRICED_SETTINGS,
    )


def _result(usage: RunUsage) -> AgentResult:
    from agent.agents.runtime_models import QAResponseModel

    return AgentResult(
        output=QAResponseModel(message="hi"),
        intent="qa",
        session_state=object(),
        steps=[],
        tool_state={},
        new_messages=[],
        usage=usage,
    )


async def test_a_byok_turn_is_banked_at_zero_cost_with_nonzero_tokens() -> None:
    repo = _UsageRepoDouble()
    api = _api(_Db(repo))
    usage = RunUsage(input_tokens=1200, output_tokens=340, requests=1)

    await api._record_usage(_result(usage), "user-1", "human", is_byok=True)

    assert len(repo.calls) == 1
    usage_date, scope, input_tokens, output_tokens, cost_usd = repo.calls[0]
    assert scope == "byok"
    assert cost_usd == 0.0
    assert input_tokens == 1200
    assert output_tokens == 340


async def test_a_non_byok_turn_is_still_priced_normally() -> None:
    """Regression: `is_byok=False` must not silently gain the zero-price path."""
    repo = _UsageRepoDouble()
    api = _api(_Db(repo))
    usage = RunUsage(input_tokens=1000, output_tokens=1000, requests=1)

    await api._record_usage(_result(usage), "user-1", "human", is_byok=False)

    assert len(repo.calls) == 1
    _usage_date, scope, _input, _output, cost_usd = repo.calls[0]
    assert scope == "user"
    assert cost_usd > 0.0


async def test_a_byok_turn_never_moves_todays_anon_spend_total() -> None:
    """A BYOK turn banks under `byok`, so a read of today's `anon` total is
    unaffected — the anonymous budget's denominator never sees BYOK spend.

    #479 P3 review follow-up: both calls below must resolve `today` from the
    SAME clock. `_record_usage` has no `today=` override (it always calls
    `utc_today()` internally), so reading the verdict against a fixed,
    unrelated calendar date (the original version of this test used a
    hardcoded `TODAY` constant) would make `spent_usd == 0.0` pass for the
    wrong reason — a date-bucket mismatch — even if a real accounting bug
    banked the BYOK turn under `anon`. Reading with no `today=` override
    (defaulting to the same `utc_today()`) is what actually exercises the
    scope split.
    """
    from agent.interfaces.usage_metering import anonymous_budget_verdict

    repo = _UsageRepoDouble()
    api = _api(_Db(repo))
    usage = RunUsage(input_tokens=500, output_tokens=200, requests=1)

    await api._record_usage(_result(usage), "anon_abc", "anonymous", is_byok=True)

    verdict = await anonymous_budget_verdict(_Db(repo), budget_usd=1.0)
    assert verdict.spent_usd == 0.0
    assert verdict.exhausted is False
    assert repo.calls[0][1] == "byok"
