"""Read-only contract tests for the catalog read gateway (#839)."""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from animichi.application.catalog_read_gateway import CatalogReadGateway
from animichi.clients.catalog_client import (
    CatalogClient,
    CatalogClientProtocol,
)

_ALLOWED_READ_METHODS = frozenset(
    {"resolve", "points_by_work_id", "nearby", "geocode", "route"}
)
_WRITE_VERBS = frozenset(
    {
        "upsert",
        "insert",
        "write",
        "update",
        "ingest",
        "save",
        "create",
        "delete",
        "post",
    }
)
_FORBIDDEN_RUNTIME_IMPORTS = ("fastapi", "pydantic_ai", "httpx")


def _gateway_methods() -> set[str]:
    return {
        name
        for name, member in inspect.getmembers(CatalogReadGateway, inspect.isfunction)
        if not name.startswith("_")
    }


def test_gateway_protocol_is_read_only() -> None:
    assert _gateway_methods() == _ALLOWED_READ_METHODS
    for name in _gateway_methods():
        assert not any(verb in name for verb in _WRITE_VERBS)


def test_catalog_client_satisfies_gateway_structural() -> None:
    client = CatalogClient("https://catalog.test")
    assert isinstance(client, CatalogReadGateway)


def test_catalog_client_protocol_extends_gateway() -> None:
    assert issubclass(CatalogClientProtocol, CatalogReadGateway)


def test_gateway_has_no_framework_runtime_imports() -> None:
    source = Path(inspect.getfile(CatalogReadGateway)).read_text()
    module = ast.parse(source)
    imports = [
        node.module or ""
        for node in ast.walk(module)
        if isinstance(node, ast.ImportFrom)
    ]
    for name in _FORBIDDEN_RUNTIME_IMPORTS:
        assert not any(item.startswith(name) for item in imports)
