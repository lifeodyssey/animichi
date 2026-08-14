"""Unit tests for the runtime settlement request-audit failure paths.

The consolidated ``SettlementApplier._apply_audit`` swallows repository
failures best-effort: a failed user-message persistence logs
``finally_persist_user_msg_failed`` and a failed audit-log insert logs
``request_log_failed`` without raising (AC5 drain path).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from structlog import testing

from animichi.application.outbox_payload import SettlementPayload
from animichi.interfaces.outbox_dispatch import SettlementApplier, SettlementInputs
from animichi.interfaces.usage_metering import UsagePrices

ANON_ID = "anon_0123456789abcdef0123456789abcdef"


def _db() -> MagicMock:
    db = MagicMock()
    db.usage = AsyncMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=1)
    db.feedback = MagicMock()
    db.feedback.insert_request_log = AsyncMock(return_value=None)
    db.session = AsyncMock()
    return db


def _payload(*, persisted: bool) -> SettlementPayload:
    return SettlementPayload(
        session_id="s1",
        user_id=None,
        user_type=None,
        is_byok=False,
        settle_quota=False,
        elapsed_ms=1,
        intent="search",
        status="empty",
        request_text="hello",
        locale="ja",
        user_message_persisted=persisted,
    )


def _applier(db: MagicMock) -> SettlementApplier:
    return SettlementApplier(
        SettlementInputs(
            usage_repo=db.usage,
            anon_quota_repo=db.anon_quota,
            request_audit_repo=db.feedback,
            messages_repo=db.session,
            prices=UsagePrices(0.0, 0.0),
        )
    )


async def test_audit_warns_when_persist_user_message_fails() -> None:
    applier = _applier(_db())

    async def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("db down")

    from unittest.mock import patch

    with (
        patch("animichi.interfaces.persistence.persist_messages", side_effect=boom),
        testing.capture_logs() as captured,
    ):
        await applier.apply(_payload(persisted=False))

    assert any(e.get("event") == "finally_persist_user_msg_failed" for e in captured)


async def test_audit_warns_when_audit_insert_fails() -> None:
    db = _db()
    db.feedback.insert_request_log = AsyncMock(side_effect=RuntimeError("audit down"))
    with testing.capture_logs() as captured:
        await _applier(db).apply(_payload(persisted=True))

    assert any(e.get("event") == "request_log_failed" for e in captured)


async def test_dispatcher_applies_row_payload_and_marks_success() -> None:
    from animichi.application.outbox_port import OutboxRow
    from animichi.interfaces.outbox_dispatch import SettlementOutboxDispatcher

    db = _db()
    dispatcher = SettlementOutboxDispatcher(
        SettlementInputs(
            usage_repo=db.usage,
            anon_quota_repo=db.anon_quota,
            request_audit_repo=db.feedback,
            messages_repo=db.session,
            prices=UsagePrices(0.0, 0.0),
        )
    )
    payload = _payload(persisted=True)
    row = OutboxRow(
        id="r-1",
        session_id="s1",
        turn_key="turn-1",
        kind="audit",
        payload=payload.to_json(),
    )
    assert await dispatcher.apply(row) is True
    db.feedback.insert_request_log.assert_awaited_once()


async def test_dispatcher_rejects_a_malformed_payload() -> None:
    from animichi.application.outbox_port import OutboxRow
    from animichi.interfaces.outbox_dispatch import SettlementOutboxDispatcher

    db = _db()
    dispatcher = SettlementOutboxDispatcher(
        SettlementInputs(
            usage_repo=db.usage,
            anon_quota_repo=db.anon_quota,
            request_audit_repo=db.feedback,
            messages_repo=db.session,
            prices=UsagePrices(0.0, 0.0),
        )
    )
    row = OutboxRow(
        id="r-2",
        session_id="s1",
        turn_key="turn-2",
        kind="usage",
        payload={"usage": "not-a-list"},
    )
    assert await dispatcher.apply(row) is False


async def test_dispatcher_applies_only_the_row_kind_effect() -> None:
    from animichi.application.outbox_port import OutboxRow
    from animichi.interfaces.outbox_dispatch import SettlementOutboxDispatcher

    db = _db()
    dispatcher = SettlementOutboxDispatcher(
        SettlementInputs(
            usage_repo=db.usage,
            anon_quota_repo=db.anon_quota,
            request_audit_repo=db.feedback,
            messages_repo=db.session,
            prices=UsagePrices(0.0, 0.0),
        )
    )
    base = {
        "session_id": "s1",
        "user_id": ANON_ID,
        "user_type": "anonymous",
        "is_byok": False,
        "settle_quota": True,
        "elapsed_ms": 1,
        "intent": "search",
        "status": "empty",
        "request_text": "hello",
        "locale": "ja",
        "user_message_persisted": True,
        "usage": [
            {
                "payer": "platform",
                "requests": 1,
                "prompt_tokens": 1000,
                "completion_tokens": 500,
            }
        ],
        "plan_steps": None,
    }
    quota_row = OutboxRow(
        id="r-q", session_id="s1", turn_key="turn-3", kind="quota", payload=dict(base)
    )
    assert await dispatcher.apply(quota_row) is True
    db.anon_quota.increment_and_count.assert_awaited_once()
    db.feedback.insert_request_log.assert_not_awaited()

    usage_row = OutboxRow(
        id="r-u", session_id="s1", turn_key="turn-4", kind="usage", payload=dict(base)
    )
    assert await dispatcher.apply(usage_row) is True
    db.usage.accumulate_usage.assert_awaited_once()
