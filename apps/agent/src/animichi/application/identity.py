"""Neutral identity classification (TURN-2 #949).

The admission layer owns the identity-to-payer mapping: given the
edge-forwarded identity headers, one turn is billed to exactly one payer
scope. ``interfaces/usage_metering`` re-exports these so the rest of the
agent keeps its single import site.
"""

from __future__ import annotations

from typing import Literal

UsageScope = Literal["anon", "user", "byok"]

#: Prefix the edge stamps on every anonymous ``X-User-Id`` (workers/edge/auth.ts).
ANON_USER_ID_PREFIX = "anon_"
ANONYMOUS_USER_TYPE = "anonymous"


def is_anonymous_identity(user_id: str | None, user_type: str | None) -> bool:
    """Prefer the typed edge marker, with the ID convention as a fallback."""
    if user_type == ANONYMOUS_USER_TYPE:
        return True
    return user_id is not None and user_id.startswith(ANON_USER_ID_PREFIX)


def scope_for_identity(
    user_id: str | None, user_type: str | None, *, is_byok: bool = False
) -> UsageScope:
    """Classify a turn's spend by who paid for it.

    A BYOK turn is checked first: the caller supplied and paid for the model
    call directly, so it is never folded into the anonymous or user scopes
    even when it also happens to carry an anonymous-shaped identity.
    """
    if is_byok:
        return "byok"
    if is_anonymous_identity(user_id, user_type):
        return "anon"
    return "user"
