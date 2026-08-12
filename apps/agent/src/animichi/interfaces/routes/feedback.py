"""Feedback submission route (AGENT-3 #962).

``POST /v1/feedback`` publishes the SubmitFeedback use case through the
generated ``SubmitFeedbackRequest`` / ``SubmitFeedbackResult`` boundary
models. The route owns only the seam: identity from the trusted headers,
the use case invocation over the final Session and feedback stores, the
rejection-to-envelope mapping, and the rating/ownership/outcome/duration
telemetry. Validation, optional Session ownership (missing and forbidden
collapse), and persistence errors all belong to SubmitFeedback.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from animichi.infrastructure.observability.runtime import record_feedback_request
from animichi.interfaces.boundary.agent_models import (
    SubmitFeedbackRequest,
    SubmitFeedbackResult,
)
from animichi.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
    _get_db_from_request,
    _get_trusted_auth_context,
    _require_supabase,
)

router = APIRouter(prefix="/v1", tags=["feedback"])


@router.post("/feedback", response_model=SubmitFeedbackResult)
async def handle_feedback(
    payload: SubmitFeedbackRequest,
    request: Request,
    auth: Annotated[
        TrustedAuthContext, Depends(_get_trusted_auth_context)
    ] = TrustedAuthContext(user_id=None, user_type=None),
) -> JSONResponse | SubmitFeedbackResult:
    # Local import breaks the import cycle: the application module imports
    # `interfaces.boundary`, whose package `__init__` eagerly imports this
    # route — a module-level import would re-enter the application module
    # while it is still being imported (same pattern as `_deps._raw_byok_headers`).
    from animichi.application.submit_feedback import FeedbackRejection, submit_feedback

    db = _require_supabase(_get_db_from_request(request))
    started = time.monotonic()
    try:
        result = await submit_feedback(
            db.feedback,
            db.session,
            request=payload,
            user_id=auth.user_id,
        )
    except FeedbackRejection as rejection:
        record_feedback_request(
            duration_ms=(time.monotonic() - started) * 1000,
            rating_class=payload.rating,
            ownership=_ownership_class(payload.session_id),
            outcome=rejection.code,
        )
        return _error_response(
            rejection.code, rejection.message, status_code=rejection.status_code
        )
    record_feedback_request(
        duration_ms=(time.monotonic() - started) * 1000,
        rating_class=payload.rating,
        ownership=_ownership_class(payload.session_id),
        outcome="ok",
    )
    return result


def _ownership_class(session_id: str | None) -> str:
    return "session" if session_id is not None else "absent"
