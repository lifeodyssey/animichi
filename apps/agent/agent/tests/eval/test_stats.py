"""Deterministic tests for eval statistical comparisons."""

from __future__ import annotations

import logging

import pytest

from agent.tests.eval.gate import BaselineRecord, bootstrap_gate
from agent.tests.eval.stats import (
    PairedScore,
    clopper_pearson_interval,
    proportion_comparison,
    stratified_paired_comparison,
)


def _pairs(deltas: list[float]) -> list[PairedScore]:
    return [
        PairedScore(delta, 0.0, f"path-{index % 2}")
        for index, delta in enumerate(deltas)
    ]


def _case_scores(deltas: list[float]) -> dict[str, dict[str, float]]:
    return {f"case-{index}": {"metric": 0.0} for index, _delta in enumerate(deltas)}


def _baseline(deltas: list[float]) -> BaselineRecord:
    cases = {f"case-{index}": {"metric": delta} for index, delta in enumerate(deltas)}
    return BaselineRecord(
        model="test",
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=len(cases),
        evaluated_count=len(cases),
        scores={"metric": 0.0},
        cases=cases,
    )


def test_stratified_comparison_fails_clear_regression() -> None:
    result = stratified_paired_comparison(_pairs([1.0] * 20), iterations=500)

    assert result.verdict == "fail"
    assert result.interval.lower == 1.0


def test_stratified_comparison_passes_clear_improvement() -> None:
    result = stratified_paired_comparison(_pairs([-1.0] * 20), iterations=500)

    assert result.verdict == "pass"
    assert result.interval.upper == -1.0


def test_stratified_comparison_passes_no_change() -> None:
    result = stratified_paired_comparison(_pairs([0.0] * 20), iterations=500)

    assert result.verdict == "pass"
    assert result.estimate == 0.0


def test_stratified_comparison_marks_overlap_indeterminate() -> None:
    deltas = [1.0] * 10 + [-1.0] * 10
    first = stratified_paired_comparison(_pairs(deltas), iterations=500)
    second = stratified_paired_comparison(_pairs(deltas), iterations=500)

    assert first.verdict == "indeterminate"
    assert first == second


def test_clopper_pearson_matches_known_small_sample_interval() -> None:
    interval = clopper_pearson_interval(1, 10)

    assert interval.lower == pytest.approx(0.0025286, abs=1e-7)
    assert interval.upper == pytest.approx(0.4450161, abs=1e-7)


def test_proportion_comparison_fails_clear_regression() -> None:
    result = proportion_comparison(20, 50, 0, 50)

    assert result.verdict == "fail"
    assert result.method == "clopper-pearson"


def test_proportion_comparison_passes_improvement() -> None:
    result = proportion_comparison(2, 20, 4, 20)

    assert result.verdict == "pass"
    assert result.estimate == pytest.approx(-0.1)


def test_proportion_comparison_marks_overlap_indeterminate() -> None:
    result = proportion_comparison(4, 20, 2, 20)

    assert result.verdict == "indeterminate"
    assert result.interval.lower < 0.0 < result.interval.upper


def test_gate_surfaces_indeterminate_without_blocking(
    caplog: pytest.LogCaptureFixture,
) -> None:
    deltas = [1.0] * 10 + [-1.0] * 10
    strata = {f"case-{index}": f"path-{index % 2}" for index in range(20)}

    with caplog.at_level(logging.WARNING, logger="agent.tests.eval.gate"):
        failures = bootstrap_gate(
            _case_scores(deltas), _baseline(deltas), iterations=500, strata=strata
        )

    assert failures == []
    assert "INDETERMINATE metric" in caplog.text
