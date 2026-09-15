"""The health endpoint's HTTP contract.

The container's own ``GET /healthz`` still answers the generated
``ServiceMetadata``: the edge (#1596) answers *its* origin's readiness probe
itself, but the operation stays published on the container, so its shape is
pinned here. The client is built over the real test-container aggregate in
``_api_contract_client.py``.
"""

from __future__ import annotations

from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.tests.integration._api_contract_client import contract_client


class TestHealthz:
    async def test_returns_200(self, tc_db: PersistenceRepos) -> None:
        async with contract_client(db=tc_db) as client:
            resp = await client.get("/healthz")
        assert resp.status_code == 200

    async def test_response_has_required_keys(self, tc_db: PersistenceRepos) -> None:
        async with contract_client(db=tc_db) as client:
            body = (await client.get("/healthz")).json()
        assert "status" in body
        assert "service" in body
        assert isinstance(body["status"], str)
        assert isinstance(body["service"], str)

    async def test_response_includes_optional_diagnostics(
        self, tc_db: PersistenceRepos
    ) -> None:
        async with contract_client(db=tc_db) as client:
            body = (await client.get("/healthz")).json()
        for key in ("app_env", "observability_enabled", "db_adapter", "session_store"):
            assert key in body
