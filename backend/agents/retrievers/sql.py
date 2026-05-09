"""SQL retrieval with Anitabi API as source of truth.

Strategy: API-first, DB-fallback.
Anitabi API is the authoritative data source. Local DB is a cache.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import structlog

from backend.agents.models import RetrievalRequest
from backend.agents.retrievers.enrichment import write_through_bangumi_points
from backend.agents.sql_agent import SQLAgent, SQLResult
from backend.domain.entities import Point

logger = structlog.get_logger(__name__)


def should_try_api(request: RetrievalRequest) -> bool:
    return request.tool == "search_bangumi" and bool(request.bangumi_id)


async def execute_sql_with_fallback(
    request: RetrievalRequest,
    sql_agent: SQLAgent,
    db: object,
    fetch_bangumi_points: Callable[[str], Awaitable[list[Point]]] | None,
    get_bangumi_subject: Callable[[int], Awaitable[dict[str, object]]] | None,
) -> tuple[SQLResult, dict[str, object]]:
    """API-first retrieval: always try Anitabi API, fall back to DB on failure."""
    metadata: dict[str, object] = {}

    if not should_try_api(request):
        result = await sql_agent.execute(request)
        metadata["data_origin"] = "db"
        return result, metadata

    bangumi_id = request.bangumi_id
    if bangumi_id is None:
        raise ValueError("bangumi_id required for search_bangumi")

    # Step 1: Try API write-through (fetch from Anitabi → write to DB)
    fallback_meta = await write_through_bangumi_points(
        db, bangumi_id, fetch_bangumi_points, get_bangumi_subject
    )
    metadata.update(fallback_meta)

    if fallback_meta.get("write_through"):
        metadata["data_origin"] = "api"
    else:
        metadata["data_origin"] = "db"
        logger.info("api_unavailable_using_db_cache", bangumi_id=bangumi_id)

    # Step 2: Query DB (now has fresh data from API, or cached data as fallback)
    result = await sql_agent.execute(request)
    return result, metadata
