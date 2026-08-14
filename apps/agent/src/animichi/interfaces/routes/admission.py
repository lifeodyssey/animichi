"""Route-level admission wiring (TURN-2 #949).

Both turn-taking boundaries (``/v1/chat`` and ``/v1/photo-search``) run the
same :class:`TurnAdmission` use case before any work. This module owns the
FastAPI-only concerns: resolving the store/repos/policy from request state,
reading the optional admission headers, and mapping a rejection verdict to the
wire envelope.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import cast
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse

from animichi.application.turn_admission import (
    AdmissionIdentity,
    AdmissionPolicy,
    AdmissionRequest,
    AdmissionVerdict,
    TurnAdmission,
)
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import TurnOutcomeStore
from animichi.interfaces.admission_policy import admission_policy
from animichi.interfaces.anon_quota import (
    ANON_QUOTA_EXHAUSTED_CODE,
    QUOTA_RESETS_AT_FIELD,
)
from animichi.interfaces.db_repos import (
    anon_quota_repo,
    turn_reservation_store,
    usage_repo,
)
from animichi.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
    _get_db_from_request,
    _get_settings_from_request,
)
from animichi.interfaces.usage_metering import ANON_BUDGET_EXHAUSTED_CODE

_ADMISSION_REVISION_PATTERN = re.compile(r"^-?[0-9]+$")

BUDGET_EXHAUSTED_MESSAGE = (
    "今日はここまで。ログインすると続きから一緒に旅の計画を立てられるよ。"
)
QUOTA_EXHAUSTED_MESSAGE = "今日はここまで・ログインすると続けられるよ。"
BYOK_REQUIRES_LOGIN_MESSAGE = "BYOKを使うにはログインが必要です。"
STALE_REVISION_MESSAGE = "会話の状態が新しいようです。最新の状態でやり直してください。"
DIGEST_MISMATCH_MESSAGE = "会話の状態が一致しません。最新の状態でやり直してください。"
TURN_IN_FLIGHT_MESSAGE = "リクエストを処理中です。しばらくしてからお試しください。"
TURN_FAILED_MESSAGE = (
    "このリクエストは実行途中で中断されました。新しいリクエストでお試しください。"
)
CONVERSATION_NOT_FOUND_MESSAGE = "Conversation not found."


def _store_from_request(request: Request) -> TurnOutcomeStore | None:
    """Resolve the durable turn store: the lifespan-owned SQLModel store
    (#994) first, the db-client locator as the test-double fallback."""
    store = getattr(request.app.state, "turn_store", None)
    if store is not None:
        return cast(TurnOutcomeStore, store)
    return turn_reservation_store(_get_db_from_request(request))


def build_turn_admission(
    request: Request, *, policy: AdmissionPolicy | None = None
) -> TurnAdmission:
    """Resolve the admission use case from request state (one source)."""
    db = _get_db_from_request(request)
    settings = _get_settings_from_request(request)
    return TurnAdmission(
        store=_store_from_request(request),
        policy=policy or admission_policy(settings),
        usage_repo=usage_repo(db),
        anon_quota_repo=anon_quota_repo(db),
    )


def build_turn_outcome(
    request: Request, *, policy: AdmissionPolicy | None = None
) -> TurnOutcome:
    """Resolve the lifecycle use case (store + admission) for one request."""
    return TurnOutcome(
        store=_store_from_request(request),
        admission=build_turn_admission(request, policy=policy),
    )


def build_startup_turn_outcome(db: object) -> TurnOutcome:
    """Resolve a sweep-only lifecycle use case for the Agent startup sweep."""
    return TurnOutcome(store=turn_reservation_store(db))


def admission_request(
    request: Request,
    auth: TrustedAuthContext,
    *,
    session_id: str | None,
    is_byok: bool,
    identity: AdmissionIdentity | None = None,
) -> AdmissionRequest:
    """Build one admission request from headers + identity.

    The admission headers are optional; absent values make the turn a fresh
    reservation (turn_id is generated) with no revision/digest assertion.
    ``identity`` defaults to the edge-forwarded headers; callers that treat a
    missing ``X-User-Id`` as the anonymous tier (photo-search) pass one.
    """
    return AdmissionRequest(
        identity=identity
        or AdmissionIdentity(user_id=auth.user_id, user_type=auth.user_type),
        session_id=session_id,
        turn_key=_header(request, "x-turn-id") or uuid4().hex,
        expected_revision=_revision_header(request),
        session_digest=_header(request, "x-session-digest"),
        is_byok=is_byok,
    )


def admission_rejection_response(verdict: AdmissionVerdict) -> JSONResponse | None:
    """Map an admission verdict to its wire envelope; ``None`` when admitted."""
    rejection = verdict.rejection
    if rejection is None:
        return None
    if rejection.reason == "ownership":
        return JSONResponse(
            status_code=404, content={"detail": CONVERSATION_NOT_FOUND_MESSAGE}
        )
    if rejection.reason == "budget_exhausted":
        return _budget_exhausted_response()
    if rejection.reason == "quota_exhausted":
        return _quota_exhausted_response(rejection.resets_at)
    if rejection.reason == "byok_requires_login":
        return _error_response(
            "byok_requires_login", BYOK_REQUIRES_LOGIN_MESSAGE, status_code=403
        )
    if rejection.reason == "stale_revision":
        return _error_response(
            "stale_revision", STALE_REVISION_MESSAGE, status_code=409
        )
    if rejection.reason == "digest_mismatch":
        return _error_response(
            "session_digest_mismatch", DIGEST_MISMATCH_MESSAGE, status_code=409
        )
    if rejection.reason == "turn_failed":
        return _error_response("turn_failed", TURN_FAILED_MESSAGE, status_code=409)
    return _error_response("turn_in_flight", TURN_IN_FLIGHT_MESSAGE, status_code=409)


def _budget_exhausted_response() -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={
            "error": {
                "code": ANON_BUDGET_EXHAUSTED_CODE,
                "message": BUDGET_EXHAUSTED_MESSAGE,
                "action": "login",
            }
        },
    )


def _quota_exhausted_response(resets_at: datetime | None) -> JSONResponse:
    data = None
    if resets_at is not None:
        data = {QUOTA_RESETS_AT_FIELD: resets_at.strftime("%Y-%m-%dT%H:%M:%SZ")}
    error: dict[str, object] = {
        "code": ANON_QUOTA_EXHAUSTED_CODE,
        "message": QUOTA_EXHAUSTED_MESSAGE,
        "action": "login",
    }
    if data is not None:
        error["data"] = data
    return JSONResponse(status_code=403, content={"error": error})


def _header(request: Request, name: str) -> str | None:
    value = request.headers.get(name)
    return value.strip() if value else None


def _revision_header(request: Request) -> int | None:
    raw = _header(request, "x-session-revision")
    if raw is None or not _ADMISSION_REVISION_PATTERN.fullmatch(raw):
        return None
    return int(raw)
