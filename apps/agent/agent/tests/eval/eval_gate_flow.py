"""Shared result persistence and schema-v2 gate flow for agent eval tiers."""

from __future__ import annotations

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
    error_rate_message,
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


class NoEvaluatedCases(RuntimeError):
    """Raised when every eval case failed during task execution."""


def _scores(report: AgentReport) -> ScoreMap:
    avg = report.averages()
    if avg is None:
        raise NoEvaluatedCases("All cases errored — check model endpoint and DB.")
    return collect_scores(avg, METRIC_NAMES)


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


def _new_baseline(
    target: EvalTierTarget,
    model_id: str,
    scores: ScoreMap,
    cases: CaseScores,
    report: AgentReport,
) -> BaselineRecord:
    return BaselineRecord(
        model=model_id,
        dataset=DATASET_NAME,
        tier=target.tier,
        case_count=len(CASES),
        evaluated_count=len(report.cases),
        errored_count=len(report.failures),
        scores=scores,
        cases=cases,
    )


def _baseline(target: EvalTierTarget, model_id: str) -> BaselineRecord | None:
    return read_baseline_record(
        target.layer,
        model_id,
        baselines_dir=BASELINES_DIR,
        expected_case_count=len(CASES),
    )


def _write_baseline(
    record: BaselineRecord, target: EvalTierTarget, model_id: str
) -> None:
    write_baseline_record(
        record, layer=target.layer, model_id=model_id, baselines_dir=BASELINES_DIR
    )


def _capped_notice() -> None:
    print(
        f"\nCAPPED eval run: {len(CASES)}/{len(ALL_CASES)} cases; "
        "report-only (no baseline read/write/gate)."
    )


def gate_report(
    report: AgentReport, target: EvalTierTarget, model_id: str, scores: ScoreMap
) -> list[str] | None:
    if CAPPED:
        _capped_notice()
        return []
    cases = collect_case_scores(report)
    baseline = _baseline(target, model_id)
    if baseline is None:
        _write_baseline(
            _new_baseline(target, model_id, scores, cases, report), target, model_id
        )
        return None
    return _gate_against(report, cases, baseline)


def _gate_against(
    report: AgentReport, cases: CaseScores, baseline: BaselineRecord
) -> list[str]:
    total = len(report.cases) + len(report.failures)
    return [
        *bootstrap_gate(cases, baseline),
        *error_rate_gate(len(report.failures), total, baseline),
    ]


def _print_report_scores(
    scores: ScoreMap, target: EvalTierTarget, model_id: str
) -> None:
    print_scores(
        scores, model_id, case_count=len(CASES), l3_on=EVAL_L3, tier=target.tier
    )


def finish_cli_report(
    report: AgentReport, target: EvalTierTarget, model_id: str
) -> list[str] | None:
    scores = _scores(report)
    persist_report(report, target, model_id, scores)
    if message := error_rate_message(report):
        raise SystemExit(message)
    _print_report_scores(scores, target, model_id)
    return gate_report(report, target, model_id, scores)
