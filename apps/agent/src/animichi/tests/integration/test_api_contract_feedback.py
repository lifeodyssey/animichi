"""The feedback endpoint's HTTP contract.

Feedback is the one anonymous write in the contract, so its cases pin the
success shape and each rejection the validator owns — blank query text, an
unknown rating, and a body that is not JSON at all. The client and the
row cleanup come from ``_api_contract_client.py``.
"""

from __future__ import annotations

from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.tests.integration._api_contract_client import (
    cleanup_test_data,
    contract_client,
)


class TestFeedback:
    async def test_returns_200_with_feedback_id(self, tc_db: PersistenceRepos) -> None:
        try:
            async with contract_client(db=tc_db) as client:
                resp = await client.post(
                    "/v1/feedback",
                    json={"rating": "good", "query_text": "京吹"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert "feedback_id" in body
            assert isinstance(body["feedback_id"], str)
        finally:
            await cleanup_test_data(tc_db)

    async def test_blank_query_text_returns_422(self, tc_db: PersistenceRepos) -> None:
        async with contract_client(db=tc_db) as client:
            resp = await client.post(
                "/v1/feedback",
                json={"rating": "good", "query_text": "  "},
            )
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"]["code"] == "invalid_request"

    async def test_invalid_rating_returns_422(self, tc_db: PersistenceRepos) -> None:
        async with contract_client(db=tc_db) as client:
            resp = await client.post(
                "/v1/feedback",
                json={"rating": "amazing", "query_text": "test"},
            )
        assert resp.status_code == 422

    async def test_invalid_json_returns_400(self, tc_db: PersistenceRepos) -> None:
        async with contract_client(db=tc_db) as client:
            resp = await client.post(
                "/v1/feedback",
                content=b"not json!",
                headers={"Content-Type": "application/json"},
            )
        assert resp.status_code == 400
        body = resp.json()
        assert body["error"]["code"] == "invalid_json"
