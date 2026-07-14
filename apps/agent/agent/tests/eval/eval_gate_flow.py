"""Shared result persistence and schema-v2 gate flow for agent eval tiers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

from agent.tests.eval.eval_harness import (
    ALL_CASES,
    BASELINES_DIR,
    CAPPED,
    CASES,
    DATASET_NAME,
    EVAL_L3,
    METRIC_NAMES,
    RESULTS_DIR,
    AgentReport,
)
from agent.tests.eval.eval_report import collect_scores, print_scores
from agent.tests.eval.exec_tiers import (
    EvalTierTarget,
    build_results_payload,
    collect_case_scores,
    save_results,
)
from agent.tests.eval.gate import (
    BaselineRecord,
    bootstrap_gate,
    error_rate_gate,
    read_baseline_record,
    write_baseline_record,
)

ScoreMap: TypeAlias = dict[str, float]
CaseScores: TypeAlias = dict[str, ScoreMap]


@dataclass(frozen=True)
class GateInput:
    model: str
    dataset: str
    tier: str
    case_count: int
    evaluated_count: int
    errored_count: int
    scores: ScoreMap
    cases: CaseScores


def gate_exit_code(failures: list[str] | None) -> int:
    return 1 if failures else 0


class NoEvaluatedCases(RuntimeError):
    """Raised when every eval case failed during task execution."""


def _scores(report: AgentReport) -> ScoreMap:
    avg = report.averages()
    if avg is None:
        raise NoEvaluatedCases("All cases errored — check model endpoint and DB.")
    return collect_scores(avg, METRIC_NAMES)


def _scores_for_run(report: AgentReport) -> ScoreMap:
    try:
        return _scores(report)
    except NoEvaluatedCases:
        if CAPPED:
            return {}
        raise


def persist_report(
    report: AgentReport, target: EvalTierTarget, model_id: str, scores: ScoreMap
) -> Path:
    payload = build_results_payload(
        report,
        model_id=model_id,
        dataset=DATASET_NAME,
        tier=target.tier,
        case_count=len(CASES),
        scores=scores,
    )
    return save_results(
        results_dir=RESULTS_DIR, layer=target.layer, model_id=model_id, payload=payload
    )


def _new_baseline(gate_input: GateInput) -> BaselineRecord:
    return BaselineRecord(
        model=gate_input.model,
        dataset=gate_input.dataset,
        tier=gate_input.tier,
        case_count=gate_input.case_count,
        evaluated_count=gate_input.evaluated_count,
        errored_count=gate_input.errored_count,
        scores=gate_input.scores,
        cases=gate_input.cases,
    )


def _baseline(
    layer: str, model_id: str, case_count: int, baselines_dir: Path
) -> BaselineRecord | None:
    return read_baseline_record(
        layer,
        model_id,
        baselines_dir=baselines_dir,
        expected_case_count=case_count,
    )


def _write_baseline(
    record: BaselineRecord, layer: str, model_id: str, baselines_dir: Path
) -> None:
    write_baseline_record(
        record, layer=layer, model_id=model_id, baselines_dir=baselines_dir
    )


def _capped_notice(case_count: int) -> None:
    print(
        f"\nCAPPED eval run: {case_count}/{len(ALL_CASES)} cases; "
        "report-only (no baseline read/write/gate)."
    )


def gate_report(
    report: AgentReport, target: EvalTierTarget, model_id: str, scores: ScoreMap
) -> list[str] | None:
    gate_input = _report_gate_input(report, target, model_id, scores)
    return _run_gate(gate_input, target.layer, BASELINES_DIR, capped=CAPPED)


def _run_gate(
    gate_input: GateInput, layer: str, baselines_dir: Path, *, capped: bool
) -> list[str] | None:
    if capped:
        _capped_notice(gate_input.case_count)
        return []
    baseline = _baseline(layer, gate_input.model, gate_input.case_count, baselines_dir)
    error_failures = error_rate_gate(
        gate_input.errored_count,
        gate_input.evaluated_count + gate_input.errored_count,
        baseline,
    )
    if baseline is not None:
        return [*bootstrap_gate(gate_input.cases, baseline), *error_failures]
    if error_failures:
        return error_failures
    _write_baseline(_new_baseline(gate_input), layer, gate_input.model, baselines_dir)
    return None


def _report_gate_input(
    report: AgentReport, target: EvalTierTarget, model_id: str, scores: ScoreMap
) -> GateInput:
    return GateInput(
        model_id,
        DATASET_NAME,
        target.tier,
        len(CASES),
        len(report.cases),
        len(report.failures),
        scores,
        collect_case_scores(report),
    )


def _print_report_scores(
    scores: ScoreMap, target: EvalTierTarget, model_id: str
) -> None:
    print_scores(
        scores, model_id, case_count=len(CASES), l3_on=EVAL_L3, tier=target.tier
    )


def finish_cli_report(
    report: AgentReport, target: EvalTierTarget, model_id: str
) -> list[str] | None:
    scores = _scores_for_run(report)
    persist_report(report, target, model_id, scores)
    _print_report_scores(scores, target, model_id)
    return gate_report(report, target, model_id, scores)
