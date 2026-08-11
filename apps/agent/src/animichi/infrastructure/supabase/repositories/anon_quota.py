"""Per-identity anonymous daily message counter (issue #282 / S1.10)."""

from __future__ import annotations

from datetime import date

from animichi.infrastructure.supabase.client_types import AsyncPGPool


class AnonQuotaRepository:
    """Atomic per-(day, anon identity) message-attempt counter."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def count_for(self, *, usage_date: date, anon_id: str) -> int:
        """Return today's count for *anon_id* (admission read; never mutates)."""
        row = await self._pool.fetchrow(
            "SELECT message_count FROM anon_daily_message_count"
            " WHERE usage_date = $1 AND anon_id = $2",
            usage_date,
            anon_id,
        )
        return 0 if row is None else int(row["message_count"])

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
