"""SubmitFeedback seam tests (AGENT-3 #962).

The use case is the validation authority, the optional Session-ownership
authority, and the persistence authority: a blank ``query_text`` is refused
before any store call, a Session id on the wire always demands a trusted
identity and an owned Session, a missing Session and another user's Session
collapse to the identical ``forbidden`` refusal (existence is never leaked),
and a store failure surfaces as one stable typed error.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from animichi.application.submit_feedback import (
    FeedbackRejection,
    SubmitFeedbackRequest,
    submit_feedback,
)

_OWNED_SESSION = "sess-owned"
_MISSING_SESSION = "sess-missing"
_FOREIGN_SESSION = "sess-foreign"
_USER_ID = "user-1"


def _request(**overrides: object) -> SubmitFeedbackRequest:
    fields: dict[str, object] = {"query_text": "Great app!", "rating": "good"}
    fields.update(overrides)
    return SubmitFeedbackRequest(**fields)


def _owner(owns: bool) -> MagicMock:
    owner = MagicMock()
    owner.check_session_owner = AsyncMock(return_value=owns)
    return owner


def _store(feedback_id: str = "fb-001") -> MagicMock:
    store = MagicMock()
    store.save_feedback = AsyncMock(return_value=feedback_id)
    return store


async def test_owned_session_saves_feedback() -> None:
    result = await submit_feedback(
        _store(),
        _owner(True),
        request=_request(session_id=_OWNED_SESSION),
        user_id=_USER_ID,
    )
    assert result.feedback_id == "fb-001"


async def test_absent_session_saves_without_consulting_ownership() -> None:
    store = _store()
    owner = _owner(True)
    result = await submit_feedback(
        store,
        owner,
        request=_request(session_id=None),
        user_id=_USER_ID,
    )
    assert result.feedback_id == "fb-001"
    owner.check_session_owner.assert_not_awaited()


async def test_query_text_is_stripped_before_persistence() -> None:
    captured: list[object] = []

    async def capture(*args: object) -> str:
        captured.extend(args)
        return "fb-001"

    store = _store()
    store.save_feedback = AsyncMock(side_effect=capture)
    await submit_feedback(
        store,
        _owner(True),
        request=_request(session_id=_OWNED_SESSION, query_text="  hi  "),
        user_id=_USER_ID,
    )
    assert captured[1] == "hi"


async def test_forbidden_session_is_refused_before_persistence() -> None:
    store = _store()
    with pytest.raises(FeedbackRejection) as exc_info:
        await submit_feedback(
            store,
            _owner(False),
            request=_request(session_id=_FOREIGN_SESSION),
            user_id=_USER_ID,
        )
    assert exc_info.value.status_code == 403
    assert exc_info.value.code == "forbidden"
    store.save_feedback.assert_not_awaited()


async def test_missing_session_collapses_to_identical_forbidden() -> None:
    missing = await _rejection(session_id=_MISSING_SESSION)
    forbidden = await _rejection(session_id=_FOREIGN_SESSION)
    assert missing.status_code == forbidden.status_code
    assert missing.code == forbidden.code
    assert missing.message == forbidden.message


async def _rejection(*, session_id: str) -> FeedbackRejection:
    with pytest.raises(FeedbackRejection) as exc_info:
        await submit_feedback(
            _store(),
            _owner(False),
            request=_request(session_id=session_id),
            user_id=_USER_ID,
        )
    return exc_info.value


async def test_session_feedback_without_identity_is_refused() -> None:
    store = _store()
    with pytest.raises(FeedbackRejection) as exc_info:
        await submit_feedback(
            store,
            _owner(True),
            request=_request(session_id=_OWNED_SESSION),
            user_id=None,
        )
    assert exc_info.value.status_code == 401
    assert exc_info.value.code == "authentication_error"
    store.save_feedback.assert_not_awaited()


async def test_blank_query_text_is_rejected_before_any_store_call() -> None:
    store = _store()
    with pytest.raises(FeedbackRejection) as exc_info:
        await submit_feedback(
            store,
            _owner(True),
            request=_request(query_text="   "),
            user_id=None,
        )
    assert exc_info.value.status_code == 422
    assert exc_info.value.code == "invalid_request"
    store.save_feedback.assert_not_awaited()


async def test_persistence_failure_surfaces_one_stable_error() -> None:
    store = _store()
    store.save_feedback = AsyncMock(side_effect=RuntimeError("no row returned"))
    with pytest.raises(FeedbackRejection) as exc_info:
        await submit_feedback(
            store,
            _owner(True),
            request=_request(session_id=_OWNED_SESSION),
            user_id=_USER_ID,
        )
    assert exc_info.value.status_code == 500
    assert exc_info.value.code == "internal_error"
