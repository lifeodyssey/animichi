"""Selection and BYOK translation turn branches (TURN-4 #955 coverage loop).

Pins the deterministic place-selection candidate turn (the else branch of
the selection oracle) and the zero-usage BYOK title translator path that
must never be billed to the caller.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from animichi.agents.agent_result import AttributedUsage
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.tests.eval.mock_catalog_client import MockCatalogClient


def _db() -> MagicMock:
    db = MagicMock()
    db.session = AsyncMock()
    db.usage = AsyncMock()
    return db


async def test_place_ambiguity_selection_runs_the_place_selection_turn() -> None:
    from animichi.agents.session_state import (
        OrderedCandidate,
        PendingClarification,
        SessionState,
    )

    pending = PendingClarification(
        reason="place_ambiguity",
        candidate_ids=["p1"],
        ordered_candidates=[
            OrderedCandidate(id="p1", title="Uji", lat=34.886, lng=135.805)
        ],
        revision=5,
    )
    store = InMemorySessionStore()
    await store.set(
        "s-1",
        {
            "session_state_v2": SessionState(
                pending_clarification=pending, clarification_revision=5
            ).model_dump(mode="json")
        },
    )
    catalog = MockCatalogClient()
    api = RuntimeAPI(
        MagicMock(),
        session_store=store,
        catalog=catalog,
        model_http_client=MagicMock(),
    )

    response = await api.handle(
        PublicAPIRequest(
            text="",
            session_id="s-1",
            selected_candidate_ids=["p1"],
            clarification_id=5,
        )
    )

    assert response.success is True
    assert response.intent == "search_nearby"
    assert ("nearby", (34.886, 135.805, 5000)) in catalog.calls


async def test_byok_title_translator_with_zero_usage_is_not_billed() -> None:
    from animichi.agents.translation import TranslationResult

    api = RuntimeAPI(_db(), model_http_client=MagicMock())
    supplemental: list[AttributedUsage] = []
    translator = api._server_title_translator(supplemental)

    async def _no_usage_translate_title(
        title: str,
        *,
        target_locale: str,
        kind: str,
        catalog: object,
        ctx: object | None = None,
    ) -> TranslationResult:
        del target_locale, kind, catalog, ctx
        return TranslationResult(title, "Title", "llm")

    with patch(
        "animichi.interfaces.public_api.translate_title",
        new=AsyncMock(side_effect=_no_usage_translate_title),
    ):
        result = await translator("タイトル", "en")

    assert supplemental == []
    assert result.translated == "Title"
