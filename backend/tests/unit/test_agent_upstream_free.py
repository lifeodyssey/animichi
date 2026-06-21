"""Guard: the agent's data-tool seam makes ZERO upstream calls.

GOAL §7 ("旧 agent 上游调用已删净") requires the four data tools to route only
through the injected :class:`CatalogClientProtocol`. This locks that invariant
two ways:

  1. Static: ``pilgrimage_tools`` / ``catalog_tools`` / ``tool_runtime`` import
     no upstream client (Anitabi/Bangumi gateways), no DB Retriever, and no
     legacy data handlers. The clarify enrichment gateway lives in ``tools``,
     not in these three modules.
  2. Behavioural: a data tool with no catalog injected raises rather than
     silently falling back to the DB/Retriever path.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import cast

import pytest

from backend.agents.pilgrimage_tools import _require_catalog
from backend.agents.runtime_deps import RuntimeDeps
from backend.clients.catalog_client import CatalogClientProtocol
from backend.domain.ports import DatabasePort

# Modules that form the catalog-only data-tool seam. These must stay free of any
# upstream/DB read path.
_SEAM_MODULES = ("pilgrimage_tools", "catalog_tools", "tool_runtime")

# Substrings that, if imported by a seam module, mean an upstream/DB read path
# leaked back in.
_FORBIDDEN_IMPORT_FRAGMENTS = (
    "gateways",  # anitabi / bangumi upstream gateways
    "retriever",  # DB Retriever read path
    "execute_resolve_anime",
    "execute_search_bangumi",
    "execute_search_nearby",
    "execute_plan_route",
    "_run_handler",
)


def _imported_names(module_name: str) -> list[str]:
    """Collect every dotted import target referenced by a seam module."""
    path = Path(__file__).parents[2] / "agents" / f"{module_name}.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names.append(module)
            names.extend(f"{module}.{alias.name}" for alias in node.names)
    return names


@pytest.mark.parametrize("module_name", _SEAM_MODULES)
def test_seam_module_has_no_upstream_imports(module_name: str) -> None:
    """No data-tool module imports an upstream gateway, Retriever, or handler."""
    imported = "\n".join(_imported_names(module_name))
    leaked = [frag for frag in _FORBIDDEN_IMPORT_FRAGMENTS if frag in imported]
    assert not leaked, f"{module_name} leaked upstream imports: {leaked}"


class _ExplodingDB:
    """A DatabasePort double that fails loudly if any read path is touched."""

    @property
    def bangumi(self) -> object:
        raise AssertionError("data tool touched the DB without a catalog")

    @property
    def points(self) -> object:
        raise AssertionError("data tool touched the DB without a catalog")


def _deps_without_catalog() -> RuntimeDeps:
    """RuntimeDeps with the catalog hole — the wiring-error condition."""
    return RuntimeDeps(
        db=cast(DatabasePort, _ExplodingDB()),
        locale="ja",
        query="q",
        catalog=cast(CatalogClientProtocol, None),
    )


def test_require_catalog_raises_without_client() -> None:
    """No catalog injected => hard error, never a DB/Retriever fallback."""
    with pytest.raises(RuntimeError, match="catalog client not configured"):
        _require_catalog(_deps_without_catalog())


def test_require_catalog_returns_injected_client() -> None:
    """When a catalog is present, the guard returns it unchanged."""
    from backend.tests.eval.mock_catalog_client import MockCatalogClient

    catalog = MockCatalogClient()
    deps = RuntimeDeps(
        db=cast(DatabasePort, _ExplodingDB()),
        locale="ja",
        query="q",
        catalog=catalog,
    )
    assert _require_catalog(deps) is catalog
