"""SubmitFeedback — Agent-owned feedback submission use case (AGENT-3 #962).

``POST /v1/feedback`` publishes this use case through the generated
``SubmitFeedbackRequest`` / ``SubmitFeedbackResult`` boundary models. The use
case is the validation authority (blank ``query_text`` is rejected here, not
at parse time — the wire schema is the shape contract only), the optional
Session-ownership authority (a ``session_id`` on the wire always requires a
trusted identity and an owned Session; a Session that does not exist and one
owned by another user collapse to the identical ``forbidden`` refusal, so
submission never leaks whether a Session exists), and the persistence
authority (the store's failure is wrapped into one stable typed error, so no
partial state escapes as a raw infrastructure exception). No actor identifier,
Session identifier, or feedback text is ever recorded — the route owns the
rating/ownership/outcome/duration telemetry.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from animichi.interfaces.boundary.agent_models import (
    SubmitFeedbackRequest,
    SubmitFeedbackResult,
)

FeedbackRejectionCode = Literal[
    "authentication_error",
    "forbidden",
    "invalid_request",
    "internal_error",
]


@dataclass(frozen=True)
class FeedbackRejection(Exception):
    """A typed feedback refusal, mapped to the service error envelope.

    ``forbidden`` is the collapse point: a missing Session and another user's
    Session produce the identical public response.
    """

    status_code: int
    code: FeedbackRejectionCode
    message: str


class FeedbackStore(Protocol):
    """Write port over the feedback repository (INSERT INTO feedback …)."""

    async def save_feedback(
        self,
        session_id: str | None,
        query_text: str,
        intent: str | None,
        rating: str,
        comment: str | None = None,
    ) -> str: ...


class SessionOwnershipPort(Protocol):
    """Read port over the final Session aggregate repository (SESSION-3 #961)."""

    async def check_session_owner(self, session_id: str, user_id: str) -> bool: ...


def _validate_query_text(query_text: str) -> str:
    text = query_text.strip()
    if not text:
        raise FeedbackRejection(
            status_code=422,
            code="invalid_request",
            message="query_text must be a non-empty string.",
        )
    return text


async def submit_feedback(
    store: FeedbackStore,
    session_owner: SessionOwnershipPort,
    *,
    request: SubmitFeedbackRequest,
    user_id: str | None,
) -> SubmitFeedbackResult:
    """Validate, optionally enforce Session ownership, and persist one feedback."""
    query_text = _validate_query_text(request.query_text)
    if request.session_id is not None:
        if user_id is None:
            raise FeedbackRejection(
                status_code=401,
                code="authentication_error",
                message="Authentication required for session feedback.",
            )
        owns = await session_owner.check_session_owner(request.session_id, user_id)
        if not owns:
            raise FeedbackRejection(
                status_code=403,
                code="forbidden",
                message=(
                    "You do not have permission to submit feedback for this session."
                ),
            )
    try:
        feedback_id = await store.save_feedback(
            request.session_id,
            query_text,
            request.intent,
            request.rating,
            request.comment,
        )
    except Exception as exc:
        raise FeedbackRejection(
            status_code=500,
            code="internal_error",
            message="Feedback could not be saved.",
        ) from exc
    return SubmitFeedbackResult(feedback_id=feedback_id)
