"""Offline route_order_correct baseline repair from recorded trajectories."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import NewType, TypeAlias, cast

from agent.tests.eval.evaluators import route_order_score
from agent.tests.eval.exec_tiers import CaseRow, ResultsPayload
from agent.tests.eval.gate import BaselineRecord

CaseId = NewType("CaseId", str)
JsonRow: TypeAlias = Mapping[str, object]
ScoreMap: TypeAlias = Mapping[str, float]
StageMap: TypeAlias = Mapping[CaseId, Sequence[str]]

METRIC = "route_order_correct"
TOLERANCE = 1e-9
EVAL_DIR = Path(__file__).parent
ARTIFACT = "agent_l4_trajectory_openai-deepseek-v4-pro-https---api.deepseek.com.json"
RESULTS_PATH = EVAL_DIR / "results" / ARTIFACT
BASELINE_PATH = EVAL_DIR / "baselines" / ARTIFACT
DATASET_PATH = EVAL_DIR / "datasets" / "agent_eval_v3.json"


@dataclass(frozen=True)
class ScoreUpdate:
    case_id: CaseId
    old: float
    new: float


@dataclass(frozen=True)
class RowWrite:
    row: CaseRow
    update: ScoreUpdate | None


@dataclass(frozen=True)
class FileSummary:
    flips: int
    old_aggregate: float
    new_aggregate: float


def main() -> None:
    results = ResultsPayload.model_validate_json(RESULTS_PATH.read_text())
    baseline = BaselineRecord.model_validate_json(BASELINE_PATH.read_text())
    stages = _load_stage_map(DATASET_PATH)
    _check_results_aggregate(results)
    _check_baseline_aggregate(baseline)
    rows, result_summary, updates = _updated_rows(results, stages)
    cases, baseline_summary = _updated_cases(baseline, updates)
    _write_results(results, rows, result_summary)
    _write_baseline(baseline, cases, baseline_summary)
    _print_summaries(result_summary, baseline_summary)


def _load_stage_map(path: Path) -> dict[CaseId, list[str]]:
    return {_json_case_id(row): _json_stages(row) for row in _json_rows(path)}


def _json_rows(path: Path) -> list[JsonRow]:
    raw = cast(object, json.loads(path.read_text()))
    if not isinstance(raw, list):
        raise ValueError("Agent eval dataset must be a list.")
    return [_json_row(item) for item in raw]


def _json_row(item: object) -> JsonRow:
    if not isinstance(item, Mapping):
        raise ValueError("Agent eval dataset rows must be objects.")
    return {str(key): value for key, value in item.items()}


def _json_case_id(row: JsonRow) -> CaseId:
    raw = row.get("id")
    if not isinstance(raw, str):
        raise ValueError("Dataset row is missing string id.")
    return CaseId(raw)


def _json_stages(row: JsonRow) -> list[str]:
    raw = row.get("acceptable_stages")
    return [str(stage) for stage in raw] if isinstance(raw, list) else []


def _check_results_aggregate(payload: ResultsPayload) -> None:
    values = [_metric(row.scores) for row in _evaluated_rows(payload)]
    _check_close("results", payload.scores[METRIC], _mean(values))


def _check_baseline_aggregate(record: BaselineRecord) -> None:
    values = [_metric(scores) for scores in record.cases.values()]
    _check_close("baseline", record.scores[METRIC], _mean(values))


def _check_close(label: str, stored: float, computed: float) -> None:
    if abs(stored - computed) > TOLERANCE:
        raise ValueError(f"{label} aggregate mismatch: {stored} != {computed}")


def _evaluated_rows(payload: ResultsPayload) -> list[CaseRow]:
    return [row for row in payload.cases if row.scores is not None]


def _updated_rows(
    payload: ResultsPayload, stages: StageMap
) -> tuple[list[CaseRow], FileSummary, list[ScoreUpdate]]:
    writes = [_updated_row(row, stages) for row in payload.cases]
    updates = [write.update for write in writes if write.update is not None]
    summary = _summary(payload.scores[METRIC], updates)
    return [write.row for write in writes], summary, updates


def _updated_row(row: CaseRow, stages: StageMap) -> RowWrite:
    if row.scores is None:
        return RowWrite(row, None)
    case_id = _case_row_id(row)
    new = route_order_score(_stages_for(case_id, stages), _steps(row))
    update = _score_update(case_id, _metric(row.scores), new)
    return RowWrite(
        row.model_copy(update={"scores": _replace(row.scores, new)}), update
    )


def _case_row_id(row: CaseRow) -> CaseId:
    if row.id is None:
        raise ValueError("Evaluated result row is missing id.")
    return CaseId(row.id)


def _steps(row: CaseRow) -> list[str]:
    if row.steps is None:
        raise ValueError(f"Evaluated result row {row.id} is missing steps.")
    return row.steps


def _stages_for(case_id: CaseId, stages: StageMap) -> Sequence[str]:
    if case_id not in stages:
        raise ValueError(f"Dataset is missing case id: {case_id}")
    return stages[case_id]


def _score_update(case_id: CaseId, old: float, new: float) -> ScoreUpdate:
    if old != new and (old, new) != (1.0, 0.0):
        raise ValueError(f"{case_id} changed {old} -> {new}, not 1.0 -> 0.0")
    return ScoreUpdate(case_id, old, new)


def _replace(scores: ScoreMap, new: float) -> dict[str, float]:
    updated = dict(scores)
    updated[METRIC] = new
    _check_other_metrics(scores, updated)
    return updated


def _check_other_metrics(before: ScoreMap, after: ScoreMap) -> None:
    if _without_metric(before) != _without_metric(after):
        raise ValueError("Non-route_order_correct metrics changed.")


def _without_metric(scores: ScoreMap) -> dict[str, float]:
    return {name: value for name, value in scores.items() if name != METRIC}


def _updated_cases(
    record: BaselineRecord, updates: Sequence[ScoreUpdate]
) -> tuple[dict[str, dict[str, float]], FileSummary]:
    update_map = {str(update.case_id): update for update in updates}
    cases = {
        case_id: _baseline_scores(case_id, scores, update_map)
        for case_id, scores in record.cases.items()
    }
    return cases, _summary(record.scores[METRIC], updates)


def _baseline_scores(
    case_id: str, scores: ScoreMap, updates: Mapping[str, ScoreUpdate]
) -> dict[str, float]:
    update = _baseline_update(case_id, scores, updates)
    return _replace(scores, update.new)


def _baseline_update(
    case_id: str, scores: ScoreMap, updates: Mapping[str, ScoreUpdate]
) -> ScoreUpdate:
    update = updates.get(case_id)
    if update is None:
        raise ValueError(f"Baseline case {case_id} has no result row.")
    _check_close(case_id, _metric(scores), update.old)
    return update


def _metric(scores: ScoreMap | None) -> float:
    if scores is None or METRIC not in scores:
        raise ValueError(f"Scores missing {METRIC}.")
    return scores[METRIC]


def _summary(old_aggregate: float, updates: Sequence[ScoreUpdate]) -> FileSummary:
    return FileSummary(_flip_count(updates), old_aggregate, _mean(_new_values(updates)))


def _flip_count(updates: Sequence[ScoreUpdate]) -> int:
    return sum(1 for update in updates if update.old != update.new)


def _new_values(updates: Sequence[ScoreUpdate]) -> list[float]:
    return [update.new for update in updates]


def _mean(values: Sequence[float]) -> float:
    if not values:
        raise ValueError("Cannot average empty scores.")
    return sum(values) / len(values)


def _write_results(
    payload: ResultsPayload, rows: Sequence[CaseRow], summary: FileSummary
) -> None:
    scores = _replace(payload.scores, summary.new_aggregate)
    updated = payload.model_copy(update={"scores": scores, "cases": list(rows)})
    RESULTS_PATH.write_text(updated.model_dump_json(indent=2) + "\n")


def _write_baseline(
    record: BaselineRecord, cases: Mapping[str, dict[str, float]], summary: FileSummary
) -> None:
    scores = _replace(record.scores, summary.new_aggregate)
    updated = record.model_copy(update={"scores": scores, "cases": dict(cases)})
    BASELINE_PATH.write_text(updated.model_dump_json(indent=2) + "\n")


def _print_summaries(results: FileSummary, baseline: FileSummary) -> None:
    _print_summary("results", results)
    _print_summary("baseline", baseline)


def _print_summary(label: str, summary: FileSummary) -> None:
    print(f"{label} flips: {summary.flips}")
    print(f"{label} {METRIC}: {summary.old_aggregate} -> {summary.new_aggregate}")


if __name__ == "__main__":
    main()
