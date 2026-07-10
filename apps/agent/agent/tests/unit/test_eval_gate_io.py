"""Unit tests for eval baseline record IO."""

from __future__ import annotations

import json
from pathlib import Path

from agent.tests.eval.gate import (
    BaselineRecord,
    baseline_path,
    read_baseline_record,
    write_baseline_record,
)


def _record(case_count: int = 2, evaluated_count: int = 2) -> BaselineRecord:
    cases = {f"case-{idx}": {"Accuracy": 1.0} for idx in range(case_count)}
    return BaselineRecord(
        model="m",
        dataset="translation_v1",
        tier="translation",
        case_count=case_count,
        evaluated_count=evaluated_count,
        scores={"Accuracy": 1.0},
        cases=cases,
    )


def test_baseline_path_sanitizes_model_id(tmp_path: Path) -> None:
    path = baseline_path("agent", "org/model:v1@latest", tmp_path)

    assert path == tmp_path / "agent_org-model-v1-latest.json"


def test_write_read_round_trip(tmp_path: Path) -> None:
    record = _record()

    path = write_baseline_record(
        record,
        layer="translation",
        model_id="translation",
        baselines_dir=tmp_path,
    )
    result = read_baseline_record(
        "translation",
        "translation",
        baselines_dir=tmp_path,
        expected_case_count=2,
    )

    assert path.read_text().endswith("\n")
    assert result == record


def test_read_returns_none_for_missing_file(tmp_path: Path) -> None:
    result = read_baseline_record("agent", "m", baselines_dir=tmp_path)

    assert result is None


def test_read_returns_none_for_legacy_aggregate_json(tmp_path: Path) -> None:
    path = baseline_path("agent", "m", tmp_path)
    payload = {"model": "m", "case_count": 5, "scores": {"a": 1.0}}
    path.write_text(json.dumps(payload))

    result = read_baseline_record("agent", "m", baselines_dir=tmp_path)

    assert result is None


def test_read_returns_none_for_stale_case_count(tmp_path: Path) -> None:
    write_baseline_record(
        _record(case_count=5), layer="agent", model_id="m", baselines_dir=tmp_path
    )

    result = read_baseline_record(
        "agent",
        "m",
        baselines_dir=tmp_path,
        expected_case_count=6,
    )

    assert result is None


def test_read_returns_none_for_low_evaluated_count(tmp_path: Path) -> None:
    write_baseline_record(
        _record(case_count=10, evaluated_count=7),
        layer="agent",
        model_id="m",
        baselines_dir=tmp_path,
    )

    result = read_baseline_record(
        "agent",
        "m",
        baselines_dir=tmp_path,
        expected_case_count=10,
    )

    assert result is None
