"""Billing attribution for the BYOK post-turn translation fallback (#532)."""

from __future__ import annotations

from datetime import date
from typing import cast
from unittest.mock import AsyncMock, patch

from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_deps import TitleTranslator
from animichi.agents.translation import TranslationContext, TranslationResult
from animichi.application.agent_turn import TextTurn, TurnSideEffects
from animichi.clients.catalog_client import CatalogClientProtocol
from animichi.config.settings import Settings
from animichi.interfaces.public_api import (
    PublicAPIRequest,
    RuntimeAPI,
    _RuntimeTurnExecution,
    _RuntimeTurnSettlement,
)
from animichi.interfaces.usage_metering import UsageScope
from animichi.tests.unit.conftest_public_api import make_result

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


def _execution(
    api: RuntimeAPI, *, model: TestModel, is_byok: bool
) -> _RuntimeTurnExecution:
    return _RuntimeTurnExecution(
        api,
        request=PublicAPIRequest(text="请翻译", locale="zh"),
        model=model,
        is_byok=is_byok,
        user_id="user-1",
        on_step=None,
    )


async def _settle_usage(api: RuntimeAPI, result: AgentResult, *, is_byok: bool) -> None:
    settlement = _RuntimeTurnSettlement(
        api,
        request=PublicAPIRequest(text="请翻译", locale="zh"),
        user_id="user-1",
        user_type="human",
        is_byok=is_byok,
    )
    await settlement.settle(
        TurnSideEffects(
            result=result,
            session_id=None,
            user_id="user-1",
            user_type="human",
            is_byok=is_byok,
            settle_quota=False,
            elapsed_ms=0,
            intent="qa",
            status="ok",
            request_text="请翻译",
        )
    )


async def _run_pipeline(
    api: RuntimeAPI,
    result: AgentResult,
    model: TestModel,
    *,
    is_byok: bool,
) -> None:
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(return_value=result),
    ):
        await _execution(api, model=model, is_byok=is_byok).execute(
            TextTurn(text="请翻译", locale="zh"),
            context=None,
            history=(),
            model=model,
            on_step=None,
        )
    await _settle_usage(api, result, is_byok=is_byok)


async def _translated_text(
    text: str, *, target_locale: str, ctx: TranslationContext | None = None
) -> str:
    del text, target_locale
    assert ctx is not None
    ctx.usage.requests += 1
    ctx.usage.input_tokens += 1_000_000
    ctx.usage.output_tokens += 1_000_000
    return "已翻译"


async def _translated_title(
    title: str,
    *,
    target_locale: str,
    kind: str,
    catalog: CatalogClientProtocol,
    ctx: TranslationContext | None = None,
) -> TranslationResult:
    del target_locale, kind, catalog
    assert ctx is not None
    ctx.usage.requests += 1
    ctx.usage.input_tokens += 1_000_000
    ctx.usage.output_tokens += 1_000_000
    return TranslationResult(title, "Title", "llm")


async def _run_with_title_translation(
    *, title_translator: TitleTranslator | None = None, **kwargs: object
) -> AgentResult:
    del kwargs
    assert title_translator is not None
    await title_translator("タイトル", "en")
    return _result("already English")


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
        patch(
            "animichi.interfaces.public_api.resolve_model", return_value=server_model
        ),
        patch("animichi.interfaces.public_api.translate_text", new=translate),
    ):
        await _run_pipeline(_api(repo), result, TestModel(), is_byok=True)

    assert translate.await_args.kwargs["ctx"].model is server_model
    assert [(call.scope, call.cost_usd) for call in repo.calls] == [
        ("byok", 0.0),
        ("user", 10.0),
    ]


async def test_byok_title_translation_platform_usage_is_billed_to_user_scope() -> None:
    repo = UsageRepo()
    api = _api(repo)
    with (
        patch(
            "animichi.interfaces.public_api.run_animichi_agent",
            new=AsyncMock(side_effect=_run_with_title_translation),
        ),
        patch(
            "animichi.interfaces.public_api.translate_title",
            new=AsyncMock(side_effect=_translated_title),
        ),
    ):
        executed = await _execution(api, model=TestModel(), is_byok=True).execute(
            TextTurn(text="translate title", locale="ja"),
            context=None,
            history=(),
            model=TestModel(),
            on_step=None,
        )
    await _settle_usage(api, executed.output, is_byok=True)
    assert [(call.scope, call.cost_usd) for call in repo.calls] == [
        ("byok", 0.0),
        ("user", 10.0),
    ]


async def test_non_byok_translation_remains_platform_billed() -> None:
    repo = UsageRepo()
    result = _result("日本語の返答")

    with patch("animichi.interfaces.public_api.translate_text", new=_translated_text):
        await _run_pipeline(_api(repo), result, TestModel(), is_byok=False)

    assert [(call.scope, call.cost_usd) for call in repo.calls] == [("user", 12.0)]
