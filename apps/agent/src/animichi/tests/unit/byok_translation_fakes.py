"""Translation-fallback stubs for BYOK billing tests (#532, #1014 AC5).

The platform post-turn translation simulators accumulate usage onto the shared
translation context so the drain banks the platform-attributed cost to the
user scope. Shared across the BYOK billing-attribute tests; not a test module.
"""

from __future__ import annotations

from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_deps import TitleTranslator
from animichi.agents.translation import TranslationContext, TranslationResult
from animichi.clients.catalog_client import CatalogClientProtocol
from animichi.tests.unit.byok_billing_fakes import _result


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
