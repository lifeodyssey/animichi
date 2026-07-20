"""Unit tests: AC1 — every tool function returns a named Pydantic model.

Introspects each ``@agent.tool`` function's return type annotation directly,
proving a future ``FastMCP.from_openapi`` would see a named model schema
instead of a generic ``dict[str, object]``.
"""

from __future__ import annotations

import typing

import pytest
from pydantic import BaseModel

from agent.agents import pilgrimage_tools, web_tools

_TOOL_FUNCTIONS: dict[str, object] = {
    "resolve_anime": pilgrimage_tools.resolve_anime,
    "search_bangumi": pilgrimage_tools.search_bangumi,
    "search_nearby": pilgrimage_tools.search_nearby,
    "plan_route": pilgrimage_tools.plan_route,
    "greet_user": pilgrimage_tools.greet_user,
    "general_qa": pilgrimage_tools.general_qa,
    "clarify": pilgrimage_tools.clarify,
    "web_search": web_tools.web_search,
    "translate_anime_title": web_tools.translate_anime_title,
}


def _return_type(func: object) -> object:
    return typing.get_type_hints(func)["return"]


def _named_models_in(annotation: object) -> list[type]:
    """Unwrap a Union/Optional annotation into its concrete named model types."""
    args = typing.get_args(annotation)
    if not args:
        return [annotation] if isinstance(annotation, type) else []
    models: list[type] = []
    for arg in args:
        if arg is not type(None):
            models.extend(_named_models_in(arg))
    return models


def test_nine_tool_functions_are_covered() -> None:
    assert len(_TOOL_FUNCTIONS) == 9


@pytest.mark.parametrize("name", sorted(_TOOL_FUNCTIONS))
def test_tool_return_type_is_not_a_bare_dict(name: str) -> None:
    annotation = _return_type(_TOOL_FUNCTIONS[name])
    assert typing.get_origin(annotation) is not dict, (
        f"{name} still returns a bare dict: {annotation}"
    )


@pytest.mark.parametrize(
    "name", sorted(n for n in _TOOL_FUNCTIONS if n != "web_search")
)
def test_tool_return_type_resolves_to_named_pydantic_models(name: str) -> None:
    """Every tool except web_search (a plain str summary) names Pydantic models."""
    annotation = _return_type(_TOOL_FUNCTIONS[name])
    models = _named_models_in(annotation)
    assert models, f"{name} has no named model in its return annotation: {annotation}"
    assert all(issubclass(m, BaseModel) for m in models), models


def test_web_search_returns_a_plain_str_by_design() -> None:
    """web_search never returned dict[str, object] — flagged, not converted."""
    assert _return_type(web_tools.web_search) is str
