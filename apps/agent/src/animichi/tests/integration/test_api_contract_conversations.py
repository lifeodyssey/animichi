"""The conversation endpoints' HTTP contract.

One owned session's message page answers 200, and both another user's session
and a missing one collapse to 404; the seeding and cleanup these assertions
need comes from ``_api_contract_client.py``. The health endpoint is pinned in
``test_api_contract_health.py``, and the shared error envelope — including the
missing-identity 400 — in ``test_api_contract_error_shape.py``.
"""

from __future__ import annotations

from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.tests.integration._api_contract_client import (
    cleanup_test_data,
    contract_client,
    seed_conversation,
    seed_message,
)


class TestConversationMessages:
    async def test_returns_200_with_messages_key(self, tc_db: PersistenceRepos) -> None:
        await seed_conversation(tc_db, "sess-msg-1", "user-1")
        await seed_message(tc_db, "sess-msg-1", role="user", content="hi")
        try:
            async with contract_client(db=tc_db) as client:
                resp = await client.get(
                    "/v1/conversations/sess-msg-1/messages",
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert "messages" in body
            assert isinstance(body["messages"], list)
        finally:
            await cleanup_test_data(tc_db)

    async def test_ownership_mismatch_returns_404(
        self, tc_db: PersistenceRepos
    ) -> None:
        await seed_conversation(tc_db, "sess-owned", "other-user")
        try:
            async with contract_client(db=tc_db) as client:
                resp = await client.get(
                    "/v1/conversations/sess-owned/messages",
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 404
            body = resp.json()
            assert body["error"]["code"] == "not_found"
        finally:
            await cleanup_test_data(tc_db)

    async def test_missing_conversation_returns_404(
        self, tc_db: PersistenceRepos
    ) -> None:
        async with contract_client(db=tc_db) as client:
            resp = await client.get(
                "/v1/conversations/sess-nonexistent/messages",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 404
