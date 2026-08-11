"""Photo-search boundary (AGENT-1 #952): thin route over the use cases.

The application use cases own the behavior — :class:`SearchPhoto` (image
validation, quota, recognition through the vision adapter, the resolve/
degrade pipeline, offer issuance, usage recording, BYOK cleanup) and
:class:`ConfirmPhotoOffer` (sessionless candidate-offer confirmation). This
module only parses the generated request DTOs, resolves the BYOK model from
the trusted headers (mirroring `interfaces.routes.chat`), runs
:class:`TurnOutcome` first (TURN-2 #949 / TURN-3 #951: admit, dispatch-certainty
guard, exactly-once settle), and maps neutral results to the generated wire
models. Runtime construction lives in `interfaces.routes.photo_search_runtime`.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from animichi.agents.byok_models import ByokError, ByokModel, build_byok_model
from animichi.application.confirm_photo_offer import (
    ConfirmPhotoOffer,
    PhotoOfferRejection,
)
from animichi.application.photo_image import PhotoSearchRejection
from animichi.application.photo_offers import OfferSignals
from animichi.application.photo_search_envelope import (
    PhotoCandidate,
    PhotoPoint,
    PhotoResults,
    PhotoSearchData,
)
from animichi.application.search_photo import (
    SearchPhoto,
    SearchPhotoCommand,
    SearchPhotoResult,
)
from animichi.application.turn_admission import AdmissionIdentity, AdmissionPolicy
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import SettleOutcome, TurnRef
from animichi.infrastructure.observability.photo_search import (
    PhotoSearchSignals,
    record_photo_search,
)
from animichi.interfaces.boundary.agent_models import (
    PhotoConfirmRequest,
    PhotoSearchRequest,
    PhotoSearchResponse,
    PhotoSearchResponseData,
    PhotoSearchResponseDataCandidates,
    PhotoSearchResponseDataResults,
    PhotoSearchResponseDataResultsRows,
)
from animichi.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
    _get_byok_credential,
    _get_settings_from_request,
    _get_trusted_auth_context,
    _has_byok_headers,
)
from animichi.interfaces.routes.admission import (
    admission_rejection_response,
    admission_request,
    build_turn_outcome,
)
from animichi.interfaces.routes.photo_search_runtime import (
    PhotoSearchRuntime,
    build_photo_search_runtime,
    build_search_photo,
    get_photo_runtime,
    search_command,
)
from animichi.interfaces.usage_metering import ANONYMOUS_USER_TYPE

__all__ = ["PhotoSearchRuntime", "build_photo_search_runtime"]

router = APIRouter(prefix="/v1", tags=["photo-search"])


async def _resolve_byok_model(request: Request) -> ByokModel | None:
    """Parse and build the per-request guarded model, same contract as
    `animichi.interfaces.routes.chat._resolve_byok_model`. The caller MUST
    `await .client.aclose()` once the turn is over — SearchPhoto does that
    through its `ByokSession` seam on every exit path."""
    byok = _get_byok_credential(request)
    if byok is None:
        return None
    try:
        return await build_byok_model(byok)
    except ByokError as exc:
        raise PhotoSearchRejection(400, "invalid_request", exc.message) from exc
    except Exception as exc:
        raise PhotoSearchRejection(
            400, "invalid_request", "Unable to construct the BYOK model."
        ) from exc


def _rejection_response(rejection: PhotoSearchRejection) -> JSONResponse:
    details = (
        {"guidance": rejection.guidance} if rejection.guidance is not None else None
    )
    return _error_response(
        rejection.code,
        rejection.message,
        status_code=rejection.status_code,
        details=details,
    )


def _wire_point(point: PhotoPoint) -> PhotoSearchResponseDataResultsRows:
    return PhotoSearchResponseDataResultsRows(**asdict(point))


def _wire_results(results: PhotoResults) -> PhotoSearchResponseDataResults:
    return PhotoSearchResponseDataResults(
        kind="bangumi",
        bangumi_id=results.bangumi_id,
        title=results.title,
        row_count=results.row_count,
        rows=[_wire_point(row) for row in results.rows],
    )


def _wire_candidate(candidate: PhotoCandidate) -> PhotoSearchResponseDataCandidates:
    return PhotoSearchResponseDataCandidates(
        id=candidate.id, title=candidate.title, bangumi_id=candidate.bangumi_id
    )


def _wire_data(data: PhotoSearchData) -> PhotoSearchResponseData:
    results = _wire_results(data.results) if data.results is not None else None
    candidates = (
        [_wire_candidate(candidate) for candidate in data.candidates]
        if data.candidates
        else None
    )
    return PhotoSearchResponseData(
        results=results, reason=data.reason, candidates=candidates
    )


def _wire_response(result: SearchPhotoResult) -> PhotoSearchResponse:
    return PhotoSearchResponse(
        success=True,
        status="ok",
        intent=result.envelope.intent,
        offer_id=result.offer_id,
        data=_wire_data(result.envelope.data),
    )


def _search_signals(result: SearchPhotoResult) -> PhotoSearchSignals:
    return _signals(result.signals, user_confirmed=False)


def _confirm_signals(signals: OfferSignals) -> PhotoSearchSignals:
    return _signals(signals, user_confirmed=True)


def _signals(signals: OfferSignals, *, user_confirmed: bool) -> PhotoSearchSignals:
    return PhotoSearchSignals(
        query_type=signals.query_type,
        gps_available=signals.gps_available,
        layer_hit=signals.layer_hit,
        candidates_shown=signals.candidates_shown,
        user_confirmed=user_confirmed,
    )


async def _release_if_reserved(
    outcome: TurnOutcome,
    reserved: bool,
    owner: str | None,
    turn_ref: TurnRef,
) -> None:
    if reserved and owner is not None:
        await outcome.release(turn_ref, owner=owner)


async def _dispatch_certainty(
    outcome: TurnOutcome,
    reserved: bool,
    owner: str | None,
    turn_ref: TurnRef,
) -> bool:
    """Dispatch-certainty guard (TURN-3 #951): never run the vision pipeline
    for a turn whose lease is already gone."""
    if not (reserved and owner is not None):
        return True
    return await outcome.dispatch(turn_ref, owner=owner)


async def _settle_if_reserved(
    outcome: TurnOutcome,
    reserved: bool,
    owner: str | None,
    turn_ref: TurnRef,
    result: SettleOutcome,
) -> None:
    if reserved and owner is not None:
        await outcome.settle(turn_ref, owner=owner, outcome=result)


async def _run_search_settled(
    outcome: TurnOutcome,
    reserved: bool,
    owner: str | None,
    turn_ref: TurnRef,
    search: SearchPhoto,
    command: SearchPhotoCommand,
) -> SearchPhotoResult:
    try:
        result = await search(command)
    except PhotoSearchRejection:
        await _settle_if_reserved(outcome, reserved, owner, turn_ref, "failed")
        raise
    except BaseException:
        await _settle_if_reserved(outcome, reserved, owner, turn_ref, "failed")
        raise
    await _settle_if_reserved(outcome, reserved, owner, turn_ref, "completed")
    return result


@router.post(
    "/photo-search",
    response_model=PhotoSearchResponse,
    response_model_exclude_none=True,
    responses={415: {"description": "Unsupported image format"}},
)
async def handle_photo_search(
    request: Request,
    body: PhotoSearchRequest,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
) -> JSONResponse:
    """Run the SearchPhoto use case and reply with the generated envelope."""
    runtime = get_photo_runtime(request)
    settings = _get_settings_from_request(request)
    outcome = build_turn_outcome(
        request,
        policy=AdmissionPolicy(
            quota=None,
            budget_usd=settings.anon_daily_cost_budget_usd,
        ),
    )
    admission_req = admission_request(
        request,
        auth,
        session_id=None,
        is_byok=_has_byok_headers(request),
        # No `X-User-Id` is the anonymous tier here (host-keyed), mirroring
        # the identity mapping: an identified caller without a user-type
        # header must stay identified, never coerced into the anon scope.
        identity=AdmissionIdentity(
            user_id=auth.user_id,
            user_type=auth.user_type
            if auth.user_id is not None
            else ANONYMOUS_USER_TYPE,
        ),
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
    except PhotoSearchRejection as photo_rejection:
        await _release_if_reserved(outcome, reserved, owner, turn_ref)
        return _rejection_response(photo_rejection)
    if not await _dispatch_certainty(outcome, reserved, owner, turn_ref):
        return _rejection_response(
            PhotoSearchRejection(
                409, "turn_lease_lost", "The turn reservation expired; retry."
            )
        )
    search = build_search_photo(runtime, request, settings, byok_model)
    try:
        result = await _run_search_settled(
            outcome,
            reserved,
            owner,
            turn_ref,
            search,
            search_command(request, auth, body),
        )
    except PhotoSearchRejection as photo_rejection:
        return _rejection_response(photo_rejection)
    record_photo_search(_search_signals(result))
    return JSONResponse(_wire_response(result).model_dump(exclude_none=True))


@router.post("/photo-search/confirm", status_code=204, response_model=None)
async def handle_photo_confirm(
    request: Request,
    body: PhotoConfirmRequest,
) -> JSONResponse | None:
    """Confirm one candidate of a sessionless photo offer (AGENT-1 #952)."""
    runtime = get_photo_runtime(request)
    confirm = ConfirmPhotoOffer(offers=runtime.offers)
    try:
        outcome = confirm(body.offer_id, body.candidate_id)
    except PhotoOfferRejection as rejection:
        return _error_response(
            rejection.code, rejection.message, status_code=rejection.status_code
        )
    record_photo_search(_confirm_signals(outcome.signals))
    return None
