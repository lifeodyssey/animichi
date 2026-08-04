"""_default_model() coverage for the eval CLI tools (#732 follow-up).

agent/tools/eval_feedback_miner.py and agent/tools/eval_scorer.py resolve
their default model lazily via _default_model() rather than a module-level
constant — see test_eval_tools_no_import_side_effects.py for why. That
function is the only place either CLI tool picks a default model, so a
regression here would silently route eval traffic to the wrong model.
"""

from __future__ import annotations

from types import ModuleType

import pytest

from agent.tools import eval_feedback_miner, eval_scorer

_FALLBACK_MODEL = "openai:qwen3.5-9b@http://localhost:1234/v1"
_TOOL_MODULES: list[ModuleType] = [eval_feedback_miner, eval_scorer]


@pytest.mark.parametrize("module", _TOOL_MODULES)
def test_default_model_falls_back_when_env_unset(
    module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("EVAL_MODEL", raising=False)

    assert module._default_model() == _FALLBACK_MODEL


@pytest.mark.parametrize("module", _TOOL_MODULES)
def test_default_model_reads_the_environment_when_set(
    module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EVAL_MODEL", "openai:custom-model@https://example.com/v1")

    assert module._default_model() == "openai:custom-model@https://example.com/v1"
