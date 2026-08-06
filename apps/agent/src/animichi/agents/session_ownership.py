"""Session identity ownership transition (issue #273 Task 3).

On login, every session belonging to the calling browser's anonymous
identity is re-pointed to the real user with a single identity-dimensional
`UPDATE conversations SET user_id = $to WHERE user_id = $from_anon` — not
scoped to any one `session_id`, so a browser with multiple anonymous
sessions migrates all of them in one call.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class MigrationOutcome:
    """`False` is the typed no-op — that identity owned nothing — not an error."""

    migrated: bool


class SupportsOwnershipMigration(Protocol):
    async def migrate_ownership(self, from_anon_id: str, to_user_id: str) -> bool: ...


class SupportsSessionRepo(Protocol):
    @property
    def session(self) -> SupportsOwnershipMigration: ...


async def migrate_session_ownership(
    db: SupportsSessionRepo,
    *,
    from_anon_id: str | None,
    to_user_id: str,
) -> MigrationOutcome:
    """Move ownership of every anonymous session to the real user.

    A missing `from_anon_id` (no trusted anonymous history for this caller)
    is a normal outcome, not an exception: the caller was never anonymous
    here, so there is nothing to migrate.
    """
    if from_anon_id is None:
        return MigrationOutcome(migrated=False)
    changed = await db.session.migrate_ownership(from_anon_id, to_user_id)
    return MigrationOutcome(migrated=changed)
