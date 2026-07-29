"""Per-identity anonymous daily message counter (issue #282 / S1.10)."""

from __future__ import annotations

from datetime import date

from agent.infrastructure.supabase.client_types import AsyncPGPool


class AnonQuotaRepository:
    """Atomic per-(day, anon identity) message-attempt counter."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def increment_and_count(self, *, usage_date: date, anon_id: str) -> int:
        """Atomically bump today's count for *anon_id* and return the new total."""
        row = await self._pool.fetchrow(
            """
            INSERT INTO anon_daily_message_count (usage_date, anon_id, message_count)
            VALUES ($1, $2, 1)
            ON CONFLICT (usage_date, anon_id) DO UPDATE SET
                message_count = anon_daily_message_count.message_count + 1,
                updated_at = NOW()
            RETURNING message_count
            """,
            usage_date,
            anon_id,
        )
        count = 0 if row is None else row["message_count"]
        return int(count)

    async def purge_older_than(self, cutoff: date) -> int:
        """Delete rows strictly older than *cutoff*; returns the count removed.

        No FK backstop is needed here (unlike the session-purge precedent):
        this table is a pure aggregate counter with no dependent rows, so a
        plain age-based delete is the whole retention policy.
        """
        result = await self._pool.execute(
            "DELETE FROM anon_daily_message_count WHERE usage_date < $1", cutoff
        )
        return _parse_delete_count(result)


def _parse_delete_count(result: str) -> int:
    """asyncpg's `execute` returns a command tag like ``"DELETE 3"``."""
    parts = result.split()
    return int(parts[-1]) if len(parts) == 2 and parts[0] == "DELETE" else 0
