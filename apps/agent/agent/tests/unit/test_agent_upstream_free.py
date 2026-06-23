"""Guard: the agent makes ZERO upstream calls.

GOAL §7 ("旧 agent 上游调用已删净") requires every agent path — the four data
tools AND clarify candidate enrichment — to route only through the injected
:class:`CatalogClientProtocol`. This locks that invariant three ways:

  1. Static: ``pilgrimage_tools`` / ``catalog_tools`` / ``tool_runtime`` /
     ``tools`` import no upstream client (Anitabi/Bangumi gateways), no DB
     Retriever, and no legacy data handlers. With clarify rewired onto the
     catalog, ``tools`` joins the seam — the agent has no remaining gateway
     touch.
  2. Static: no seam module references a ``deps.gateway`` attribute (the field
     no longer exists on ``RuntimeDeps``; this also catches a reintroduced
     gateway hop before it can compile).
  3. Behavioural: a data tool with no catalog injected raises rather than
     silently falling back to the DB/Retriever path.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import cast

import pytest

from agent.agents.pilgrimage_tools import _require_catalog
from agent.agents.runtime_deps import RuntimeDeps
from agent.clients.catalog_client import CatalogClientProtocol
from agent.domain.ports import DatabasePort

# Modules that form the catalog-only agent seam. These must stay free of any
# upstream/DB read path. ``tools`` (clarify enrichment) is included now that it
# resolves via the catalog instead of the Bangumi gateway.
_SEAM_MODULES = ("pilgrimage_tools", "catalog_tools", "tool_runtime", "tools")

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


def _seam_tree(module_name: str) -> ast.Module:
    """Parse a seam module's source into an AST."""
    path = Path(__file__).parents[2] / "agents" / f"{module_name}.py"
    return ast.parse(path.read_text(encoding="utf-8"))


def _imported_names(module_name: str) -> list[str]:
    """Collect every dotted import target referenced by a seam module."""
    tree = _seam_tree(module_name)
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names.append(module)
            names.extend(f"{module}.{alias.name}" for alias in node.names)
    return names


def _gateway_attribute_accesses(module_name: str) -> list[str]:
    """Find every ``<expr>.gateway`` attribute access in a seam module."""
    tree = _seam_tree(module_name)
    return [
        node.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute) and node.attr == "gateway"
    ]


@pytest.mark.parametrize("module_name", _SEAM_MODULES)
def test_seam_module_has_no_upstream_imports(module_name: str) -> None:
    """No seam module imports an upstream gateway, Retriever, or handler."""
    imported = "\n".join(_imported_names(module_name))
    leaked = [frag for frag in _FORBIDDEN_IMPORT_FRAGMENTS if frag in imported]
    assert not leaked, f"{module_name} leaked upstream imports: {leaked}"


@pytest.mark.parametrize("module_name", _SEAM_MODULES)
def test_seam_module_never_touches_deps_gateway(module_name: str) -> None:
    """No seam module reads ``deps.gateway`` — clarify routes via the catalog."""
    accesses = _gateway_attribute_accesses(module_name)
    assert not accesses, f"{module_name} accessed a .gateway attribute: {accesses}"


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
    from agent.tests.eval.mock_catalog_client import MockCatalogClient

    catalog = MockCatalogClient()
    deps = RuntimeDeps(
        db=cast(DatabasePort, _ExplodingDB()),
        locale="ja",
        query="q",
        catalog=catalog,
    )
    assert _require_catalog(deps) is catalog
