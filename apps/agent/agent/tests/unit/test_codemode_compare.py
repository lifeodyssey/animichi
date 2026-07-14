"""Offline safety tests for the CodeMode JSON comparator."""

from __future__ import annotations

import runpy
import sys
from collections.abc import Callable
from pathlib import Path

import pytest

from agent.spikes.codemode import benchmark as benchmark_module
from agent.spikes.codemode import compare as compare_module
from agent.spikes.codemode.report import Arm, BenchmarkReport, RunMeasurement

VALIDATED_PATHS = (compare_module._validated_path, benchmark_module._validated_path)


@pytest.mark.parametrize("validated_path", VALIDATED_PATHS)
def test_absolute_path_outside_base_is_rejected(
    validated_path: Callable[[str], Path],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    allowed_base = tmp_path / "allowed"
    outside_base = tmp_path / "outside"
    allowed_base.mkdir()
    outside_base.mkdir()
    monkeypatch.setenv("ANIMICHI_SPIKE_OUT_BASE", str(allowed_base))

    with pytest.raises(SystemExit, match="Set ANIMICHI_SPIKE_OUT_BASE"):
        validated_path(str(outside_base / "report.json"))


@pytest.mark.parametrize("validated_path", VALIDATED_PATHS)
def test_absolute_path_under_environment_base_is_accepted(
    validated_path: Callable[[str], Path],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    allowed_base = tmp_path / "allowed"
    allowed_base.mkdir()
    output = allowed_base / "report.json"
    monkeypatch.setenv("ANIMICHI_SPIKE_OUT_BASE", str(allowed_base))

    assert validated_path(str(output)) == output


@pytest.mark.parametrize("validated_path", VALIDATED_PATHS)
def test_relative_path_under_cwd_is_accepted(
    validated_path: Callable[[str], Path],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("ANIMICHI_SPIKE_OUT_BASE", raising=False)
    monkeypatch.chdir(tmp_path)

    assert validated_path("report.json") == tmp_path / "report.json"


def _report(
    arm: Arm,
    *,
    error_runs: int | None = 0,
    tool_failures: int | None = 0,
    digest: str | None = "same-schema",
) -> BenchmarkReport:
    requests = 10 if arm == "baseline" else 5
    return BenchmarkReport(
        arm=arm,
        model="test-model",
        repeats=1,
        queries=["query"],
        output_schema_digest=digest,
        error_bearing_run_count=error_runs,
        total_tool_failure_count=tool_failures,
        runs=[
            RunMeasurement(
                query="query",
                repeat=1,
                requests=requests,
                latency_seconds=1.0,
                output_type="QAResponseModel",
                valid_typed_output=True,
            )
        ],
    )


@pytest.mark.parametrize(
    ("field", "label"),
    [
        ("error_bearing_run_count", "Error-bearing runs"),
        ("total_tool_failure_count", "Total tool failures"),
    ],
)
def test_safety_count_regression_vetoes_adoption(
    field: str, label: str, capsys: pytest.CaptureFixture[str]
) -> None:
    baseline = _report("baseline")
    codemode = _report("codemode")
    setattr(codemode, field, 1)

    assert compare_module.compare(baseline, codemode) is False
    assert f"| {label} | 1 | <= 0 | FAIL |" in capsys.readouterr().out


def test_output_schema_digest_mismatch_vetoes_adoption(
    capsys: pytest.CaptureFixture[str],
) -> None:
    baseline = _report("baseline", digest="baseline-schema")
    codemode = _report("codemode", digest="codemode-schema")

    assert compare_module.compare(baseline, codemode) is False
    assert "| Output schema digest | codemode-schema | baseline-schema | FAIL |" in (
        capsys.readouterr().out
    )


def test_legacy_reports_print_unrecorded_without_changing_verdict(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    baseline = _report("baseline", error_runs=None, tool_failures=None, digest=None)
    codemode = _report("codemode", error_runs=None, tool_failures=None, digest=None)
    baseline_path = tmp_path / "legacy-baseline.json"
    codemode_path = tmp_path / "legacy-codemode.json"
    baseline_path.write_text(baseline.model_dump_json(exclude_none=True))
    codemode_path.write_text(codemode.model_dump_json(exclude_none=True))

    assert (
        compare_module.compare(
            compare_module._load(baseline_path), compare_module._load(codemode_path)
        )
        is True
    )
    assert capsys.readouterr().out.count("not recorded") == 6


def test_compare_has_no_benchmark_or_agent_import_chain() -> None:
    source = Path(compare_module.__file__).read_text()

    assert "codemode.benchmark" not in source
    assert "agent.agents" not in source


def test_main_returns_nonzero_for_do_not_adopt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    baseline_path = tmp_path / "baseline.json"
    codemode_path = tmp_path / "codemode.json"
    baseline_path.write_text(_report("baseline").model_dump_json())
    codemode_path.write_text(_report("codemode", error_runs=1).model_dump_json())
    monkeypatch.setattr(
        sys, "argv", ["compare", str(baseline_path), str(codemode_path)]
    )
    monkeypatch.setenv("ANIMICHI_SPIKE_OUT_BASE", str(tmp_path))

    with pytest.raises(SystemExit) as raised:
        runpy.run_path(str(compare_module.__file__), run_name="__main__")
    assert raised.value.code is True
