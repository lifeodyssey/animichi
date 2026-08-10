"""Unit tests for RuntimeAPI request-log failure paths (public_api).

``_log_request`` swallows repository failures best-effort: a failed
user-message persistence logs ``finally_persist_user_msg_failed`` and a
failed audit-log insert logs ``request_log_failed`` without raising.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from structlog import testing

from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI


async def _log(api: RuntimeAPI, *, persisted: bool) -> None:
    await api._log_request(
        session_id="s1",
        request=PublicAPIRequest(text="hello"),
        result=None,
        response=None,
        elapsed_ms=1.0,
        intent="search",
        status="empty",
        user_message_persisted=persisted,
    )


async def test_log_request_warns_when_persist_user_message_fails() -> None:
    api = RuntimeAPI(MagicMock(), model_http_client=MagicMock())

    async def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("db down")

    with (
        patch("animichi.interfaces.public_api.persist_messages", side_effect=boom),
        testing.capture_logs() as captured,
    ):
        await _log(api, persisted=False)

    assert any(e.get("event") == "finally_persist_user_msg_failed" for e in captured)


async def test_log_request_warns_when_audit_insert_fails() -> None:
    db = MagicMock()
    db.feedback.insert_request_log = AsyncMock(side_effect=RuntimeError("audit down"))
    api = RuntimeAPI(db, model_http_client=MagicMock())

    with testing.capture_logs() as captured:
        await _log(api, persisted=True)

    assert any(e.get("event") == "request_log_failed" for e in captured)
