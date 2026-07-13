"""Exception handling tests for the web search tool."""

from __future__ import annotations

from typing import cast
from unittest.mock import MagicMock

import httpx
from ddgs.exceptions import RatelimitException
from pydantic_ai import RunContext

from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.web_tools import web_search


def _ctx_with_error(exc: Exception) -> RunContext[RuntimeDeps]:
    async def _raise(_query: str) -> list[object]:
        raise exc

    ctx = MagicMock()
    ctx.deps = MagicMock(spec=RuntimeDeps)
    ctx.deps.web_searcher = _raise
    return cast(RunContext[RuntimeDeps], ctx)


async def test_connect_timeout_returns_graceful_failure() -> None:
    result = await web_search(
        _ctx_with_error(httpx.ConnectTimeout("connect timed out")), query="query"
    )

    assert result.startswith("Search failed for")


async def test_ddgs_rate_limit_returns_graceful_failure() -> None:
    result = await web_search(
        _ctx_with_error(RatelimitException("ratelimited")), query="query"
    )

    assert result.startswith("Search failed for")
