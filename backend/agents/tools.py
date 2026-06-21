"""Deterministic runtime helper tools (no LLM calls).

These helpers are used by the main pilgrimage runtime agent to enrich and
shape payloads for the frontend journey contract.
"""

from __future__ import annotations

import structlog

from backend.agents.runtime_deps import RuntimeDeps
from backend.clients.catalog_client import PilgrimagePoint

logger = structlog.get_logger(__name__)

# Catalog/DB calls can raise these on transient failures.
_IO_ERRORS = (OSError, RuntimeError, ValueError)


async def enrich_clarify_candidates(
    deps: RuntimeDeps, titles: list[str]
) -> list[dict[str, object]]:
    """Enrich clarify candidate titles with cover/city/spot_count.

    DB-first → Catalog fallback → write-through (best-effort). The clarify path
    is catalog-only: it never calls an upstream Anitabi/Bangumi gateway.

    When no enrichment data is available, returns safe minimal candidates.
    """
    if not titles:
        return []

    by_title = await _db_lookup(deps, titles)

    candidates: list[dict[str, object]] = []
    for title in titles:
        row = by_title.get(title, {})
        bangumi_id = row.get("bangumi_id")

        if isinstance(bangumi_id, str) and bangumi_id:
            candidates.append(_candidate_from_row(title, row))
            continue

        fallback = await _catalog_fallback(deps, title)
        candidates.append(fallback)

    return candidates


async def _db_lookup(
    deps: RuntimeDeps, titles: list[str]
) -> dict[str, dict[str, object]]:
    """Look up candidate details from the DB, keyed by title."""
    repo = getattr(deps.db, "bangumi", None)
    find_fn = getattr(repo, "find_candidate_details_by_titles", None)
    if not callable(find_fn):
        return {}
    try:
        rows_obj: object = await find_fn(titles)
    except _IO_ERRORS:
        logger.warning("clarify_db_lookup_failed")
        return {}
    if not isinstance(rows_obj, list):
        return {}
    result: dict[str, dict[str, object]] = {}
    for r in rows_obj:
        if isinstance(r, dict):
            t = r.get("title")
            if isinstance(t, str) and t:
                result[t] = r
    return result


def _candidate_from_row(title: str, row: dict[str, object]) -> dict[str, object]:
    """Build a candidate dict from a DB row."""
    cover_url = row.get("cover_url")
    points_count = row.get("points_count")
    city = row.get("city")
    return {
        "title": title,
        "cover_url": cover_url if isinstance(cover_url, str) and cover_url else None,
        "spot_count": int(points_count or 0)
        if isinstance(points_count, int | float)
        else 0,
        "city": str(city or "") if isinstance(city, str | None) else "",
    }


async def _catalog_fallback(deps: RuntimeDeps, title: str) -> dict[str, object]:
    """Resolve via the Catalog service and write-through (best-effort).

    The first search hit carries the candidate's ``bangumi_id`` + ``cover_url``;
    ``spot_count`` is the number of points the catalog returned for the work.
    Catalog errors degrade gracefully to a minimal candidate, matching the
    prior gateway-fallback resilience.
    """
    points = await _catalog_search(deps, title)
    first = points[0] if points else None

    if first is None:
        return _minimal_candidate(title)

    cover_url = first.cover_url or None
    await _write_through(deps, title, first.bangumi_id, cover_url)
    return {
        "title": title,
        "cover_url": cover_url,
        "spot_count": len(points),
        "city": "",
    }


async def _catalog_search(deps: RuntimeDeps, title: str) -> list[PilgrimagePoint]:
    """Search the Catalog for a title; empty list on any error (best-effort)."""
    try:
        return await deps.catalog.search(title)
    except _IO_ERRORS:
        logger.warning("clarify_catalog_search_failed", title=title)
        return []


def _minimal_candidate(title: str) -> dict[str, object]:
    """A safe candidate when the catalog yields no enrichment data."""
    return {"title": title, "cover_url": None, "spot_count": 0, "city": ""}


async def _write_through(
    deps: RuntimeDeps,
    title: str,
    bangumi_id: str,
    cover_url: str | None,
) -> None:
    """Write-through title and cover to DB (best-effort)."""
    repo = getattr(deps.db, "bangumi", None)
    upsert_title = getattr(repo, "upsert_bangumi_title", None)
    upsert_bangumi = getattr(repo, "upsert_bangumi", None)
    if callable(upsert_title):
        try:
            await upsert_title(title, bangumi_id)
        except _IO_ERRORS:
            logger.warning("clarify_upsert_title_failed", title=title)
    if callable(upsert_bangumi) and cover_url is not None:
        try:
            await upsert_bangumi(bangumi_id, title=title, cover_url=cover_url)
        except _IO_ERRORS:
            logger.warning("clarify_upsert_bangumi_failed", bangumi_id=bangumi_id)
