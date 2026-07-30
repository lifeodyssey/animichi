"""D18 boundary regression: helper calls use the server key, never BYOK (#284 T3).

`translate_anime_title` (via `RuntimeDeps.title_translator`) and the post-turn
translation gate both have an optional per-call model override that, absent
this override, would otherwise inherit the *active run's* model — the user's
own BYOK credential when one is active. `RuntimeAPI` must inject a
server-locked `title_translator` and pass `model=None` to the translation
gate on every BYOK turn, so neither helper is ever billed to the caller's key
— and, symmetrically, a non-BYOK turn must NOT gain this override (it would
silently change today's cost/connection-reuse behaviour for every ordinary
turn).
"""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, patch

import pytest
from pydantic_ai.models import Model

from agent.agents.base import resolve_model
from agent.agents.translation import TranslationResult, translation_agent
from agent.clients.catalog_client import CatalogClientProtocol
from agent.interfaces.public_api import RuntimeAPI

pytestmark = pytest.mark.integration


def _api() -> RuntimeAPI:
    return RuntimeAPI(
        object(),
        catalog=cast(CatalogClientProtocol, object()),
        model_http_client=cast(object, object()),  # unused by the methods under test
    )


async def test_byok_turn_injects_a_server_locked_title_translator() -> None:
    """`_model_request` must pass a `title_translator` on a BYOK turn."""
    api = _api()
    with patch(
        "agent.interfaces.public_api.run_animichi_agent", new=AsyncMock()
    ) as run_mock:
        await api._model_request(
            _request(), None, [], cast(Model, object()), None, None, is_byok=True
        )
    assert run_mock.await_args.kwargs["title_translator"] is not None


async def test_non_byok_turn_leaves_title_translator_untouched() -> None:
    """A plain turn keeps today's behaviour: no override injected."""
    api = _api()
    with patch(
        "agent.interfaces.public_api.run_animichi_agent", new=AsyncMock()
    ) as run_mock:
        await api._model_request(
            _request(), None, [], cast(Model, object()), None, None, is_byok=False
        )
    assert run_mock.await_args.kwargs["title_translator"] is None


async def test_injected_title_translator_runs_on_the_server_model() -> None:
    """The injected callable must not spend the user's BYOK key on our own
    internal translation — it runs on `translation_agent`'s server default.

    This used to be asserted as `ctx is None`, because passing no context was
    how the server default got selected. That proxy was also why the platform
    spend went unrecorded: `_translation_run_scope(None)` minted a `RunUsage`
    nobody held. The context is now supplied *with* the server model and an
    owned usage sink, so the assertion moved to the property that was always
    the point — which model runs — rather than the mechanism that happened to
    select it.
    """
    api = _api()
    translator = api._server_title_translator([])
    fake_result = TranslationResult(
        original="タイトル", translated="Title", source="llm"
    )
    with patch(
        "agent.interfaces.public_api.translate_title",
        new=AsyncMock(return_value=fake_result),
    ) as translate_mock:
        result = await translator("タイトル", "en")
    assert result is fake_result
    ctx = translate_mock.await_args.kwargs["ctx"]
    assert ctx is not None
    assert ctx.model is resolve_model(translation_agent.model)


async def test_byok_turn_forces_the_translation_gate_off_the_run_model() -> None:
    """`_apply_translation_gate` must receive `model=None` on a BYOK turn so
    `_translation_context` falls back to the server default, never the
    resolved (BYOK) model."""
    from agent.interfaces.public_api import _apply_translation_gate

    with patch(
        "agent.interfaces.public_api._apply_translation_gate", new=AsyncMock()
    ) as gate_mock:
        gate_mock.side_effect = _apply_translation_gate
        api = _api()
        with (
            patch.object(
                api, "_dispatch_request", new=AsyncMock(side_effect=_dispatch_stub)
            ),
        ):
            await api._execute_pipeline(
                _request(),
                None,
                [],
                cast(Model, object()),
                None,
                object(),
                None,
                is_byok=True,
            )
    assert gate_mock.await_args.kwargs["model"] is None


def _request() -> object:
    from agent.interfaces.schemas import PublicAPIRequest

    return PublicAPIRequest(text="hello")


async def _dispatch_stub(*_args: object, **_kwargs: object) -> object:
    from agent.tests.unit.conftest_public_api import make_result

    result = make_result(intent="qa", message="hello there")
    return result, cast(Model, object()), True
