"""Unit tests for RuntimeAPI branch coverage (public_api).

Covers the moved helpers and the selection/translation branches of the
public API surface that the happy-path pipeline tests do not reach:
origin injection into an existing context, candidate-selection dispatch,
the server title-translator's platform usage banking, the translation
gate's no-op and error paths, and the span-attr guard.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from unittest.mock import AsyncMock, MagicMock, patch

from structlog import testing

from animichi.agents.agent_result import AgentResult, AttributedUsage
from animichi.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    SessionState,
)
from animichi.agents.translation import TranslationContext, TranslationResult
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.public_api import (
    PublicAPIRequest,
    RuntimeAPI,
    _apply_translation_gate,
    _set_span_request_attrs,
)
from animichi.tests.unit.conftest_public_api import make_result as _make_result


def _candidate_request(*, clarification_id: int, ids: list[str]) -> PublicAPIRequest:
    return PublicAPIRequest(
        text="", selected_candidate_ids=ids, clarification_id=clarification_id
    )


def _clarification_context(
    *, reason: str, ids: list[str], revision: int
) -> dict[str, object]:
    pending = PendingClarification(
        reason=reason,
        candidate_ids=ids,
        ordered_candidates=[OrderedCandidate(id=item, title=item) for item in ids],
        revision=revision,
    )
    state = SessionState(pending_clarification=pending, clarification_revision=revision)
    return {"session_state_v2": state.model_dump(mode="json")}


def _fake_translate_title(
    *,
    bank: bool = False,
) -> Callable[..., Awaitable[TranslationResult]]:
    async def fake(
        title: str,
        *,
        target_locale: str,
        kind: object,
        catalog: object,
        ctx: TranslationContext,
    ) -> TranslationResult:
        del target_locale, kind, catalog
        if bank:
            ctx.usage.requests = 1
        return TranslationResult(original=title, translated=title, source="catalog")

    return fake


async def _run_gate(result: AgentResult, locale: str) -> None:
    await _apply_translation_gate(
        result, locale, None, model=None, isolate_platform_usage=False
    )


async def test_load_session_adds_origin_to_existing_context() -> None:
    store = InMemorySessionStore()
    await store.set("s1", {"session_state_v2": SessionState().model_dump(mode="json")})
    api = RuntimeAPI(MagicMock(), session_store=store, model_http_client=MagicMock())

    _previous, context, _history = await api._load_session(
        "s1", PublicAPIRequest(text="x", origin_lat=34.9, origin_lng=135.8)
    )

    assert isinstance(context, dict)
    assert context["origin_lat"] == 34.9
    assert context["origin_lng"] == 135.8


async def test_dispatch_request_candidate_branch() -> None:
    api = RuntimeAPI(MagicMock(), model_http_client=MagicMock())
    result = _make_result(intent="plan_selected")

    with patch.object(api, "_candidate_selection", new=AsyncMock(return_value=result)):
        dispatched = await api._dispatch_request(
            _candidate_request(clarification_id=1, ids=["485"]), None, [], None, None
        )

    assert dispatched == (result, None, False)


async def test_candidate_selection_routes_anime_ambiguity_to_multi() -> None:
    api = RuntimeAPI(MagicMock(), model_http_client=MagicMock())
    result = _make_result(intent="plan_multi")

    with patch(
        "animichi.interfaces.public_api.execute_multi_selection",
        new=AsyncMock(return_value=result),
    ) as multi:
        got = await api._candidate_selection(
            _candidate_request(clarification_id=1, ids=["485"]),
            _clarification_context(reason="anime_ambiguity", ids=["485"], revision=1),
            None,
        )

    assert got is result
    multi.assert_awaited_once()


async def test_candidate_selection_routes_place_ambiguity_to_place() -> None:
    api = RuntimeAPI(MagicMock(), model_http_client=MagicMock())
    result = _make_result(intent="plan_selected")

    with patch(
        "animichi.interfaces.public_api.execute_place_selection",
        new=AsyncMock(return_value=result),
    ) as place:
        got = await api._candidate_selection(
            _candidate_request(clarification_id=2, ids=["uji"]),
            _clarification_context(reason="place_ambiguity", ids=["uji"], revision=2),
            None,
        )

    assert got is result
    place.assert_awaited_once()


async def test_server_title_translator_banks_platform_usage() -> None:
    api = RuntimeAPI(MagicMock(), model_http_client=MagicMock())
    supplemental: list[AttributedUsage] = []

    with patch(
        "animichi.interfaces.public_api.translate_title",
        side_effect=_fake_translate_title(bank=True),
    ):
        translated = await api._server_title_translator(supplemental)("君の名は", "zh")

    assert translated.translated == "君の名は"
    assert len(supplemental) == 1
    assert supplemental[0].payer == "platform"


async def test_server_title_translator_skips_zero_usage() -> None:
    api = RuntimeAPI(MagicMock(), model_http_client=MagicMock())
    supplemental: list[AttributedUsage] = []

    with patch(
        "animichi.interfaces.public_api.translate_title",
        side_effect=_fake_translate_title(),
    ):
        await api._server_title_translator(supplemental)("君の名は", "zh")

    assert supplemental == []


async def test_translation_gate_skips_empty_message() -> None:
    with patch(
        "animichi.interfaces.public_api.translate_text",
        new=AsyncMock(side_effect=AssertionError("must not translate empty text")),
    ):
        await _run_gate(_make_result(message=""), "ja")


async def test_translation_gate_logs_error_when_translate_fails() -> None:
    async def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("translate down")

    with (
        patch("animichi.interfaces.public_api.translate_text", side_effect=boom),
        testing.capture_logs() as captured,
    ):
        await _run_gate(_make_result(message="こんにちは", locale="ja"), "zh")

    assert any(e.get("event") == "translation_gate_failed" for e in captured)


def test_set_span_request_attrs_skips_span_without_set_attribute() -> None:
    _set_span_request_attrs(object(), None, PublicAPIRequest(text="x"), None, None)
