"""Unit tests: localized user-facing messages for typed catalog errors."""

from __future__ import annotations

from agent.agents.error_messages import build_error_message
from agent.clients.catalog_errors import (
    RouteTooManyClustersData,
    RouteTooManyClustersError,
    RouteTooManyPointsData,
    RouteTooManyPointsError,
    UpstreamUnavailableData,
    UpstreamUnavailableError,
    WorkNotFoundData,
    WorkNotFoundError,
)
from agent.clients.errors import APIError

_FALLBACK = "Catalog route unavailable"


def _too_many() -> RouteTooManyClustersError:
    return RouteTooManyClustersError(
        RouteTooManyClustersData(cluster_count=62, max_clusters=50)
    )


def test_too_many_clusters_en_renders_numbers() -> None:
    message = build_error_message(_too_many(), "en", fallback=_FALLBACK)

    assert message == (
        "Too many spots selected (62 areas). Please narrow your "
        "selection to at most 50 areas and try again."
    )


def test_too_many_clusters_ja_renders_numbers() -> None:
    message = build_error_message(_too_many(), "ja", fallback=_FALLBACK)

    assert "62" in message
    assert "50" in message
    assert "エリア" in message


def test_too_many_clusters_zh_renders_numbers() -> None:
    message = build_error_message(_too_many(), "zh", fallback=_FALLBACK)

    assert "62" in message
    assert "50" in message
    assert "取景地" in message


def test_too_many_points_en_renders_numbers() -> None:
    exc = RouteTooManyPointsError(
        RouteTooManyPointsData(point_count=501, max_points=500)
    )
    message = build_error_message(exc, "en", fallback=_FALLBACK)

    assert message == "Too many spots selected (501). Please select at most 500 points."


def test_work_not_found_localized() -> None:
    exc = WorkNotFoundError(WorkNotFoundData(bangumi_id="8000"))
    message = build_error_message(exc, "en", fallback=_FALLBACK)

    assert message == "No pilgrimage spots found for this work. Try a different anime."


def test_code_without_template_falls_back_to_category() -> None:
    """UPSTREAM_UNAVAILABLE has no code template -> retryable category text."""
    exc = UpstreamUnavailableError(UpstreamUnavailableData(upstream="bangumi"))
    message = build_error_message(exc, "en", fallback=_FALLBACK)

    assert message == (
        "The catalog service is temporarily unavailable. Please try again in a moment."
    )


def test_unknown_locale_falls_back_to_english() -> None:
    message = build_error_message(_too_many(), "fr", fallback=_FALLBACK)

    assert message.startswith("Too many spots selected (62 areas).")


def test_non_catalog_error_returns_fallback() -> None:
    message = build_error_message(APIError("HTTP 500 from u"), "en", fallback=_FALLBACK)

    assert message == _FALLBACK


def test_wire_text_never_appears_in_user_message() -> None:
    """The user message is authored locally — no exception str() echo."""
    exc = UpstreamUnavailableError(UpstreamUnavailableData(upstream="anitabi"))
    message = build_error_message(exc, "zh", fallback=_FALLBACK)

    assert str(exc) not in message
