"""Unit tests: AC2 — tool_state is threaded via explicit ToolState parameters.

Every function that reads/writes the shared per-run tool state now declares
that parameter as ``ToolState`` (a nominal NewType), never a bare, anonymous
``dict[str, object]`` mixed in with unrelated positional dict arguments.
"""

from __future__ import annotations

import typing

from agent.agents import catalog_tools, pilgrimage_agent
from agent.agents.tool_state import ToolState

_STATE_READING_FUNCTIONS: dict[str, object] = {
    "_add_resolve_context": pilgrimage_agent._add_resolve_context,
    "_add_search_context": pilgrimage_agent._add_search_context,
    "_add_nearby_context": pilgrimage_agent._add_nearby_context,
    "_add_clarify_context": pilgrimage_agent._add_clarify_context,
    "_bangumi_search_query": catalog_tools._bangumi_search_query,
    "_geocode_for_catalog": catalog_tools._geocode_for_catalog,
    "_point_ids_from_state": catalog_tools._point_ids_from_state,
}


def test_five_state_reading_functions_and_more_are_covered() -> None:
    assert len(_STATE_READING_FUNCTIONS) == 7


def test_every_state_reading_function_declares_tool_state_param() -> None:
    for name, func in _STATE_READING_FUNCTIONS.items():
        hints = typing.get_type_hints(func)
        assert ToolState in hints.values(), (
            f"{name} does not declare a ToolState-typed parameter: {hints}"
        )


def test_runtime_deps_tool_state_field_is_tool_state_typed() -> None:
    from agent.agents.runtime_deps import RuntimeDeps

    hints = typing.get_type_hints(RuntimeDeps)
    assert hints["tool_state"] is ToolState
