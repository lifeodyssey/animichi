"""Unit tests: selected-route degradation for typed catalog errors.

Sibling of test_selected_route.py (200-line file cap). Asserts the
category-driven, localized user messages replace the old generic string for
typed errors — while untyped failures keep the legacy fallback.
"""

from __future__ import annotations

from agent.agents.agent_result import RejectedRoute
from agent.agents.selected_route import execute_selected_route
from agent.agents.session_state import SessionState
from agent.clients.catalog_client import Route
from agent.clients.catalog_errors import (
    RouteTooManyClustersData,
    RouteTooManyClustersError,
    UpstreamUnavailableData,
    UpstreamUnavailableError,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient


class _TooManyClustersCatalog(MockCatalogClient):
    async def route(
        self, point_ids: list[str], *, origin: tuple[float, float] | None = None
    ) -> Route:
        raise RouteTooManyClustersError(
            RouteTooManyClustersData(cluster_count=62, max_clusters=50)
        )


class _UpstreamDownCatalog(MockCatalogClient):
    async def route(
        self, point_ids: list[str], *, origin: tuple[float, float] | None = None
    ) -> Route:
        raise UpstreamUnavailableError(UpstreamUnavailableData(upstream="bangumi"))


class _MalformedCatalog(MockCatalogClient):
    async def route(
        self, point_ids: list[str], *, origin: tuple[float, float] | None = None
    ) -> Route:
        return Route.model_validate({"point_count": 1})


async def test_too_many_clusters_returns_actionable_message_en() -> None:
    result = await execute_selected_route(
        point_ids=["p1"],
        state=SessionState(),
        origin=None,
        locale="en",
        catalog=_TooManyClustersCatalog(),
    )

    assert result.success is False
    assert result.output.message == (
        "Too many spots selected (62 areas). Please narrow your "
        "selection to at most 50 areas and try again."
    )


async def test_too_many_clusters_returns_actionable_message_ja() -> None:
    result = await execute_selected_route(
        point_ids=["p1"],
        state=SessionState(),
        origin=None,
        locale="ja",
        catalog=_TooManyClustersCatalog(),
    )

    assert result.success is False
    assert "62" in result.output.message
    assert "50エリア" in result.output.message


async def test_retryable_error_returns_try_again_message() -> None:
    result = await execute_selected_route(
        point_ids=["p1"],
        state=SessionState(),
        origin=None,
        locale="en",
        catalog=_UpstreamDownCatalog(),
    )

    assert result.success is False
    assert result.output.message == (
        "The catalog service is temporarily unavailable. Please try again in a moment."
    )


async def test_catalog_contract_violation_is_typed_without_exposing_details() -> None:
    result = await execute_selected_route(
        point_ids=["p1"],
        state=SessionState(),
        origin=None,
        locale="en",
        catalog=_MalformedCatalog(),
    )

    assert result.output.message == "Catalog route unavailable"
    assert result.steps[0].provenance == RejectedRoute(status="contract_violation")
