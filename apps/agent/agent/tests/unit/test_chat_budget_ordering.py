"""The anonymous chat breakers reject before request-body work."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from fastapi.responses import JSONResponse
from starlette.requests import Request
from starlette.types import Message, Receive

from agent.interfaces.routes import chat
from agent.interfaces.routes._deps import TrustedAuthContext


def _request(receive: Receive) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/v1/chat",
        "headers": [],
        "query_string": b"",
        "server": ("test", 443),
        "scheme": "https",
    }
    return Request(scope, receive=receive)


async def _body_read() -> Message:
    raise AssertionError("the body must not be read after budget rejection")


async def test_budget_rejection_precedes_body_read_and_session_validation(
    monkeypatch,
) -> None:
    request = _request(_body_read)
    rejection = JSONResponse(status_code=403, content={"error": "budget"})
    monkeypatch.setattr(chat, "_budget_rejection", AsyncMock(return_value=rejection))
    monkeypatch.setattr(chat, "_quota_rejection", AsyncMock())
    monkeypatch.setattr(chat, "_get_runtime_api", MagicMock())

    result = await chat.handle_chat(
        request,
        TrustedAuthContext("anon_0123456789abcdef0123456789abcdef", "anonymous"),
    )

    assert result is rejection
