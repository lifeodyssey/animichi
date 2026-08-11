"""`POST /v1/byok/probe` — BYOK credential validation + vision-capability
probe (#284 Task 5, spec D5).

Deliberately dual-purpose (OQ-2 ruling): a single minimal call both validates
the caller's credential (one upstream request) and detects whether the
configured model accepts an image part, so configuring a key costs the user
exactly one probe request instead of two.

Authenticated route only (login-gated like the rest of BYOK): not listed in
`workers/edge/app.ts`'s `ANON_V1`, so an unauthenticated caller is rejected at the
edge with a 401 before this ever runs (T5-AC5). The container repeats the
login gate anyway (defense in depth, mirrors `chat.py::_byok_login_rejection`)
in case this route is ever reached directly.

Route is deliberately thin (AGENT-2 #953): the bounded probe itself —
egress pre-validation, the ≤64 KiB response cap, the whole-operation timeout,
the probe turn, client cleanup, and the mapping onto the generated
`ByokProbeResponse` boundary model — lives in
`ProbeModelCredential` (`interfaces/services/byok_probe.py`). This handler
keeps only the auth gate, credential parsing, and rejection mapping, and
binds the generated model as its `response_model`.

Containment (rev4, P2-1): the probe is otherwise a reachability oracle for a
caller-chosen endpoint, so three constraints apply beyond the SSRF guard
itself: (a) the failure taxonomy collapses to `provider_unreachable` except
for the two auth outcomes (401/403), which alone are actionable for the
caller — review follow-up (#479 P1-2/P2-1): only 400/422 mean "reachable but
this model rejects the image part"; every OTHER HTTP status (404/429/5xx)
also collapses to `provider_unreachable`, and the whole model call is
wrapped in a bare `except Exception` so nothing here escapes to the generic
500 handler, which would otherwise be a FOURTH distinguishable outcome; (b) a
fixed ≤5s wall-clock timeout so latency cannot distinguish open-vs-filtered;
(c) a ≤64 KiB response read cap so a hostile endpoint cannot stream unbounded
data into the container.

Residual risk, accepted (#479 review, not fixed here): (b)'s fixed ceiling
bounds *how long* a caller can wait, but the concrete failure latency below
that ceiling still differs by cause (a local connection-refused typically
resolves in single-digit milliseconds; a black-holed/filtered destination
consumes the full timeout) — a patient attacker can still time the response
to infer open-vs-filtered-vs-connection-refused across many probes. Tracked
as a documented accepted residual rather than silently declared "solved" —
see issue #481 for a constant-time-response mitigation.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from animichi.interfaces.boundary.agent_models import ByokProbeResponse
from animichi.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
    _get_byok_credential,
    _has_byok_headers,
    _require_trusted_user,
)
from animichi.interfaces.services.byok_probe import (
    ProbeModelCredential,
    ProbeRejection,
)
from animichi.interfaces.usage_metering import is_anonymous_identity

router = APIRouter(prefix="/v1/byok", tags=["byok"])

_probe_model_credential = ProbeModelCredential()


def _probe_login_rejection(
    auth: TrustedAuthContext, request: Request
) -> JSONResponse | None:
    """Mirrors `chat.py::_byok_login_rejection` — including its fix (#741).

    Routes through `is_anonymous_identity` rather than a bare
    `user_type != ANONYMOUS_USER_TYPE` check: an `anon_`-prefixed
    `X-User-Id` with a missing or mistyped `X-User-Type` is anonymous by the
    ID convention too, and a literal check here would let that caller reach
    the real credential-probing model call.
    """
    if not is_anonymous_identity(auth.user_id, auth.user_type) or not _has_byok_headers(
        request
    ):
        return None
    return _error_response(
        "byok_requires_login", "BYOKを使うにはログインが必要です。", status_code=403
    )


@router.post("/probe", response_model=ByokProbeResponse)
async def handle_byok_probe(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse | ByokProbeResponse:
    """Validate a BYOK credential and detect vision support in one call."""
    login_rejection = _probe_login_rejection(auth, request)
    if login_rejection is not None:
        return login_rejection
    credential = _get_byok_credential(request)
    if credential is None:
        return _error_response(
            "invalid_request", "X-BYOK-* headers are required.", status_code=400
        )
    try:
        return await _probe_model_credential.probe(credential)
    except ProbeRejection as rejection:
        return _error_response(rejection.code, rejection.message, status_code=400)
