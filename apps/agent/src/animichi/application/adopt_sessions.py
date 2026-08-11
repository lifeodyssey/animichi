"""AdoptSessions — the Agent-owned idempotent ownership command (SESSION-2 #960).

On login, every session belonging to the calling browser's anonymous identity
is re-pointed to the real user with a single identity-dimensional
``UPDATE conversations SET user_id = $to WHERE user_id = $from_anon`` — not
scoped to any one ``session_id``, so a browser with multiple anonymous
sessions adopts all of them in one call.

Unlike the legacy migration, adoption also bumps each adopted session's
revision so pre-adoption anonymous capabilities (turn reservations, session
digests) go stale: a client that holds a pre-adoption capability now presents
an ``expected_revision`` that no longer matches, and admission answers 409
``stale_revision``.

The command consumes only trusted identities (the edge-forwarded ``X-Anon-Id``
and the Neon ``X-User-Id``) and accepts **no client Session id**. Telemetry
records adoption count, no-op class, revision outcome, and duration — never an
actor or Session identifier.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

#: Reserved `turn_reservations.turn_key` namespace for the synthetic adoption
#: marker rows (SESSION-2 #960). Markers are the revision-CAS authority and must
#: persist; a client turn_key in this namespace would both spoof a completed
#: replay and consume a prune slot, so admission rejects the prefix outright.
ADOPT_TURN_KEY_PREFIX = "adopt:"


class NoOpClass(StrEnum):
    """Why this adoption changed nothing (or everything)."""

    ADOPTED = "adopted"
    NO_ANONYMOUS_IDENTITY = "no_anonymous_identity"
    NO_ROWS = "no_rows"


@dataclass(frozen=True)
class AdoptionResult:
    """Repository-level facts: how many sessions moved and how many got their
    revision bumped. `revisions_bumped` may differ from `adopted_count` when a
    concurrent reservation already advanced the revision for a session."""

    adopted_count: int
    revisions_bumped: int


class SupportsAdoption(Protocol):
    async def adopt_ownership(
        self, from_anon_id: str, to_user_id: str
    ) -> AdoptionResult: ...


class SupportsSessionRepo(Protocol):
    @property
    def session(self) -> SupportsAdoption: ...


@dataclass(frozen=True)
class AdoptionOutcome:
    adopted_count: int
    noop_class: NoOpClass
    revisions_bumped: int


async def adopt_sessions(
    db: SupportsSessionRepo,
    *,
    from_anon_id: str | None,
    to_user_id: str,
) -> AdoptionOutcome:
    """Adopt every anonymous session for the just-authenticated user.

    A missing `from_anon_id` (no trusted anonymous history for this caller)
    is the cross-device no-op: the caller was never anonymous here, so there is
    nothing to adopt. An identity that owns zero sessions (a second run) is the
    replay no-op. Both are typed outcomes, never exceptions.
    """
    if from_anon_id is None:
        return AdoptionOutcome(0, NoOpClass.NO_ANONYMOUS_IDENTITY, 0)
    result = await db.session.adopt_ownership(from_anon_id, to_user_id)
    if result.adopted_count == 0:
        return AdoptionOutcome(0, NoOpClass.NO_ROWS, 0)
    return AdoptionOutcome(
        result.adopted_count, NoOpClass.ADOPTED, result.revisions_bumped
    )
