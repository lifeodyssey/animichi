"""Structural checks on the CI eval-gate wiring (cards #228, #227).

Deterministic and offline: parses .github/workflows/ci.yml and
agent-eval-nightly.yml as plain text — no live GitHub Actions run, no live
model (see docstrings on individual tests for the AC each one covers). The
workflow files ARE the spec for trigger/gate wiring; these tests pin that
contract so a future edit can't silently regress it.
"""

from __future__ import annotations

import ast
import re
from fnmatch import fnmatch
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[5]
_CI_WORKFLOW = _REPO_ROOT / ".github" / "workflows" / "ci.yml"
_NIGHTLY_WORKFLOW = _REPO_ROOT / ".github" / "workflows" / "agent-eval-nightly.yml"


def _filter_patterns(source: str, filter_name: str) -> list[str]:
    match = re.search(
        rf"(?m)^\s+{re.escape(filter_name)}:\s*(?P<value>\[.*\])\s*$", source
    )
    assert match is not None, f"missing paths-filter entry: {filter_name}"
    return ast.literal_eval(match["value"])


def _named_workflow_job(source: str, job_id: str) -> str:
    job = re.search(
        rf"(?ms)^  {re.escape(job_id)}:\s*$\n(?P<body>.*?)(?=^  [a-zA-Z0-9_-]+:\s*$|\Z)",
        source,
    )
    assert job is not None, f"missing workflow job: {job_id}"
    return job["body"]


def _matches_any(path: str, patterns: list[str]) -> bool:
    return any(fnmatch(path, pattern) for pattern in patterns)


def _top_level_block(source: str, key: str) -> str:
    block = re.search(
        rf"(?ms)^{re.escape(key)}:\s*$\n(?P<body>.*?)(?=^[a-zA-Z0-9_-]+:\s*$|\Z)",
        source,
    )
    assert block is not None, f"missing top-level key: {key}"
    return block["body"]


def test_agent_behavior_filter_scopes_to_prompt_model_guardrail_files() -> None:
    """Card #228 AC2 (integration): only prompt/model-config/guardrail files
    trigger L0 smoke — not every apps/agent/** change, and not apps/web/**."""
    patterns = _filter_patterns(
        _CI_WORKFLOW.read_text(encoding="utf-8"), "agent_behavior"
    )

    included = [
        "apps/agent/agent/agents/animichi_agent.py",  # prompt + ModelRetry/output_validator
        "apps/agent/agent/agents/base.py",  # model-resolution glue
        "apps/agent/agent/agents/web_trust.py",  # injection-defense guardrail
        "apps/agent/agent/config/model_aliases.py",  # model-config registry
        "apps/agent/agent/config/settings.py",  # default_agent_model, model_attempt_timeout
    ]
    excluded = [
        "apps/web/src/routes/index.tsx",
        "apps/agent/agent/infrastructure/observability/runtime.py",  # telemetry helper
        "apps/agent/agent/interfaces/fastapi_service.py",
    ]

    assert all(_matches_any(path, patterns) for path in included)
    assert not any(_matches_any(path, patterns) for path in excluded)


def test_agent_behavior_filter_is_narrower_than_the_full_agent_filter() -> None:
    """The broad `agent` filter (drives lint/type/test) still covers every
    `agent_behavior` file; `agent_behavior` itself must be the smaller set."""
    source = _CI_WORKFLOW.read_text(encoding="utf-8")
    agent_patterns = _filter_patterns(source, "agent")
    behavior_patterns = _filter_patterns(source, "agent_behavior")

    assert _matches_any("apps/agent/agent/agents/animichi_agent.py", agent_patterns)
    assert behavior_patterns != agent_patterns


def test_smoke_job_has_no_kill_switch_and_wires_the_zero_error_direct_gate() -> None:
    """Card #228 AC1 + AC3 (integration): the `&& false` kill-switch is gone and
    the job runs the capped trajectory case in smoke-enforce mode."""
    job = _named_workflow_job(
        _CI_WORKFLOW.read_text(encoding="utf-8"), "agent-eval-smoke"
    )

    assert "&& false" not in job
    assert "needs.changes.outputs.agent_behavior" in job
    assert 'EVAL_SMOKE: "1"' in job
    assert 'EVAL_MAX_CASES: "80"' in job
    assert "test_agent_eval.py::test_agent_trajectory" in job
    assert "test_translation.py" not in job  # translation stays L1-only (nightly)


def test_no_disabled_eval_gate_remains_in_ci() -> None:
    """Regression tripwire: the always-off `&& false` gate must never return."""
    assert "&& false" not in _CI_WORKFLOW.read_text(encoding="utf-8")


def test_nightly_runs_uncapped_gate_on_schedule_and_dispatch_only() -> None:
    """Card #228 AC4 (unit) + #227 AC2 (eval): L1 owns the statistical baseline,
    triggers on a cron schedule + manual dispatch, and never on a PR."""
    nightly = _NIGHTLY_WORKFLOW.read_text(encoding="utf-8")
    triggers = _top_level_block(nightly, "on")

    assert re.search(r'(?m)^\s*-\s*cron:\s*"[^"]+"', triggers)
    assert re.search(r"(?m)^\s*workflow_dispatch:\s*$", triggers)
    assert "pull_request:" not in triggers
    assert "push:" not in triggers
    assert "EVAL_MAX_CASES" not in nightly  # uncapped: owns baseline + statistical gate
    assert "test_agent_eval.py::test_agent_trajectory" in nightly
    assert "test_translation.py" in nightly
