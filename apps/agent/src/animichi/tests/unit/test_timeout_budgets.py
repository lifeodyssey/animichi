"""Cross-layer timeout budget invariants."""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest

from animichi.agents.animichi_tools import CATALOG_TOOL_TIMEOUT_SECONDS
from animichi.clients.catalog_client import (
    CATALOG_REQUEST_TIMEOUT_SECONDS,
    CATALOG_TOTAL_TIMEOUT_SECONDS,
    CatalogClient,
)
from animichi.clients.errors import TransientAPIError
from animichi.config.settings import Settings

_WEB_TIMEOUT_SOURCE = (
    Path(__file__).parents[6] / "apps/web/src/features/chat/use-turn-timeout.ts"
)
_MIN_TYPED_TIMEOUT_DELIVERY_MARGIN_SECONDS = 10


async def test_catalog_budget_nests_inside_tool_and_agent_timeouts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deadlines: list[float] = []

    @contextmanager
    def fake_fail_after(delay: float) -> Iterator[None]:
        deadlines.append(delay)
        yield
        raise TimeoutError

    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, request=request, json={"rows": []})
    )
    monkeypatch.setattr(
        "animichi.clients.catalog_client.anyio.fail_after", fake_fail_after
    )
    monkeypatch.setattr(
        "animichi.clients.catalog_client.httpx.AsyncHTTPTransport",
        lambda **_kwargs: transport,
    )

    with pytest.raises(TransientAPIError, match="exceeded 80.0s"):
        await CatalogClient("https://catalog.test").points_by_bangumi_id("8000")

    assert deadlines == [CATALOG_TOTAL_TIMEOUT_SECONDS]
    assert CATALOG_REQUEST_TIMEOUT_SECONDS < CATALOG_TOTAL_TIMEOUT_SECONDS
    assert CATALOG_TOTAL_TIMEOUT_SECONDS < CATALOG_TOOL_TIMEOUT_SECONDS
    assert CATALOG_TOOL_TIMEOUT_SECONDS < Settings().agent_deadline


def test_model_attempt_timeout_precedes_agent_deadline() -> None:
    settings = Settings()
    preamble_margin = settings.agent_deadline * 0.05
    assert (
        2 * settings.model_attempt_timeout + preamble_margin < settings.agent_deadline
    )


def test_web_watchdog_follows_the_default_agent_deadline() -> None:
    source = _WEB_TIMEOUT_SOURCE.read_text(encoding="utf-8")
    match = re.search(r"TURN_TIMEOUT_MS\s*=\s*([\d_]+)", source)
    assert match is not None
    web_timeout_seconds = int(match.group(1).replace("_", "")) / 1000
    assert web_timeout_seconds >= (
        Settings().agent_deadline + _MIN_TYPED_TIMEOUT_DELIVERY_MARGIN_SECONDS
    )


def test_invalid_model_timeout_ordering_is_rejected() -> None:
    with pytest.raises(ValueError, match="model_attempt_timeout"):
        Settings(agent_deadline=90.0, model_attempt_timeout=45.0)
