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


def _imported_module_names(module: ast.Module) -> list[str]:
    names: list[str] = []
    for node in ast.walk(module):
        if isinstance(node, ast.ImportFrom):
            names.append(node.module or "")
        elif isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
    return names


class _FakeReadGateway:
    """Structural stand-in for CatalogClient; never touches the network."""

    async def resolve(self, query: str) -> object:
        return object()

    async def points_by_work_id(self, work_id: str) -> object:
        return object()

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[object]:
        return []

    async def geocode(self, query: str, *, limit: int = 5) -> list[object]:
        return []

    async def route(
        self,
        point_ids: list[str],
        *,
        origin: object | None = None,
        pacing: object | None = None,
    ) -> object:
        return object()


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
    source = Path(inspect.getfile(CatalogReadGateway)).read_text(encoding="utf-8")
    imports = _imported_module_names(ast.parse(source))
    for name in _FORBIDDEN_RUNTIME_IMPORTS:
        assert not any(item.startswith(name) for item in imports)


def test_fake_gateway_satisfies_read_protocol() -> None:
    fake = _FakeReadGateway()
    assert isinstance(fake, CatalogReadGateway)
    for name in _ALLOWED_READ_METHODS:
        assert inspect.iscoroutinefunction(getattr(fake, name))


def test_gateway_methods_are_awaitable_contracts() -> None:
    for name in _ALLOWED_READ_METHODS:
        assert inspect.iscoroutinefunction(getattr(CatalogReadGateway, name))
