"""Golden equivalence contract for the pytest and official runner seams."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from agent.tests.eval.exec_tiers import ResultsPayload
from agent.tests.eval.gate import BaselineRecord, baseline_path
from agent.tests.eval.run_agent_eval import invoke_gate as invoke_runner_gate
from agent.tests.eval.test_agent_eval import invoke_gate as invoke_pytest_gate

_FIXTURES = Path(__file__).parent / "fixtures" / "eval_gate"
_MODEL = "fixture:model"
_LAYER = "agent_fixture"


def _fixture(name: str) -> tuple[ResultsPayload, str | None, bool]:
    raw = cast(dict[str, object], json.loads((_FIXTURES / f"{name}.json").read_text()))
    payload = ResultsPayload.model_validate(raw["results_payload"])
    baseline = raw.get("baseline")
    capped = raw.get("capped") is True
    return payload, json.dumps(baseline) if baseline is not None else None, capped


def _prepare_baseline(directory: Path, payload: str | None) -> None:
    if payload is None:
        return
    directory.mkdir()
    baseline_path(_LAYER, _MODEL, directory).write_text(payload)


@pytest.mark.parametrize(
    ("fixture_name", "expected_failures", "expected_exit"),
    [
        ("clean_pass", [], 0),
        ("metric_regression", ["Accuracy"], 1),
        ("error_rate", ["error_rate"], 1),
        ("missing_baseline", None, 0),
        ("stale_baseline", None, 0),
        ("capped_run", [], 0),
    ],
)
def test_gate_entrypoints_are_bitwise_equivalent(
    tmp_path: Path,
    fixture_name: str,
    expected_failures: list[str] | None,
    expected_exit: int,
) -> None:
    payload, baseline, capped = _fixture(fixture_name)
    pytest_dir = tmp_path / "pytest"
    runner_dir = tmp_path / "runner"
    _prepare_baseline(pytest_dir, baseline)
    _prepare_baseline(runner_dir, baseline)

    pytest_result = invoke_pytest_gate(payload, _LAYER, pytest_dir, capped=capped)
    runner_result = invoke_runner_gate(payload, _LAYER, runner_dir, capped=capped)
    pytest_baseline = baseline_path(_LAYER, _MODEL, pytest_dir)
    runner_baseline = baseline_path(_LAYER, _MODEL, runner_dir)

    assert runner_result == pytest_result
    assert runner_baseline.read_bytes() == pytest_baseline.read_bytes()
    assert runner_result.exit_code == expected_exit
    if capped:
        assert runner_baseline.read_text() == baseline
    if expected_failures is None:
        assert runner_result.failures is None
        created = BaselineRecord.model_validate_json(runner_baseline.read_text())
        assert created.case_count == payload.case_count
    else:
        assert len(runner_result.failures or []) == len(expected_failures)
        for marker, failure in zip(
            expected_failures, runner_result.failures or [], strict=True
        ):
            assert marker in failure
