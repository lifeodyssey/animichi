"""Billing attribution for the BYOK post-turn translation fallback (#532)."""

from __future__ import annotations

from datetime import date
from typing import cast
from unittest.mock import AsyncMock, patch

from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from agent.agents.agent_result import AgentResult
from agent.agents.translation import TranslationContext
from agent.clients.catalog_client import CatalogClientProtocol
from agent.config.settings import Settings
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from agent.interfaces.usage_metering import UsageScope
from agent.tests.unit.conftest_public_api import make_result

PRICED = Settings(
    model_input_cost_per_mtok_usd=2.0,
    model_output_cost_per_mtok_usd=8.0,
)


class UsageCall:
    def __init__(self, scope: UsageScope, usage: RunUsage, cost_usd: float) -> None:
        self.scope = scope
        self.usage = usage
        self.cost_usd = cost_usd


class UsageRepo:
    def __init__(self) -> None:
        self.calls: list[UsageCall] = []

    async def accumulate_usage(
        self,
        *,
        usage_date: date,
        scope: UsageScope,
        requests: int,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        del usage_date
        usage = RunUsage(
            requests=requests,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        self.calls.append(UsageCall(scope, usage, cost_usd))


class Database:
    def __init__(self, usage: UsageRepo) -> None:
        self.usage = usage


def _api(repo: UsageRepo) -> RuntimeAPI:
    return RuntimeAPI(
        Database(repo),
        catalog=cast(CatalogClientProtocol, object()),
        model_http_client=cast(object, object()),
        settings=PRICED,
    )


def _result(message: str) -> AgentResult:
    result = make_result(intent="qa", message=message)
    result.usage = RunUsage(requests=1, input_tokens=1_000_000)
    return result


async def _run_pipeline(
    api: RuntimeAPI,
    result: AgentResult,
    model: TestModel,
    *,
    is_byok: bool,
) -> None:
    dispatch = AsyncMock(return_value=(result, model, True))
    with patch.object(api, "_dispatch_request", new=dispatch):
        await api._execute_pipeline(
            PublicAPIRequest(text="请翻译", locale="zh"),
            None,
            [],
            model,
            None,
            object(),
            "user-1",
            is_byok=is_byok,
        )
    await api._record_usage(result, "user-1", "human", is_byok=is_byok)


async def _translated_text(
    text: str, *, target_locale: str, ctx: TranslationContext | None = None
) -> str:
    del text, target_locale
    assert ctx is not None
    ctx.usage.requests += 1
    ctx.usage.input_tokens += 1_000_000
    ctx.usage.output_tokens += 1_000_000
    return "已翻译"


async def test_byok_without_translation_stays_zero_cost() -> None:
    repo = UsageRepo()
    result = _result("已经是中文")

    await _run_pipeline(_api(repo), result, TestModel(), is_byok=True)

    assert [(call.scope, call.cost_usd) for call in repo.calls] == [("byok", 0.0)]


async def test_byok_platform_translation_is_billed_to_user_scope() -> None:
    repo = UsageRepo()
    result = _result("日本語の返答")
    server_model = TestModel()
    translate = AsyncMock(side_effect=_translated_text)

    with (
        patch("agent.interfaces.public_api.resolve_model", return_value=server_model),
        patch("agent.interfaces.public_api.translate_text", new=translate),
    ):
        await _run_pipeline(_api(repo), result, TestModel(), is_byok=True)

    assert translate.await_args.kwargs["ctx"].model is server_model
    assert [(call.scope, call.cost_usd) for call in repo.calls] == [
        ("byok", 0.0),
        ("user", 10.0),
    ]


async def test_non_byok_translation_remains_platform_billed() -> None:
    repo = UsageRepo()
    result = _result("日本語の返答")

    with patch("agent.interfaces.public_api.translate_text", new=_translated_text):
        await _run_pipeline(_api(repo), result, TestModel(), is_byok=False)

    assert [(call.scope, call.cost_usd) for call in repo.calls] == [("user", 12.0)]
