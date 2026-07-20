"""Unit tests for the explicit ToolState type.

ToolState replaces the implicit convention of threading a bare
``dict[str, object]`` through tool/handler call chains — a NewType gives
every signature a self-documenting, nominal type while remaining a plain
dict at runtime (zero behavior change).
"""

from __future__ import annotations

from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_state import ToolState, new_tool_state
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def test_new_tool_state_returns_empty_dict() -> None:
    assert new_tool_state() == {}


def test_new_tool_state_supports_dict_mutation() -> None:
    state = new_tool_state()
    state["resolve_anime"] = {"bangumi_id": "1"}
    assert state["resolve_anime"] == {"bangumi_id": "1"}


def test_tool_state_wraps_plain_dict_unchanged() -> None:
    raw: dict[str, object] = {"pending_clarify": True}
    assert ToolState(raw) is raw


def test_runtime_deps_tool_state_defaults_to_new_tool_state() -> None:
    deps = RuntimeDeps(db=object(), locale="ja", query="q", catalog=MockCatalogClient())
    assert deps.tool_state == {}


def test_runtime_deps_tool_state_instances_are_independent() -> None:
    deps_a = RuntimeDeps(
        db=object(), locale="ja", query="q", catalog=MockCatalogClient()
    )
    deps_b = RuntimeDeps(
        db=object(), locale="ja", query="q", catalog=MockCatalogClient()
    )
    deps_a.tool_state["resolve_anime"] = {"bangumi_id": "1"}
    assert deps_b.tool_state == {}
