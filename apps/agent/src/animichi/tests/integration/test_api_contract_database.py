"""The contract client's database dependency, and how it fails.

An unreachable database must surface as a 500 rather than a silent success, and
the client must refuse to build without the ``tc_db`` aggregate at all — that
refusal is what keeps every other ``test_api_contract_*`` file from quietly
testing against a mock. The lifecycle and client live in
``_api_contract_client.py``.
"""

from __future__ import annotations

import httpx
import pytest

from animichi.infrastructure.persistence.database import create_database_lifecycle
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.tests.integration._api_contract_client import (
    contract_app,
    contract_client,
)


class TestDBConnectionFailure:
    """Verify that a broken DB connection raises a clear fixture error."""

    async def test_contract_client_without_db_raises(self) -> None:
        with pytest.raises(RuntimeError, match="tc_db fixture required"):
            contract_client(db=None)

    async def test_unreachable_database_surfaces_error(self) -> None:
        """An aggregate over an unreachable database fails on DB operations."""
        lifecycle = create_database_lifecycle("postgresql://localhost:1/nonexistent")
        bad_client = PersistenceRepos.build(lifecycle.sessionmaker)
        app = contract_app(db=bad_client)
        # raise_app_exceptions=False lets FastAPI's exception handler
        # return the 500 response instead of re-raising in the test.
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://test"
        ) as client:
            resp = await client.get(
                "/v1/conversations/sess-unknown/messages",
                headers={"X-User-Id": "user-1"},
            )
        # Should get a 500 error, not a silent success
        assert resp.status_code == 500
