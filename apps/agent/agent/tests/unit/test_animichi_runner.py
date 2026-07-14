"""Unit tests for animichi_runner helper functions."""

from __future__ import annotations

from agent.agents.animichi_runner import _seed_tool_state
from agent.agents.runtime_deps import RuntimeDeps
from agent.interfaces.response_builder import _status_from_payload
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def test_seed_tool_state_sets_locale() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(
        db=MagicMock(), locale="zh", query="test", catalog=MockCatalogClient()
    )
    _seed_tool_state(deps, None)
    assert deps.tool_state.locale == "zh"


def test_seed_tool_state_with_context() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(
        db=MagicMock(), locale="ja", query="test", catalog=MockCatalogClient()
    )
    context = {
        "last_location": "宇治",
        "origin_lat": 34.886,
        "origin_lng": 135.805,
        "last_search_data": {
            "search_bangumi": {"rows": [], "row_count": 0},
        },
    }
    _seed_tool_state(deps, context)
    assert deps.tool_state.last_location == "宇治"
    import pytest

    assert deps.tool_state.origin_lat == pytest.approx(34.886)
    assert deps.tool_state.origin_lng == pytest.approx(135.805)
    assert deps.tool_state.search_bangumi is not None


def test_seed_tool_state_ignores_non_string_location() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(
        db=MagicMock(), locale="en", query="test", catalog=MockCatalogClient()
    )
    _seed_tool_state(deps, {"last_location": 123})
    assert deps.tool_state.last_location is None


def test_seed_tool_state_ignores_non_dict_search_data() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(
        db=MagicMock(), locale="en", query="test", catalog=MockCatalogClient()
    )
    _seed_tool_state(deps, {"last_search_data": "not_a_dict"})
    assert deps.tool_state.search_bangumi is None


def test_seed_tool_state_restores_clarify_context() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(
        db=MagicMock(),
        locale="zh",
        query="涼宮ハルヒの憂鬱",
        catalog=MockCatalogClient(),
    )
    context: dict[str, object] = {
        "pending_clarify": True,
        "resolve_candidates": [
            {"title": "涼宮ハルヒの憂鬱", "bangumi_id": "100"},
            {"title": "涼宮ハルヒの消失", "bangumi_id": "101"},
        ],
    }
    _seed_tool_state(deps, context)

    assert deps.tool_state.pending_clarify is True
    candidates = deps.tool_state.resolve_candidates
    assert candidates is not None
    assert len(candidates) == 2


def test_seed_tool_state_omits_clarify_when_absent() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(
        db=MagicMock(), locale="en", query="test", catalog=MockCatalogClient()
    )
    _seed_tool_state(deps, {"last_location": "Uji"})
    assert deps.tool_state.pending_clarify is None
    assert deps.tool_state.resolve_candidates is None


def test_seed_tool_state_restores_flat_search_data() -> None:
    """last_search_data with 'rows' key populates search_bangumi directly."""
    from unittest.mock import MagicMock

    deps = RuntimeDeps(
        db=MagicMock(), locale="en", query="plan route", catalog=MockCatalogClient()
    )
    context: dict[str, object] = {
        "last_search_data": {
            "rows": [{"bangumi_id": "485", "name": "北高校"}],
            "row_count": 1,
            "status": "ok",
        },
    }
    _seed_tool_state(deps, context)
    assert deps.tool_state.search_bangumi is not None
    assert deps.tool_state.search_bangumi.row_count == 1


def test_status_from_payload_extracts_status() -> None:
    assert _status_from_payload({"status": "ok"}, fallback="err") == "ok"


def test_status_from_payload_uses_fallback_for_missing() -> None:
    assert _status_from_payload({}, fallback="err") == "err"
    assert _status_from_payload(None, fallback="err") == "err"
    assert _status_from_payload("not_a_dict", fallback="err") == "err"


def test_status_from_payload_uses_fallback_for_empty_string() -> None:
    assert _status_from_payload({"status": ""}, fallback="err") == "err"
