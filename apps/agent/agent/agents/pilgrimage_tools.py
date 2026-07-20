"""Tool registrations for the PydanticAI pilgrimage agent.

The four data tools (resolve_anime / search_bangumi / search_nearby /
plan_route) are catalog-only: they route exclusively through the injected
:class:`CatalogClientProtocol` and make ZERO upstream calls (no DB Retriever,
no Anitabi/Bangumi gateways). The ephemeral tools (greet_user / general_qa /
clarify) echo LLM-supplied payloads without any read path.

Step/plumbing helpers live in ``tool_runtime``; the catalog read path lives in
``catalog_tools``. Import this module after ``pilgrimage_agent`` is created so
the decorators can attach to it.
"""

from __future__ import annotations

import structlog
from pydantic_ai import ModelRetry, RunContext

from agent.agents.catalog_tools import (
    _bangumi_search_query,
    _run_catalog_nearby,
    _run_catalog_route,
    _run_catalog_search,
)
from agent.agents.handlers import execute_answer_question, execute_greet_user
from agent.agents.models import ToolName
from agent.agents.pilgrimage_agent import pilgrimage_agent
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_results import (
    ClarifyToolResult,
    MessageToolResult,
    ResolveAnimeResult,
    RouteToolResult,
    SearchToolPreview,
    SearchToolResult,
)
from agent.agents.tool_runtime import _run_ephemeral, run_clarify
from agent.clients.catalog_client import CatalogClientProtocol

logger = structlog.get_logger(__name__)


def _require_catalog(deps: RuntimeDeps) -> CatalogClientProtocol:
    """Return the catalog client or fail loudly if it was never injected.

    The agent is catalog-only: data tools must never fall back to the DB
    Retriever or upstream gateways, so a missing client is a wiring error.
    """
    if deps.catalog is None:
        raise RuntimeError("catalog client not configured")
    return deps.catalog


@pilgrimage_agent.tool
async def resolve_anime(
    ctx: RunContext[RuntimeDeps], title: str
) -> ResolveAnimeResult | None:
    """Look up an anime by title and return its unique database identifier.

    Call this FIRST whenever the user mentions an anime by name.

    Returns on success: {"bangumi_id": "160209", "title": "君の名は。", "candidates": [...]}
    Returns on ambiguity: {"ambiguous": true, "candidates": [{"title": ..., "bangumi_id": ...}, ...]}
    Returns on failure: {"error": "Could not resolve anime: 'xyz'"}

    The "candidates" list is ALWAYS present and shows all matching anime works
    found in the database and Bangumi API. Use it to judge whether the user's
    query is specific enough:
    - If "ambiguous": true → MUST call clarify() with the candidates.
    - If single bangumi_id returned but candidates has multiple entries AND the
      user's query is short/vague → call clarify() to let the user pick.
    - If query is specific (full title) → proceed with search_bangumi.

    Args:
        title: The anime title in any language. Examples: "君の名は", "你的名字",
               "Your Name", "響け", "凉宫"
    """
    params: dict[str, object] = {"title": title}
    return await _run_catalog_search(
        ctx,
        _require_catalog(ctx.deps),
        tool=ToolName.RESOLVE_ANIME,
        query=title,
        params=params,
    )


@pilgrimage_agent.tool
async def search_bangumi(
    ctx: RunContext[RuntimeDeps],
    bangumi_id: str = "",
    *,
    episode: int = -1,
    force_refresh: bool = False,
) -> SearchToolResult | SearchToolPreview | None:
    """Find real-world pilgrimage filming locations for a specific anime.

    Call this AFTER resolve_anime returns a bangumi_id.
    If bangumi_id is empty, it will be read from the previous resolve_anime result.

    Returns: {"rows": [...points...], "row_count": 5, "status": "ok"}
    Each row contains: id, name, name_cn, latitude, longitude, episode, screenshot_url

    If no points are found in the database, the system will automatically try to
    fetch them from the Anitabi API and write them to the database.

    Args:
        bangumi_id: The anime's unique ID from resolve_anime. Leave empty if
                    resolve_anime was called in a previous step.
        episode: Episode number to filter results. Use -1 for all episodes.
        force_refresh: Set True only if the user explicitly asks to refresh data.
    """
    resolved_id = bangumi_id or None
    if not resolved_id:
        resolve_data = ctx.deps.tool_state.get("resolve_anime")
        if isinstance(resolve_data, dict):
            resolved_id = resolve_data.get("bangumi_id")
    if not resolved_id:
        raise ModelRetry(
            "Call resolve_anime(title) first to get a bangumi_id, "
            "then pass it to search_bangumi."
        )
    resolved_episode = episode if episode >= 0 else None
    params: dict[str, object] = {
        "episode": resolved_episode,
        "force_refresh": force_refresh,
        "bangumi_id": resolved_id,
        "bangumi": resolved_id,
    }
    catalog = _require_catalog(ctx.deps)
    query = _bangumi_search_query(ctx.deps.tool_state, resolved_id)
    return await _run_catalog_search(
        ctx,
        catalog,
        tool=ToolName.SEARCH_BANGUMI,
        query=query,
        params=params,
    )


@pilgrimage_agent.tool
async def search_nearby(
    ctx: RunContext[RuntimeDeps],
    *,
    location: str,
    radius: int = 0,
) -> SearchToolResult | SearchToolPreview | None:
    """Find anime pilgrimage spots near a real-world location using geo search.

    Use this for location-based queries like "宇治站附近", "spots near Kyoto".
    Do NOT call resolve_anime first — this tool searches by geography, not by anime.

    Returns: {"rows": [...points with distance_m...], "row_count": 3, "status": "ok"}
    Each row includes distance_m (meters from the search center).

    Args:
        location: A place name like "宇治駅", "Kyoto Station", "秋葉原", "Kamakura".
                  Use the most specific name the user provided.
        radius: Search radius in meters. Default is 5000 (5km). Use 0 for default.
                Use smaller radius for specific stations, larger for cities.
    """
    params: dict[str, object] = {"location": location}
    if radius > 0:
        params["radius"] = radius
    return await _run_catalog_nearby(
        ctx,
        _require_catalog(ctx.deps),
        location=location,
        radius=radius,
        params=params,
    )


@pilgrimage_agent.tool
async def plan_route(
    ctx: RunContext[RuntimeDeps],
    *,
    origin: str = "",
    pacing: str = "",
    start_time: str = "",
) -> RouteToolResult | None:
    """Create an optimized walking route from the pilgrimage points found by search_bangumi.

    IMPORTANT: You must call search_bangumi BEFORE this tool. plan_route uses
    the search results to create a walking route with a timed itinerary.

    Returns: {"ordered_points": [...], "point_count": 5, "timed_itinerary": {...},
              "status": "ok"}
    The timed_itinerary includes stops, legs, total_minutes, total_distance_m.

    Args:
        origin: Departure station/location. Examples: "東京駅", "京都駅".
                Leave empty if the user doesn't mention a starting point.
        pacing: Walking pace — "chill" (slow), "normal", or "packed" (fast).
                Leave empty for default "normal" pace.
        start_time: Departure time as "HH:MM". Leave empty for default "09:00".
    """
    search_data = ctx.deps.tool_state.get("search_bangumi") or ctx.deps.tool_state.get(
        "search_nearby"
    )
    if not isinstance(search_data, dict) or not search_data.get("rows"):
        raise ModelRetry(
            "Call search_bangumi or search_nearby first to get pilgrimage points, "
            "then call plan_route to create the walking route."
        )
    params: dict[str, object] = {}
    if origin:
        params["origin"] = origin
    if pacing:
        params["pacing"] = pacing
    if start_time:
        params["start_time"] = start_time
    return await _run_catalog_route(ctx, _require_catalog(ctx.deps), params=params)


@pilgrimage_agent.tool
async def greet_user(
    ctx: RunContext[RuntimeDeps], message: str
) -> MessageToolResult | None:
    """Respond to greetings and "what can you do?" questions.

    Use ONLY for: "hi", "hello", "你好", "こんにちは", "你是谁", "what can you do?",
    "thanks", "ありがとう", "谢谢", "goodbye".

    Do NOT use this if the greeting is followed by a real query.
    Example: "你好，宇治站附近有什么？" → use search_nearby, NOT greet_user.

    Args:
        message: A friendly introduction in the user's language (2-4 sentences).
                 Include 2-3 example queries the user can try.
    """
    return await _run_ephemeral(
        ctx,
        tool=ToolName.GREET_USER,
        params={"message": message},
        handler=execute_greet_user,
    )


@pilgrimage_agent.tool
async def general_qa(
    ctx: RunContext[RuntimeDeps], answer: str
) -> MessageToolResult | None:
    """Answer general questions about anime pilgrimage (etiquette, tips, costs, planning).

    Use for questions like:
    - "圣地巡礼有什么注意事项？" (pilgrimage etiquette)
    - "聖地巡礼のマナーを教えて" (pilgrimage manners)
    - "How much does an anime pilgrimage cost?"
    - "What should I bring for a pilgrimage trip?"

    Do NOT use this for anime-specific queries (use resolve_anime + search instead).
    Do NOT use this for greetings (use greet_user instead).

    Args:
        answer: Your helpful answer about pilgrimage in the user's language.
    """
    return await _run_ephemeral(
        ctx,
        tool=ToolName.ANSWER_QUESTION,
        params={"answer": answer},
        handler=execute_answer_question,
    )


@pilgrimage_agent.tool
async def clarify(
    ctx: RunContext[RuntimeDeps],
    *,
    question: str,
    options: list[str] | None = None,
) -> ClarifyToolResult:
    """Ask the user a clarification question when you cannot proceed confidently.

    Use when:
    - resolve_anime returns "ambiguous": true (multiple anime match the query)
    - The user's query is too vague to determine intent
    - A nearby search needs a location but none was provided

    The tool will automatically enrich the candidate titles with cover art,
    spot count, and city information from the database.

    Args:
        question: The clarification question in the user's language.
                  Example: "你是指哪部凉宫？" or "Which anime do you mean?"
        options: List of candidate anime titles to show the user.
                 Example: ["涼宮ハルヒの憂鬱", "涼宮ハルヒの消失"]
    """
    return await run_clarify(ctx.deps, question=question, options=options)
