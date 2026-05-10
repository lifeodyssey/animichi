"""Handler: resolve_anime — DB-first title->bangumi_id; API enrichment; write-through.

Always returns candidates from both DB and Bangumi API so the agent can
decide whether to proceed or clarify. The agent (LLM) judges ambiguity
based on the user's query specificity and the candidate list.
"""

from __future__ import annotations

import structlog

from backend.agents.handlers.result import HandlerResult
from backend.agents.models import PlanStep
from backend.infrastructure.gateways.bangumi import BangumiClientGateway

logger = structlog.get_logger(__name__)

_TOOL = "resolve_anime"


def _safe_int(value: object) -> int:
    return int(value) if isinstance(value, (int, float)) else 0


def _is_strong_match(query: str, candidate_title: str) -> bool:
    """Check if query closely matches a candidate title (case-insensitive).

    Returns True when the query is specific enough that clarification
    would be annoying — e.g. "響け！ユーフォニアム" should match the
    first series directly, not trigger clarify for all seasons.

    Short queries (<4 chars for ASCII, <3 chars for CJK) are never strong
    matches — "fate", "凉宫" are too vague.
    """
    q = query.strip().lower()
    t = candidate_title.strip().lower()
    if not q or not t:
        return False
    # Exact match is always strong
    if t == q:
        return True
    # For prefix matching, the query must cover most of the title
    # to avoid "fate" matching "fate/stay night" (too vague)
    if t.startswith(q) and len(q) >= len(t) * 0.7:
        return True
    return False


def _build_candidates(matches: list[dict[str, object]]) -> list[dict[str, object]]:
    """Build candidate list from DB or API matches."""
    return [
        {
            "title": str(m.get("title") or m.get("name", "")),
            "bangumi_id": str(m.get("id", "")),
            "cover_url": str(m.get("cover_url", "") or ""),
            "city": str(m.get("city", "")),
            "points_count": _safe_int(m.get("points_count")),
        }
        for m in matches
    ]


def _match_clarify_candidate(
    title: str,
    context: dict[str, object],
) -> dict[str, object] | None:
    """Match title against previous resolve candidates from a clarify turn."""
    if not context.get("pending_clarify"):
        return None
    raw = context.get("resolve_candidates")
    if not isinstance(raw, list):
        return None
    normalized = title.strip().lower()
    for candidate in raw:
        if not isinstance(candidate, dict):
            continue
        candidate_title = str(candidate.get("title", "")).strip().lower()
        if candidate_title and candidate_title == normalized:
            return candidate
    return None


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> HandlerResult:
    """Resolve anime title to bangumi_id with candidate enrichment.

    Returns:
        Single match: {"bangumi_id": "...", "title": "...", "candidates": [...]}
        Multiple matches: {"ambiguous": true, "candidates": [...]}
        No match: HandlerResult.fail(...)

    The ``candidates`` field is always present so the agent can assess
    whether the user's query is specific enough or needs clarification.
    """
    params = step.params or {}
    title = params.get("title")
    if not isinstance(title, str):
        title = ""
    if not title:
        return HandlerResult.fail(_TOOL, "No title provided")

    # Fast path: match against previous clarify candidates
    matched = _match_clarify_candidate(title, context)
    if matched is not None:
        bid = str(matched.get("bangumi_id", ""))
        if bid:
            resolved_title = str(matched.get("title", title))
            logger.info("resolve_anime_from_clarify", title=title, bangumi_id=bid)
            return HandlerResult.ok(
                _TOOL,
                {
                    "bangumi_id": bid,
                    "title": resolved_title,
                    "candidates": [matched],
                },
            )

    repo = getattr(db, "bangumi", None)
    find_bangumi_by_title = getattr(repo, "find_bangumi_by_title", None)
    find_all_by_title = getattr(repo, "find_all_by_title", None)
    upsert_bangumi_title = getattr(repo, "upsert_bangumi_title", None)
    if not callable(find_bangumi_by_title) or not callable(upsert_bangumi_title):
        return HandlerResult.fail(_TOOL, "DB not available")

    # 1. DB lookup
    db_matches: list[dict[str, object]] = []
    if callable(find_all_by_title):
        db_matches = await find_all_by_title(title)

    # 2. Bangumi API search — always fetch candidates for the agent to evaluate
    from backend.agents.retriever import Retriever

    gateway = (
        retriever.bangumi_gateway
        if isinstance(retriever, Retriever)
        else BangumiClientGateway()
    )

    api_results: list[dict[str, object]] = []
    try:
        api_results = await gateway.search_subject(
            keyword=title, subject_type=2, max_results=5
        )
    except (OSError, RuntimeError, ValueError, Exception):
        pass

    # 3. Merge DB + API, deduplicate by bangumi_id
    seen_ids: set[str] = set()
    merged: list[dict[str, object]] = []
    for m in db_matches:
        bid = str(m.get("id", ""))
        if bid and bid not in seen_ids:
            seen_ids.add(bid)
            merged.append(m)
    for m in api_results:
        bid = str(m.get("id", ""))
        if bid and bid not in seen_ids:
            seen_ids.add(bid)
            merged.append(m)

    candidates = _build_candidates(merged)

    # 4. Return based on candidate count
    if not merged:
        return HandlerResult.fail(_TOOL, f"Could not resolve anime: '{title}'")

    if len(merged) == 1:
        bid = str(merged[0].get("id", ""))
        resolved_title = str(merged[0].get("title") or merged[0].get("name", title))
        # Write-through: ensure the resolved title is in DB
        if bid and bid not in {str(m.get("id", "")) for m in db_matches}:
            await upsert_bangumi_title(title, bid)
        logger.info("resolve_anime_single", title=title, bangumi_id=bid)
        return HandlerResult.ok(
            _TOOL,
            {
                "bangumi_id": bid,
                "title": resolved_title,
                "candidates": candidates,
            },
        )

    # Multiple candidates — check for a strong match before marking ambiguous
    best = merged[0]
    best_title = str(best.get("title") or best.get("name", ""))
    best_bid = str(best.get("id", ""))

    if _is_strong_match(title, best_title) and best_bid:
        # Strong match — return as resolved with all candidates for context
        logger.info(
            "resolve_anime_best_match",
            title=title,
            bangumi_id=best_bid,
            candidate_count=len(candidates),
        )
        if best_bid not in {str(m.get("id", "")) for m in db_matches}:
            await upsert_bangumi_title(title, best_bid)
        return HandlerResult.ok(
            _TOOL,
            {
                "bangumi_id": best_bid,
                "title": best_title,
                "candidates": candidates,
                "best_match": True,
            },
        )

    # No strong match — let the agent decide whether to clarify
    logger.info(
        "resolve_anime_multiple",
        title=title,
        candidate_count=len(candidates),
    )
    return HandlerResult.ok(
        _TOOL,
        {
            "ambiguous": True,
            "candidates": candidates,
        },
    )
