"""Lock the #732 fix: importing these tools must never call load_dotenv().

Root cause (#732): ``agent/tools/eval_feedback_miner.py`` and
``agent/tools/eval_scorer.py`` used to call ``load_dotenv()`` at module
scope. python-dotenv's default ``load_dotenv()`` walks up from the caller's
file to find a ``.env`` — which found the *repo-root* ``.env`` (containing a
real ``LOGFIRE_TOKEN``) and wrote it into ``os.environ`` for the rest of the
pytest process, the moment either module was collected. Every FastAPI app
built by a *later* test then got real OpenTelemetry instrumentation
attached, which crashes on CORS preflight OPTIONS requests (an unrelated
OTel/FastAPI version incompatibility) — surfacing as a "random" failure in
``test_routes_health.py`` that depended entirely on collection order.

These two tools are CLI entry points (``uv run python agent/tools/...``)
that are also imported by the unit suite for coverage of their pure
functions, so ``load_dotenv()`` belongs behind their ``if __name__ ==
"__main__":`` guard, not at import time.
"""

from __future__ import annotations

import importlib
import sys
from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest

_TOOL_MODULES = ["agent.tools.eval_feedback_miner", "agent.tools.eval_scorer"]


@pytest.fixture
def _fresh_import(monkeypatch: pytest.MonkeyPatch) -> Iterator[MagicMock]:
    """Force a real re-import of the target module under a load_dotenv spy."""
    spy = MagicMock()
    monkeypatch.setattr("dotenv.load_dotenv", spy)
    saved = {name: sys.modules.pop(name, None) for name in _TOOL_MODULES}
    try:
        yield spy
    finally:
        for name, module in saved.items():
            sys.modules.pop(name, None)
            if module is not None:
                sys.modules[name] = module


@pytest.mark.parametrize("module_name", _TOOL_MODULES)
def test_importing_eval_tool_does_not_call_load_dotenv(
    module_name: str, _fresh_import: MagicMock
) -> None:
    importlib.import_module(module_name)

    _fresh_import.assert_not_called()
