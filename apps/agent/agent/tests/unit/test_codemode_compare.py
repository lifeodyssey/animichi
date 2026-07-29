"""Offline tests for paired CodeMode rematch comparison."""

from __future__ import annotations

from pathlib import Path

import pytest

from agent.spikes.codemode import compare as compare_module
from agent.spikes.codemode.report import CaseMeasurement, RematchReport

_METRICS = {
    "argument_correctness": 0.8,
    "tool_correctness": 0.7,
    "trajectory_match": 0.8,
    "max_tool_calls": 0.9,
    "data_keys_present": 0.9,
    "locale_match": 0.9,
    "nonempty_results": 0.9,
    "step_efficiency": 0.8,
}


def _report(
    arm: str,
    *,
    tool_correctness: float = 0.7,
    request_p95: int = 6,
    total_tokens: int = 10_000,
) -> RematchReport:
    metrics = {**_METRICS, "tool_correctness": tool_correctness}
    case_ids = ["A_en_001", "B_ja_001"]
    cases = [
        CaseMeasurement(
            id=case_id,
            scores=metrics,
            requests=request_p95,
            input_tokens=total_tokens // 4,
            output_tokens=0,
        )
        for case_id in case_ids
    ]
    return RematchReport(
        arm=arm,
        model="test-model",
        dataset="agent_eval_v3",
        subset_digest="same-subset",
        case_ids=case_ids,
        scores=metrics,
        request_p95=request_p95,
        input_tokens=total_tokens,
        output_tokens=0,
        total_tokens=total_tokens,
        estimated_cost_usd=total_tokens / 1_000_000,
        cases=cases,
    )


def test_adopt_requires_correctness_requests_and_cost(
    capsys: pytest.CaptureFixture[str],
) -> None:
    control = _report("control", request_p95=7)
    taught = _report(
        "codemode-taught", tool_correctness=0.695, request_p95=6, total_tokens=11_500
    )

    assert compare_module.compare(control, taught) == "ADOPT"
    output = capsys.readouterr().out
    assert "| tool_correctness |" in output
    assert "| request_p95 |" in output
    assert "VERDICT: ADOPT" in output


def test_correctness_regression_kills_rematch() -> None:
    control = _report("control", request_p95=7)
    taught = _report("codemode-taught", tool_correctness=0.689, request_p95=6)

    assert compare_module.compare(control, taught) == "KILL"


def test_efficiency_miss_benches_again() -> None:
    control = _report("control", request_p95=7)
    taught = _report("codemode-taught", request_p95=7)

    assert compare_module.compare(control, taught) == "BENCH AGAIN"


def test_mismatched_case_subset_is_rejected() -> None:
    control = _report("control")
    taught = _report("codemode-taught")
    taught.case_ids[-1] = "C_en_001"

    with pytest.raises(ValueError, match="same ordered case subset"):
        compare_module.compare(control, taught)


def test_compare_stays_json_reader_only() -> None:
    source = Path(compare_module.__file__).read_text()

    assert "agent.agents" not in source
    assert "codemode.rematch" not in source
