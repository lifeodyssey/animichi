"""Static gate: candidate implementations must carry zero raw SQL.

Scans the production SQLModel store and the remaining Tortoise candidate
module for raw-SQL escape hatches and DML string literals. Fixture SQL in
the test helpers is out of scope; the implementation modules must express
the whole contract through typed ORM APIs.
"""

from __future__ import annotations

import ast
import inspect
import re
from types import ModuleType

import pytest

from animichi.infrastructure.persistence.repositories import turn_reservation
from animichi.tests.integration.orm_bakeoff import store_tortoise

_DML_KEYWORDS = re.compile(
    r"\b(select|insert|update|delete|from|where|join|values|returning)\b",
    re.IGNORECASE,
)
_NAMED_ESCAPE_HATCHES = (
    "on conflict",
    "for update",
    "skip locked",
    "is not distinct from",
    "::",
    "$1",
)
_FORBIDDEN_CALLS = ("text", "raw", "execute_query", "execute_sql", "sql")


def _looks_like_sql(literal: str) -> bool:
    lowered = literal.lower()
    if any(marker in lowered for marker in _NAMED_ESCAPE_HATCHES):
        return True
    return len(_DML_KEYWORDS.findall(lowered)) >= 2


def _violations(source: str) -> list[str]:
    tree = ast.parse(source)
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            name = getattr(func, "attr", None) or getattr(func, "id", None)
            if name in _FORBIDDEN_CALLS:
                found.append(f"forbidden call {name}")
            elif name == "execute" and node.args:
                first = node.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str):
                    found.append("execute with a string argument")
        elif (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and _looks_like_sql(node.value)
        ):
            found.append(f"sql-like literal {node.value[:40]!r}")
    return found


@pytest.mark.parametrize(
    "module",
    [turn_reservation, store_tortoise],
    ids=["sqlmodel", "tortoise"],
)
def test_candidate_modules_have_no_raw_sql_escape_hatches(
    module: ModuleType,
) -> None:
    source = inspect.getsource(module)
    violations = _violations(source)
    assert violations == [], f"raw-SQL escape hatch found in {module.__name__}"
