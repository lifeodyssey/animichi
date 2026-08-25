"""Offline contracts for affected CI and nightly agent evaluation."""

from __future__ import annotations

import json
import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[6]
_CI = (_ROOT / ".github/workflows/pr-verification.yml").read_text()
_EVAL = (_ROOT / ".github/actions/agent-eval/action.yml").read_text()
_NIGHTLY = (_ROOT / ".github/workflows/agent-eval-nightly.yml").read_text()


def _job(source: str, job_id: str) -> str:
    match = re.search(
        rf"(?ms)^  {re.escape(job_id)}:\s*$\n(?P<body>.*?)(?=^  [\w-]+:\s*$|\Z)",
        source,
    )
    assert match is not None, f"missing workflow job: {job_id}"
    return match["body"]


def test_manifest_routes_only_agent_behavior_inputs_to_eval() -> None:
    manifest = json.loads((_ROOT / ".github/ci/components.json").read_text())
    lane = next(
        item for item in manifest["global_lanes"] if item["name"] == "agent-eval"
    )
    assert "apps/agent/src/animichi/agents/**" in lane["paths"]
    assert "apps/agent/src/animichi/config/model_aliases.py" in lane["paths"]
    assert "apps/web/**" not in lane["paths"]


def test_single_ci_runs_the_authorized_l0_trajectory_gate() -> None:
    job = _job(_CI, "agent-eval")
    assert "contains(fromJSON(needs.route.outputs.lanes), 'agent-eval')" in job
    assert "github.event.pull_request.head.repo.full_name == github.repository" in job
    assert "github.actor != 'dependabot[bot]'" in job
    assert "github.event.pull_request.user.login != 'dependabot[bot]'" in job
    assert "ZEN_GO_API_KEY: ${{ secrets.ZEN_GO_API_KEY }}" in job
    assert "uses: ./.github/actions/agent-eval" in job
    assert "tier: l0" in job
    assert "test_agent_eval.py::test_agent_trajectory" in _EVAL
    assert "openai:mimo-v2.5@https://opencode.ai/zen/go/v1" in _EVAL
    assert 'EVAL_SMOKE: "1"' in _EVAL
    assert 'EVAL_MAX_CASES: "80"' in _EVAL
    assert re.search(r"AGENT_SVC_DATABASE_URL:\s*\S+", _EVAL)


def test_single_ci_keeps_eval_report_only() -> None:
    verify = _job(_CI, "aggregate")
    assert "agent-eval" not in verify
    assert "AGENT_EVAL_RESULT" not in verify
    aggregate = (_ROOT / ".github/scripts/pr-verification-aggregate.sh").read_text()
    assert 'require_lane agent-eval "$AGENT_EVAL_RESULT"' not in aggregate


def test_integration_conftest_zen_go_stub_is_overrideable() -> None:
    tests = _ROOT / "apps/agent/src/animichi/tests"
    integration = (tests / "integration/conftest.py").read_text()
    parent = (tests / "conftest.py").read_text()
    assert 'os.environ.setdefault("ZEN_GO_API_KEY", "test-key")' in integration
    assert re.search(r"os\.environ\[.ZEN_GO_API_KEY.\]\s*=", integration) is None
    assert 'setdefault("ZEN_GO_API_KEY"' not in parent


def test_nightly_remains_uncapped_and_outside_pull_requests() -> None:
    assert re.search(r'(?m)^\s*-\s*cron:\s*"[^"]+"', _NIGHTLY)
    assert re.search(r"(?m)^\s*workflow_dispatch:\s*$", _NIGHTLY)
    assert "pull_request:" not in _NIGHTLY
    assert "EVAL_MAX_CASES" not in _NIGHTLY
    assert "uses: ./.github/actions/agent-eval" in _NIGHTLY
    assert "tier: l1" in _NIGHTLY
    assert "test_agent_eval.py::test_agent_trajectory" in _EVAL
    assert "test_translation.py" in _EVAL
