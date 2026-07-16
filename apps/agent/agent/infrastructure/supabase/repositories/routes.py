"""Route persistence operations."""

from __future__ import annotations

import datetime as dt
import json

from agent.infrastructure.supabase.client_types import AsyncPGPool
from agent.infrastructure.supabase.helpers import _require_row


class RoutesRepository:
    """Route data access."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def save_route(
        self,
        session_id: str,
        anime_ids: list[str],
        point_ids: list[str],
        route_data: dict[str, object],
        *,
        origin_station: str | None = None,
        origin_lat: float | None = None,
        origin_lon: float | None = None,
        total_distance: float | None = None,
        total_duration: int | None = None,
    ) -> str:
        """Save a computed route. Returns the generated route UUID."""

        def _default(o: object) -> object:
            if isinstance(o, (dt.datetime, dt.date)):
                return o.isoformat()
            raise TypeError(f"Not serializable: {type(o).__name__}")

        route_json = json.dumps(route_data, default=_default)
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                row = _require_row(
                    await connection.fetchrow(
                        """
                        INSERT INTO routes (
                            session_id, origin_station, origin_location, point_ids,
                            total_distance, total_duration, route_data
                        )
                        VALUES ($1, $2,
                                CASE WHEN $3 IS NOT NULL
                                     THEN ST_MakePoint($3, $4)::geography
                                     ELSE NULL END,
                                $5, $6, $7, $8::jsonb)
                        RETURNING id
                        """,
                        session_id,
                        origin_station,
                        origin_lon,
                        origin_lat,
                        point_ids,
                        total_distance,
                        total_duration,
                        route_json,
                    ),
                    operation="save_route",
                )
                route_id = str(row["id"])
                if anime_ids:
                    await connection.executemany(
                        """INSERT INTO route_anime (route_id, bangumi_id, position)
                           VALUES ($1, $2, $3)""",
                        [
                            (route_id, bangumi_id, position)
                            for position, bangumi_id in enumerate(anime_ids)
                        ],
                    )
        return route_id

    async def get_user_routes(
        self, user_id: str, limit: int = 20
    ) -> list[dict[str, object]]:
        """Fetch route history for a user via their conversations."""
        rows = await self._pool.fetch(
            """SELECT r.id, r.origin_station,
                      array_length(r.point_ids, 1) AS point_count,
                      r.created_at,
                      COALESCE(anime.anime_ids, ARRAY[]::text[]) AS anime_ids,
                      COALESCE(anime.anime_titles, ARRAY[]::text[]) AS anime_titles
               FROM routes r
               JOIN conversations c ON r.session_id = c.session_id
               LEFT JOIN LATERAL (
                   SELECT array_agg(ra.bangumi_id ORDER BY ra.position) AS anime_ids,
                          array_agg(b.title ORDER BY ra.position) AS anime_titles
                   FROM route_anime ra
                   JOIN bangumi b ON b.id = ra.bangumi_id
                   WHERE ra.route_id = r.id
               ) anime ON TRUE
               WHERE c.user_id = $1
               ORDER BY r.created_at DESC
               LIMIT $2""",
            user_id,
            limit,
        )
        return [dict(r) for r in rows]
