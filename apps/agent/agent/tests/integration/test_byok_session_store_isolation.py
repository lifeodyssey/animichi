"""AC9's session-store half, made falsifiable with a real store (Fable P2-3).

`test_byok_chat_routing.py::test_byok_credential_never_reaches_app_state`
uses a `MagicMock(spec=RuntimeAPI)` for the route-level assertion — but a
mocked runtime never touches persistence at all, so "no credential in the
session store" was true there by construction, not by anything this suite
actually exercised. This file runs a real `RuntimeAPI` with a real,
fully-built `ByokModel` (not a message-embedded stand-in) against a real
`InMemorySessionStore`, and inspects its internal state after the turn.
"""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

from agent.agents.byok_models import ByokCredential, build_byok_model
from agent.clients.catalog_client import CatalogClientProtocol
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from agent.tests.unit.conftest_public_api import make_result

_FAKE_KEY = "sk-fake-secret-value-must-never-persist"


async def test_byok_key_never_lands_in_the_session_store() -> None:
    """A real session store, a real constructed `ByokModel`, one real
    `RuntimeAPI.handle` turn — the fake key must not appear anywhere in the
    store's internal state afterward."""
    credential = ByokCredential(
        provider="anthropic", key=_FAKE_KEY, model="claude-test"
    )
    byok_model = await build_byok_model(credential)
    session_store = InMemorySessionStore()
    db = MagicMock()
    db.session = AsyncMock()
    api = RuntimeAPI(
        db,
        catalog=cast(CatalogClientProtocol, object()),
        session_store=session_store,
        model_http_client=AsyncMock(),
    )
    result = make_result(intent="qa", message="hello there")
    try:
        with patch(
            "agent.interfaces.public_api.run_animichi_agent",
            new=AsyncMock(return_value=result),
        ):
            await api.handle(
                PublicAPIRequest(text="hello"),
                model=byok_model.model,
                is_byok=True,
                user_id="user-1",
                user_type="human",
            )
    finally:
        await byok_model.client.aclose()

    store_repr = repr(session_store._sessions) + repr(session_store._metadata)
    assert _FAKE_KEY not in store_repr
