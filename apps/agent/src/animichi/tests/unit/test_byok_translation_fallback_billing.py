"""BYOK platform translation fallback billing (#532, #1014 AC5).

Under the durable outbox settle enqueues the usage row; the drain banks each
usage item once. The translation fallback (platform-translated text / title)
is billed to the user scope while the caller-paid BYOK base stays at zero.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from pydantic_ai.models.test import TestModel

from animichi.application.agent_turn import TextTurn
from animichi.tests.unit.byok_billing_fakes import (
    UsageRepo,
    _api,
    _execution,
    _result,
    _run_pipeline,
    _settle_and_drain,
)
from animichi.tests.unit.byok_translation_fakes import (
    _run_with_title_translation,
    _translated_text,
    _translated_title,
)


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
        api, outbox = _api(repo)
        await _run_pipeline(api, outbox, repo, result, TestModel(), is_byok=True)

    assert translate.await_args.kwargs["ctx"].model is server_model
    assert [(call.scope, call.cost_usd) for call in repo.calls] == [
        ("byok", 0.0),
        ("user", 10.0),
    ]


async def test_byok_title_translation_platform_usage_is_billed_to_user_scope() -> None:
    repo = UsageRepo()
    api, outbox = _api(repo)
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
    await _settle_and_drain(api, outbox, repo, executed.output, is_byok=True)
    assert [(call.scope, call.cost_usd) for call in repo.calls] == [
        ("byok", 0.0),
        ("user", 10.0),
    ]
