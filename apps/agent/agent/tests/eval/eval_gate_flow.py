"""Shared result persistence and schema-v2 gate flow for agent eval tiers."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

from agent.agents.agent_result import AgentResult
from agent.tests.eval.direct_gates import (
    TrajectoryCase,
    direct_thrash_gate,
    print_direct_thrash_metrics,
)
from agent.tests.eval.eval_harness import (
    ALL_CASES,
    BASELINES_DIR,
    CAPPED,
    CASES,
    DATASET_NAME,
    DATASET_PATH,
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
from agent.tests.eval.stats import load_case_strata

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
    trajectories: tuple[TrajectoryCase, ...] = ()
    strata: dict[str, str] | None = None


def gate_exit_code(failures: list[str] | None) -> int:
    return 1 if failures else 0


class NoEvaluatedCases(RuntimeError):
    """Raised when every eval case failed during task execution."""


class SmokeRequiresCappedRun(RuntimeError):
    """Raised when EVAL_SMOKE=1 is set but the run resolved to uncapped."""


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
        expected_metrics=METRIC_NAMES,
    )


def _write_baseline(
    record: BaselineRecord, layer: str, model_id: str, baselines_dir: Path
) -> None:
    write_baseline_record(
        record, layer=layer, model_id=model_id, baselines_dir=baselines_dir
    )


def _capped_mode_label(*, smoke: bool) -> str:
    if smoke:
        return "smoke-enforced (zero-errors + direct gates)"
    return "report-only"


def _capped_notice(case_count: int, *, smoke: bool) -> None:
    label = _capped_mode_label(smoke=smoke)
    print(
        f"\nCAPPED eval run: {case_count}/{len(ALL_CASES)} cases; {label} "
        "(no baseline read/write/statistical gate)."
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
        return _run_capped_gate(gate_input)
    _refuse_uncapped_smoke()
    enforce_direct = _direct_gate_enforced()
    _print_direct_metrics(gate_input, include_p95=True, enforced=enforce_direct)
    return _run_uncapped_gate(gate_input, layer, baselines_dir, enforce_direct)


def _refuse_uncapped_smoke() -> None:
    """Never silently drop EVAL_SMOKE=1 into the uncapped statistical gate."""
    if not _smoke_enforced():
        return
    raise SmokeRequiresCappedRun(
        "EVAL_SMOKE=1 requires a capped run (EVAL_MAX_CASES below the dataset "
        f"size, currently {len(ALL_CASES)} cases) — refusing to silently fall "
        "through to the uncapped statistical gate."
    )


def _run_capped_gate(gate_input: GateInput) -> list[str]:
    """L0 smoke tier: never touches the baseline; EVAL_SMOKE=1 makes it enforce."""
    smoke = _smoke_enforced()
    _print_direct_metrics(gate_input, include_p95=smoke, enforced=smoke)
    _capped_notice(gate_input.case_count, smoke=smoke)
    if not smoke:
        return []
    return _smoke_gate_failures(gate_input)


def _smoke_gate_failures(gate_input: GateInput) -> list[str]:
    return [
        *_smoke_error_failures(gate_input),
        *direct_thrash_gate(gate_input.trajectories),
    ]


def _smoke_error_failures(gate_input: GateInput) -> list[str]:
    if gate_input.errored_count == 0:
        return []
    return [
        f"{gate_input.errored_count}/{gate_input.case_count} cases errored "
        "(EVAL_SMOKE requires zero errors)."
    ]


def _smoke_enforced() -> bool:
    return os.environ.get("EVAL_SMOKE") == "1"


def _run_uncapped_gate(
    gate_input: GateInput, layer: str, baselines_dir: Path, enforce_direct: bool
) -> list[str] | None:
    baseline = _baseline(layer, gate_input.model, gate_input.case_count, baselines_dir)
    failures = _gate_failures(gate_input, baseline, enforce_direct=enforce_direct)
    if failures:
        return failures
    if baseline is None:
        _write_baseline(
            _new_baseline(gate_input), layer, gate_input.model, baselines_dir
        )
        return None
    return []


def _print_direct_metrics(
    gate_input: GateInput, *, include_p95: bool, enforced: bool
) -> None:
    print_direct_thrash_metrics(
        gate_input.trajectories, include_p95=include_p95, enforced=enforced
    )


def _gate_failures(
    gate_input: GateInput,
    baseline: BaselineRecord | None,
    *,
    enforce_direct: bool,
) -> list[str]:
    direct = direct_thrash_gate(gate_input.trajectories)
    bootstrap = (
        bootstrap_gate(gate_input.cases, baseline, strata=gate_input.strata)
        if baseline
        else []
    )
    errors = error_rate_gate(
        gate_input.errored_count,
        gate_input.evaluated_count + gate_input.errored_count,
        baseline,
    )
    return [*(direct if enforce_direct else []), *bootstrap, *errors]


def _direct_gate_enforced() -> bool:
    return os.environ.get("DIRECT_GATE_ENFORCE") == "1"


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
        trajectories=_trajectory_cases(report),
        strata=load_case_strata(DATASET_PATH),
    )


def _trajectory_cases(report: AgentReport) -> tuple[TrajectoryCase, ...]:
    return tuple(
        TrajectoryCase.from_result(str(case.name), case.output)
        for case in report.cases
        if isinstance(case.output, AgentResult)
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
