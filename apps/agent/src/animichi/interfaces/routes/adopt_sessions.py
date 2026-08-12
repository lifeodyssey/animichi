"""Session identity adoption on login (SESSION-2 #960).

`POST /v1/sessions/adopt` re-points every session owned by the calling
browser's anonymous identity to the real, logged-in user, and bumps each
adopted session's revision so pre-adoption anonymous capabilities go stale.
Identity-dimensional: no `session_id` (the magic-link tab has none) and no
request body (nothing to probe with) — the only inputs are trusted headers.
A request that carries a client Session id in its query, body, or headers is
rejected outright: the endpoint has no use for one and accepting it would
re-open an ownership-probing surface.
"""

from __future__ import annotations

import json
import time
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from animichi.application.adopt_sessions import adopt_sessions
from animichi.infrastructure.observability.runtime import record_adoption_request
from animichi.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_db_from_request,
    _get_trusted_anon_id,
    _json_response,
    _require_non_anonymous_user,
    _require_supabase,
)

router = APIRouter(prefix="/v1", tags=["session"])

_SESSION_ID_QUERY_KEY = "session_id"
_SESSION_ID_HEADER = "x-session-id"
#: The endpoint is identity-dimensional and accepts no body; anything sent is
#: only ever probed for a Session id. Bound the read so a hostile payload
#: cannot fill memory before the JSON probe.
_MAX_BODY_BYTES = 1024


async def _reject_client_session_id(request: Request) -> None:
    """Refuse any request carrying a client Session id (query, body, header)."""
    if _SESSION_ID_QUERY_KEY in request.query_params:
        raise HTTPException(
            status_code=400, detail="Client session ids are not accepted."
        )
    if request.headers.get(_SESSION_ID_HEADER) is not None:
        raise HTTPException(
            status_code=400, detail="Client session ids are not accepted."
        )
    length = request.headers.get("content-length")
    if length is not None and length.isdigit() and int(length) > _MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body too large.")
    raw = await request.body()
    if len(raw) > _MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body too large.")
    if not raw:
        return
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400, detail="Client session ids are not accepted."
        ) from None
    if isinstance(payload, dict) and _SESSION_ID_QUERY_KEY in payload:
        raise HTTPException(
            status_code=400, detail="Client session ids are not accepted."
        )


@router.post("/sessions/adopt")
async def handle_adopt_sessions(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_non_anonymous_user)],
    from_anon_id: Annotated[str | None, Depends(_get_trusted_anon_id)],
) -> JSONResponse:
    await _reject_client_session_id(request)
    db = _require_supabase(_get_db_from_request(request))
    # `_require_non_anonymous_user` raises before this handler runs unless
    # `auth.user_id` is set; the cast documents that contract for mypy.
    to_user_id = cast(str, auth.user_id)
    started = time.monotonic()
    outcome = await adopt_sessions(db, from_anon_id=from_anon_id, to_user_id=to_user_id)
    record_adoption_request(
        duration_ms=(time.monotonic() - started) * 1000,
        adopted_count=outcome.adopted_count,
        noop_class=outcome.noop_class.value,
        revisions_bumped=outcome.revisions_bumped,
    )
    return _json_response(
        {
            "adopted": outcome.adopted_count,
            "noop_class": outcome.noop_class.value,
            "revisions_bumped": outcome.revisions_bumped,
        }
    )
