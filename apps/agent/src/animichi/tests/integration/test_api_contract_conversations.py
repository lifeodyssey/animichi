"""The conversation endpoints' HTTP contract.

List, messages and rename share one identity rule — a missing ``X-User-Id`` is a
400, another user's session is a 404 — so their shape assertions live together;
the seeding and cleanup they need comes from ``_api_contract_client.py``. The
health endpoint is pinned in ``test_api_contract_health.py``, and the shared
error envelope in ``test_api_contract_error_shape.py``.
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


class TestConversations:
    async def test_returns_200_list(self, tc_db: PersistenceRepos) -> None:
        async with contract_client(db=tc_db) as client:
            resp = await client.get(
                "/v1/conversations",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)

    async def test_missing_user_header_returns_400_error_shape(
        self, tc_db: PersistenceRepos
    ) -> None:
        async with contract_client(db=tc_db) as client:
            resp = await client.get("/v1/conversations")
        assert resp.status_code == 400
        body = resp.json()
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]


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


class TestConversationPatch:
    async def test_returns_200_on_success(self, tc_db: PersistenceRepos) -> None:
        await seed_conversation(tc_db, "sess-patch-1", "user-1")
        try:
            async with contract_client(db=tc_db) as client:
                resp = await client.patch(
                    "/v1/conversations/sess-patch-1",
                    json={"title": "New title"},
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert "ok" in body
        finally:
            await cleanup_test_data(tc_db)

    async def test_blank_title_returns_422(self, tc_db: PersistenceRepos) -> None:
        await seed_conversation(tc_db, "sess-patch-2", "user-1")
        try:
            async with contract_client(db=tc_db) as client:
                resp = await client.patch(
                    "/v1/conversations/sess-patch-2",
                    json={"title": "   "},
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 422
        finally:
            await cleanup_test_data(tc_db)

    async def test_missing_user_header_returns_400(
        self, tc_db: PersistenceRepos
    ) -> None:
        async with contract_client(db=tc_db) as client:
            resp = await client.patch(
                "/v1/conversations/sess-patch-3",
                json={"title": "hello"},
            )
        assert resp.status_code == 400
