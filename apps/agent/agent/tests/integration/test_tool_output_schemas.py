"""Integration test: AC4 — tool result models generate proper output schemas.

S7.8's stated goal is clearing the typing prerequisite for a future
``FastMCP.from_openapi`` MCP server (S7.4) so it can generate a per-tool
``outputSchema``. No FastMCP wiring exists yet in this codebase (S7.4 is a
separate, not-yet-started story) — this test instead proves the artifact
FastMCP.from_openapi would need: every tool function's return annotation
resolves to named Pydantic model(s) whose ``model_json_schema()`` exposes
concrete, named ``properties`` — not a generic ``{"type": "object"}`` schema
with no shape. No DB, no live model — pure static/schema introspection.
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
    "translate_anime_title": web_tools.translate_anime_title,
}


def _named_models_in(annotation: object) -> list[type[BaseModel]]:
    """Unwrap a Union/Optional annotation into its concrete named model types."""
    args = typing.get_args(annotation)
    if not args:
        return (
            [annotation]
            if isinstance(annotation, type) and issubclass(annotation, BaseModel)
            else []
        )
    models: list[type[BaseModel]] = []
    for arg in args:
        if arg is not type(None):
            models.extend(_named_models_in(arg))
    return models


def _models_for(name: str) -> list[type[BaseModel]]:
    annotation = typing.get_type_hints(_TOOL_FUNCTIONS[name])["return"]
    return _named_models_in(annotation)


@pytest.mark.parametrize("name", sorted(_TOOL_FUNCTIONS))
def test_tool_return_schema_has_named_properties(name: str) -> None:
    """Each tool's model(s) expose real field names, not a generic object schema."""
    models = _models_for(name)
    assert models, f"{name} resolves to no Pydantic model"
    for model in models:
        schema = model.model_json_schema()
        assert schema.get("type") == "object"
        assert schema.get("properties"), (
            f"{model.__name__} (from {name}) has no named properties: {schema}"
        )


@pytest.mark.parametrize("name", sorted(_TOOL_FUNCTIONS))
def test_tool_return_schema_property_names_are_not_generic(name: str) -> None:
    """Guard against silently regressing back to a dict[str, object]-shaped model."""
    for model in _models_for(name):
        properties = model.model_json_schema()["properties"]
        assert set(properties) != {"key", "value"}, model.__name__
        assert all(isinstance(key, str) and key for key in properties)
