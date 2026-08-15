"""BYOK billing: zero cost stays zero; non-BYOK stays platform-priced (#532).

Under the durable outbox (#1014 AC5) settle enqueues the usage row and the
drain banks it once. A BYOK turn is metered at zero cost; a non-BYOK turn is
priced normally. The translation-fallback attribution lives in
``test_byok_translation_fallback_billing.py``.
"""

from __future__ import annotations

from unittest.mock import patch

from pydantic_ai.models.test import TestModel

from animichi.tests.unit.byok_billing_fakes import (
    UsageRepo,
    _api,
    _result,
    _run_pipeline,
)
from animichi.tests.unit.byok_translation_fakes import _translated_text


async def test_byok_without_translation_stays_zero_cost() -> None:
    repo = UsageRepo()
    result = _result("已经是中文")

    api, outbox = _api(repo)
    await _run_pipeline(api, outbox, repo, result, TestModel(), is_byok=True)

    assert [(call.scope, call.cost_usd) for call in repo.calls] == [("byok", 0.0)]


async def test_non_byok_translation_remains_platform_billed() -> None:
    repo = UsageRepo()
    result = _result("日本語の返答")

    with patch("animichi.interfaces.public_api.translate_text", new=_translated_text):
        api, outbox = _api(repo)
        await _run_pipeline(api, outbox, repo, result, TestModel(), is_byok=False)

    assert [(call.scope, call.cost_usd) for call in repo.calls] == [("user", 12.0)]
