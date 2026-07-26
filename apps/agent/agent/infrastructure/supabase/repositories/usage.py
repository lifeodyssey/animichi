"""Daily model-usage meter operations (issue #274 / S1.8)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from agent.infrastructure.supabase.client_types import AsyncPGPool


def _as_usd(value: object) -> float:
    """Coerce a NUMERIC column (asyncpg yields Decimal) into a float."""
    if isinstance(value, Decimal | int | float):
        return float(value)
    return 0.0


class UsageRepository:
    """Scope-partitioned daily usage accumulation and read-back."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def accumulate_usage(
        self,
        *,
        usage_date: date,
        scope: str,
        requests: int,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        """Add one turn's usage to the (day, scope) row, creating it if absent."""
        await self._pool.execute(
            """
            INSERT INTO daily_usage (
                usage_date, scope, requests, input_tokens, output_tokens, cost_usd
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (usage_date, scope) DO UPDATE SET
                requests = daily_usage.requests + EXCLUDED.requests,
                input_tokens = daily_usage.input_tokens + EXCLUDED.input_tokens,
                output_tokens = daily_usage.output_tokens + EXCLUDED.output_tokens,
                cost_usd = daily_usage.cost_usd + EXCLUDED.cost_usd,
                updated_at = NOW()
            """,
            usage_date,
            scope,
            requests,
            input_tokens,
            output_tokens,
            Decimal(str(cost_usd)),
        )

    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float:
        """Return the accumulated spend for one (day, scope); 0.0 when absent."""
        row = await self._pool.fetchrow(
            "SELECT cost_usd FROM daily_usage WHERE usage_date = $1 AND scope = $2",
            usage_date,
            scope,
        )
        return 0.0 if row is None else _as_usd(row["cost_usd"])
