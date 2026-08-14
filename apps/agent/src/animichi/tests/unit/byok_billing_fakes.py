"""Shared helpers for BYOK billing-attribution tests (#532, #1014 AC5).

Both BYOK billing test files drive settle + the durable-outbox drain, so the
fakes and ``_run_pipeline``/``_settle_and_drain`` plumbing are shared here.
Not a test module: nothing here starts with ``test_``.
"""

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
from animichi.application.outbox import TurnOutbox
from animichi.clients.catalog_client import CatalogClientProtocol
from animichi.config.settings import Settings
from animichi.interfaces.outbox_dispatch import (
    SettlementInputs,
    SettlementOutboxDispatcher,
)
from animichi.interfaces.public_api import (
    PublicAPIRequest,
    RuntimeAPI,
    _RuntimeTurnExecution,
    _RuntimeTurnSettlement,
)
from animichi.interfaces.usage_metering import UsagePrices, UsageScope
from animichi.tests.unit.conftest_public_api import make_result
from animichi.tests.unit.outbox_fakes import MemoryOutbox

PRICED = Settings(
    model_input_cost_per_mtok_usd=2.0,
    model_output_cost_per_mtok_usd=8.0,
)
PRICED_TOKENS = UsagePrices(input_usd_per_mtok=2.0, output_usd_per_mtok=8.0)


class UsageCall:
    def __init__(self, scope: UsageScope, usage: RunUsage, cost_usd: float) -> None:
        self.scope = scope
        self.usage = usage
        self.cost_usd = cost_usd


class UsageRepo:
    def __init__(self) -> None:
        self.calls: list[UsageCall] = []

    async def accumulate_usage_on(
        self,
        session: object,
        *,
        usage_date: date,
        scope: UsageScope,
        requests: int,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        del session, usage_date
        usage = RunUsage(
            requests=requests, input_tokens=input_tokens, output_tokens=output_tokens
        )
        self.calls.append(UsageCall(scope, usage, cost_usd))


class Database:
    def __init__(self, usage: UsageRepo, outbox: MemoryOutbox) -> None:
        self.usage = usage
        self.outbox = outbox


def _api(repo: UsageRepo) -> tuple[RuntimeAPI, MemoryOutbox]:
    outbox = MemoryOutbox()
    return (
        RuntimeAPI(
            Database(repo, outbox),
            catalog=cast(CatalogClientProtocol, object()),
            model_http_client=cast(object, object()),
            settings=PRICED,
        ),
        outbox,
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


async def _settle_and_drain(
    api: RuntimeAPI,
    outbox: MemoryOutbox,
    repo: UsageRepo,
    result: AgentResult,
    *,
    is_byok: bool,
) -> None:
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
            turn_key="turn-1",
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
    dispatcher = SettlementOutboxDispatcher(
        SettlementInputs(
            usage_repo=repo,
            anon_quota_repo=None,
            request_audit_repo=None,
            messages_repo=None,
            prices=PRICED_TOKENS,
        )
    )
    await TurnOutbox(store=outbox).drain(dispatcher)


async def _run_pipeline(
    api: RuntimeAPI,
    outbox: MemoryOutbox,
    repo: UsageRepo,
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
    await _settle_and_drain(api, outbox, repo, result, is_byok=is_byok)


async def _translated_text(
    text: str,
    *,
    target_locale: str,
    ctx: TranslationContext | None = None,
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
    *,
    title_translator: TitleTranslator | None = None,
    **kwargs: object,
) -> AgentResult:
    del kwargs
    assert title_translator is not None
    await title_translator("タイトル", "en")
    return _result("already English")
