"""Unit tests for eval bootstrap gate statistics."""

from __future__ import annotations

import logging

from agent.tests.eval.gate import BaselineRecord, bootstrap_gate


def _cases(count: int, score: float) -> dict[str, dict[str, float]]:
    return {f"case-{idx:03d}": {"Accuracy": score} for idx in range(count)}


def _record(cases: dict[str, dict[str, float]]) -> BaselineRecord:
    return BaselineRecord(
        model="m",
        dataset="agent_eval_v3",
        tier="fullstack",
        case_count=len(cases),
        evaluated_count=len(cases),
        scores={"Accuracy": 1.0},
        cases=cases,
    )


def test_flags_clear_regression() -> None:
    failures = bootstrap_gate(_cases(50, 0.0), _record(_cases(50, 1.0)))

    assert len(failures) == 1
    assert "Accuracy" in failures[0]
    assert "n=50" in failures[0]


def test_identical_scores_pass() -> None:
    failures = bootstrap_gate(_cases(50, 1.0), _record(_cases(50, 1.0)))

    assert failures == []


def test_single_flip_among_many_is_not_significant() -> None:
    current = _cases(200, 1.0)
    current["case-000"] = {"Accuracy": 0.0}

    failures = bootstrap_gate(current, _record(_cases(200, 1.0)))

    assert failures == []


def test_skips_metric_with_too_few_shared_cases(
    caplog: logging.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="agent.tests.eval.gate"):
        failures = bootstrap_gate(_cases(5, 0.0), _record(_cases(5, 1.0)))

    assert failures == []
    assert "Accuracy" in caplog.text


def test_bootstrap_gate_is_deterministic() -> None:
    current = _cases(80, 0.9)
    baseline = _record(_cases(80, 1.0))

    first = bootstrap_gate(current, baseline)
    second = bootstrap_gate(current, baseline)

    assert first == second
