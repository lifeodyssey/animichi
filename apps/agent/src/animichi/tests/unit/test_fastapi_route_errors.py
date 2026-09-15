"""The FastAPI adapter's request-side guards, at the route seam.

Every route resolves its persistence aggregate through ``_require_db`` and every
identity-bearing route rejects a caller who names no user; a route that fell
through either guard would answer a bare 500 or leak another user's session.
These cases drive ``create_fastapi_app`` through its real lifespan, with
``RuntimeAPI`` mocked so only the HTTP contract is exercised. The adapter's
error-code mapping and its startup/shutdown behaviour are pinned separately in
``test_fastapi_error_mapping.py`` and ``test_fastapi_lifecycle.py``.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from animichi.config.settings import Settings
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.infrastructure.persistence.repositories.session import SessionRecord
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.fastapi_service import create_fastapi_app
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes._deps import _require_db
from animichi.tests.unit.conftest_fastapi import build_stub_db


@pytest.fixture
def mock_db() -> PersistenceRepos:
    """A genuine aggregate over mock sub-repositories (routes resolve it by type)."""
    return build_stub_db()


def _app_with_db(db: PersistenceRepos):
    return create_fastapi_app(
        runtime_api=RuntimeAPI(
            db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ),
        settings=Settings(),
    )


def test_missing_user_header_returns_structured_invalid_request_error_on_conversations(
    mock_db: PersistenceRepos,
) -> None:
    with TestClient(_app_with_db(mock_db)) as client:
        response = client.get("/v1/conversations")

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "invalid_request"
    assert body["error"]["message"] == "X-User-Id header required."


def test_messages_route_returns_structured_404_when_ownership_mismatch(
    mock_db: PersistenceRepos,
) -> None:
    mock_db.session.load.return_value = SessionRecord(
        session_id="sess-1", user_id="someone-else"
    )

    with TestClient(_app_with_db(mock_db)) as client:
        response = client.get(
            "/v1/conversations/sess-1/messages",
            headers={"X-User-Id": "user-1"},
        )

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "not_found"


def test_require_db_returns_aggregate_when_valid() -> None:
    db = build_stub_db()
    assert _require_db(db) is db


def test_require_db_raises_500_when_not_an_aggregate() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _require_db(object())
    assert exc_info.value.status_code == 500
    assert "Database client not available" in exc_info.value.detail
