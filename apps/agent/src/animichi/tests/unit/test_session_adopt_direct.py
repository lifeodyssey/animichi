"""Direct-call route tests for /v1/sessions/adopt (SESSION-2 #960).

Exercises `_reject_client_session_id` and `handle_adopt_sessions` by calling
them directly (no HTTP layer), so the body-parse and handler-body branches are
covered deterministically — independent of ASGI transport behavior.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException
from starlette.requests import Request

from animichi.application.adopt_sessions import AdoptionResult
from animichi.interfaces.routes._deps import TrustedAuthContext
from animichi.interfaces.routes.adopt_sessions import (
    _reject_client_session_id,
    handle_adopt_sessions,
)

_AUTH = TrustedAuthContext(user_id="user-1", user_type="authenticated")


def _request(
    body: bytes = b"",
    query: str = "",
    headers: dict[str, str] | None = None,
    body_read: list[bool] | None = None,
) -> Request:
    scope: dict[str, object] = {
        "type": "http",
        "method": "POST",
        "path": "/v1/sessions/adopt",
        "raw_path": b"/v1/sessions/adopt",
        "query_string": query.encode(),
        "headers": [],
        "scheme": "http",
        "server": ("test", 80),
        "client": ("127.0.0.1", 1234),
        "app": MagicMock(),
    }
    all_headers = {"x-user-id": "user-1", "x-user-type": "authenticated"}
    if headers:
        all_headers.update(headers)
    header_list: list[tuple[bytes, bytes]] = []
    for key, value in all_headers.items():
        header_list.append((key.lower().encode(), value.encode()))
    scope["headers"] = header_list

    sent = {"sent": False}

    async def receive() -> dict[str, object]:
        if body_read is not None:
            body_read.append(True)
        if not sent["sent"]:
            sent["sent"] = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    return Request(scope, receive)


async def test_empty_body_returns_without_reading_json() -> None:
    await _reject_client_session_id(_request())


async def test_query_session_id_is_rejected_directly() -> None:
    request = _request(query="session_id=abc")
    try:
        await _reject_client_session_id(request)
    except HTTPException as error:
        assert error.status_code == 400
    else:
        raise AssertionError("expected HTTPException")


async def test_header_session_id_is_rejected_directly() -> None:
    request = _request(headers={"X-Session-Id": "abc"})
    try:
        await _reject_client_session_id(request)
    except HTTPException as error:
        assert error.status_code == 400
    else:
        raise AssertionError("expected HTTPException")


async def test_invalid_json_body_is_rejected_directly() -> None:
    request = _request(body=b"not-json")
    try:
        await _reject_client_session_id(request)
    except HTTPException as error:
        assert error.status_code == 400
    else:
        raise AssertionError("expected HTTPException")


async def test_json_body_with_session_id_is_rejected_directly() -> None:
    request = _request(body=b'{"session_id": "abc"}')
    try:
        await _reject_client_session_id(request)
    except HTTPException as error:
        assert error.status_code == 400
    else:
        raise AssertionError("expected HTTPException")


async def test_json_body_without_session_id_passes_directly() -> None:
    await _reject_client_session_id(_request(body=b'{"locale": "ja"}'))


async def test_oversized_content_length_is_rejected_413_before_reading_body() -> None:
    body_read: list[bool] = []
    request = _request(
        body=b"{}",
        headers={"content-length": "99999999999"},
        body_read=body_read,
    )
    try:
        await _reject_client_session_id(request)
    except HTTPException as error:
        assert error.status_code == 413
    else:
        raise AssertionError("expected HTTPException")
    assert body_read == []


async def test_oversized_body_without_content_length_is_rejected_413() -> None:
    request = _request(body=b"x" * 2048)
    try:
        await _reject_client_session_id(request)
    except HTTPException as error:
        assert error.status_code == 413
    else:
        raise AssertionError("expected HTTPException")


async def test_handler_runs_the_full_adoption_body_directly() -> None:
    from animichi.infrastructure.persistence.repositories.composite import (
        PersistenceRepos,
    )

    db = PersistenceRepos(
        sessionmaker=MagicMock(),
        session=MagicMock(),
        turn_reservation=MagicMock(),
        bangumi=MagicMock(),
        points=MagicMock(),
        usage=MagicMock(),
        anon_quota=MagicMock(),
        feedback=MagicMock(),
        memory=MagicMock(),
    )
    db.session.adopt_ownership = AsyncMock(
        return_value=AdoptionResult(adopted_count=1, revisions_bumped=1)
    )
    request = _request()
    request.app.state.db_client = db
    # Mirrors the real lifespan (#994): with an injected db the attribute is
    # explicitly None, so the route falls back to the db-client locator.
    request.app.state.session_repo = None

    resp = await handle_adopt_sessions(
        request, auth=_AUTH, from_anon_id="anon_" + "a" * 32
    )

    assert resp.status_code == 200
    body = resp.body
    assert isinstance(body, bytes)
    assert '"adopted":1' in body.decode()
    db.session.adopt_ownership.assert_awaited_once_with("anon_" + "a" * 32, "user-1")
