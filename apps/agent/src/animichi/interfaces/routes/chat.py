"""Vercel AI SDK envelope over the unified runtime boundary."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated, Never

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse

from animichi.agents.byok_models import (
    ByokError,
    ByokModel,
    build_byok_model,
)
from animichi.agents.error_messages import InputError, build_input_error_message
from animichi.agents.runtime_deps import OnStep
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import TurnRef
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_byok_credential,
    _get_runtime_api,
    _get_settings_from_request,
    _get_trusted_auth_context,
    _has_byok_headers,
    _require_trusted_user,
)
from animichi.interfaces.routes.admission import (
    admission_rejection_response,
    admission_request,
    build_turn_outcome,
)
from animichi.interfaces.routes.chat_body import (
    ChatBody,
    ChatBodyRoute,
    ChatMessageError,
    Locale,
    request_locale,
)
from animichi.interfaces.routes.chat_stream import stream_chat
from animichi.interfaces.schemas import PublicAPIRequest, PublicAPIResponse

_PREFLIGHT_STATE = "chat_body_preflight_complete"


def _chat_auth_from_request(request: Request) -> TrustedAuthContext:
    auth = _get_trusted_auth_context(
        request.headers.get("x-user-id"),
        request.headers.get("x-user-type"),
        request.headers.get("authorization"),
    )
    return _require_trusted_user(auth)


def _chat_auth(request: Request) -> TrustedAuthContext:
    auth = getattr(request.state, "chat_auth", None)
    return (
        auth
        if isinstance(auth, TrustedAuthContext)
        else _chat_auth_from_request(request)
    )


def _reject_input(reason: InputError, locale: Locale) -> Never:
    message = build_input_error_message(reason, locale)
    raise HTTPException(status_code=422, detail=message)


def _chat_text(body: ChatBody, limit: int, locale: Locale) -> str:
    try:
        return body.last_user_text(limit)
    except ChatMessageError as exc:
        _reject_input(exc.reason, locale)


def _runtime_request(request: Request, body: ChatBody, limit: int) -> PublicAPIRequest:
    locale = request_locale(request)
    text = _chat_text(body, limit, locale)
    return PublicAPIRequest(
        text=text,
        session_id=request.headers.get("x-session-id"),
        locale=locale,
        **body.model_dump(exclude={"messages"}),
    )


async def _route_preflight(request: Request) -> JSONResponse | None:
    """No-op admission preflight (TURN-2 #949).

    The old budget/BYOK preflight lived here and short-circuited before body
    parsing; admission now runs in the handler body so malformed input never
    consumes quota and the turn cannot be admitted before its request text is
    validated. The preflight keeps setting the shared auth state the handler
    reads through ``_chat_auth``.
    """
    auth = _chat_auth_from_request(request)
    request.state.chat_auth = auth
    setattr(request.state, _PREFLIGHT_STATE, True)
    return None


class ChatRoute(ChatBodyRoute):
    async def preflight(self, request: Request) -> Response | None:
        return await _route_preflight(request)


router = APIRouter(prefix="/v1", tags=["chat"], route_class=ChatRoute)


async def _resolve_byok_model(request: Request) -> ByokModel | None:
    """Parse and build the per-request guarded model before streaming begins.

    Called directly from the route body (P1-1) — never via `Depends()` — so
    the credential is never resolved into a FastAPI endpoint parameter that
    `logfire.instrument_fastapi()` would otherwise capture into
    `fastapi.arguments.values`.

    Any rejection here is a pre-stream 4xx: the response has not been
    constructed yet, so a raised `HTTPException` behaves normally through
    FastAPI's own exception handling. `ByokError` (a client-input problem)
    maps to its own code; anything else raised during provider/client
    construction (P2) is still the caller's malformed input from this
    boundary's point of view, so it maps to the same `invalid_request` shape
    rather than an unhandled 500.
    """
    byok = _get_byok_credential(request)
    if byok is None:
        return None
    try:
        return await build_byok_model(byok)
    except ByokError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail="Unable to construct the BYOK model."
        ) from exc


def _chat_handler(
    runtime_api: RuntimeAPI,
    api_request: PublicAPIRequest,
    auth: TrustedAuthContext,
    byok_model: ByokModel | None,
    *,
    outcome: TurnOutcome | None,
    turn_ref: TurnRef | None,
    owner: str | None,
) -> Callable[[OnStep], Awaitable[PublicAPIResponse]]:
    async def handler(on_step: OnStep) -> PublicAPIResponse:
        return await runtime_api.handle(
            api_request,
            model=byok_model.model if byok_model is not None else None,
            is_byok=byok_model is not None,
            user_id=auth.user_id,
            user_type=auth.user_type,
            on_step=on_step,
            outcome=outcome,
            turn_ref=turn_ref,
            owner=owner,
        )

    return handler


@router.post("/chat", responses={422: {"description": "Invalid chat request"}})
async def handle_chat(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_chat_auth)],
    body: ChatBody,
) -> Response:
    """Stream chat as an AI SDK UI message stream with tool + data parts."""
    settings = _get_settings_from_request(request)
    api_request = _runtime_request(request, body, settings.message_max_chars)
    runtime_api = _get_runtime_api(request)
    # Ownership is enforced twice by design: this route-level check raises the
    # 404 before any stream starts (and before admission reserves anything),
    # and TurnAdmission's own store-level check gates the durable reservation
    # for the real repository. A cross-user caller must never consume a quota
    # slot or a reservation.
    await runtime_api.validate_session_owner(api_request.session_id, auth.user_id)

    outcome = build_turn_outcome(request)
    admission_req = admission_request(
        request,
        auth,
        session_id=api_request.session_id,
        is_byok=_has_byok_headers(request),
    )
    verdict = await outcome.admit(admission_req)
    rejection = admission_rejection_response(verdict)
    if rejection is not None:
        return rejection

    reserved = verdict.admitted and not verdict.replayed
    turn_ref = TurnRef(session_id=verdict.session_id, turn_key=admission_req.turn_key)
    owner = verdict.owner
    try:
        byok_model = await _resolve_byok_model(request)
    except BaseException:
        # Pre-dispatch failure: the reservation was never dispatched, so it is
        # released (never replayed) rather than settled.
        if reserved and owner is not None:
            await outcome.release(turn_ref, owner=owner)
        raise
    handler = _chat_handler(
        runtime_api,
        api_request,
        auth,
        byok_model,
        outcome=outcome if reserved else None,
        turn_ref=turn_ref if reserved else None,
        owner=owner if reserved else None,
    )

    response = StreamingResponse(
        stream_chat(handler),
        media_type="text/event-stream",
        headers={"x-vercel-ai-ui-message-stream": "v1"},
    )
    if byok_model is not None:
        # T3-AC8 (P2): cleanup via `BackgroundTask` rather than a
        # try/finally inside the streaming handler — Starlette guarantees
        # this runs after the response completes, including on a client
        # disconnect mid-stream, decoupled from whether the body iterator
        # itself ever got to run to completion.
        response.background = BackgroundTask(byok_model.client.aclose)
    return response
