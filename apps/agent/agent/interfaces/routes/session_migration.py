"""Session identity transition on login (issue #273 Task 3).

`POST /v1/session/migrate` re-points every session owned by the calling
browser's anonymous identity to the real, logged-in user. Identity-
dimensional: no `session_id` (the magic-link tab has none) and no request
body (nothing to probe with) — the only inputs are trusted headers.
"""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from agent.agents.session_ownership import migrate_session_ownership
from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_db_from_request,
    _get_trusted_anon_id,
    _json_response,
    _require_non_anonymous_user,
    _require_supabase,
)

router = APIRouter(prefix="/v1", tags=["session"])


@router.post("/session/migrate")
async def handle_session_migrate(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_non_anonymous_user)],
    from_anon_id: Annotated[str | None, Depends(_get_trusted_anon_id)],
) -> JSONResponse:
    db = _require_supabase(_get_db_from_request(request))
    # `_require_non_anonymous_user` raises before this handler runs unless
    # `auth.user_id` is set; the cast documents that contract for mypy.
    to_user_id = cast(str, auth.user_id)
    outcome = await migrate_session_ownership(
        db, from_anon_id=from_anon_id, to_user_id=to_user_id
    )
    return _json_response({"migrated": outcome.migrated})
