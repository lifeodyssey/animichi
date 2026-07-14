"""Compare baseline and CodeMode reports using preregistered criteria."""

from __future__ import annotations

import argparse
import os
import statistics
from pathlib import Path

from agent.spikes.codemode.report import BenchmarkReport


def _validated_path(arg: str) -> Path:
    path = Path(arg)
    if ".." in path.parts:
        raise SystemExit(f"Refusing traversal-suspicious path: {arg}")
    resolved = path.resolve()
    allowed_base = Path(
        os.environ.get("ANIMICHI_SPIKE_OUT_BASE", os.getcwd())
    ).resolve()
    if not resolved.is_relative_to(allowed_base) or not resolved.parent.is_dir():
        raise SystemExit(
            f"Path must stay within {allowed_base} and have an existing parent: {arg}. "
            "Set ANIMICHI_SPIKE_OUT_BASE for out-of-tree outputs."
        )
    return resolved


def _load(path: Path) -> BenchmarkReport:
    return BenchmarkReport.model_validate_json(path.read_text())


def _median(report: BenchmarkReport, field: str) -> float:
    values = [float(getattr(run, field)) for run in report.runs]
    return statistics.median(values)


def _contract_violations(report: BenchmarkReport) -> int:
    return sum(not run.valid_typed_output for run in report.runs)


def _error_classes(report: BenchmarkReport) -> set[str]:
    return {
        item
        for run in report.runs
        for item in [*run.tool_error_classes, *(run.exception_type or "",)]
        if item
    }


def _row(label: str, actual: str, threshold: str, passed: bool) -> str:
    verdict = "PASS" if passed else "FAIL"
    return f"| {label} | {actual} | {threshold} | {verdict} |"


def _optional_comparison(
    baseline: int | None, codemode: int | None
) -> tuple[str, str, bool]:
    if baseline is None and codemode is None:
        return "not recorded", "not recorded", True
    if baseline is None or codemode is None:
        actual = "not recorded" if codemode is None else str(codemode)
        threshold = "not recorded" if baseline is None else str(baseline)
        return actual, threshold, False
    return str(codemode), f"<= {baseline}", codemode <= baseline


def _schema_comparison(
    baseline: str | None, codemode: str | None
) -> tuple[str, str, bool]:
    if baseline is None and codemode is None:
        return "not recorded", "not recorded", True
    if baseline is None or codemode is None:
        return codemode or "not recorded", baseline or "not recorded", False
    return codemode, baseline, codemode == baseline


def _validate_pair(baseline: BenchmarkReport, codemode: BenchmarkReport) -> None:
    if baseline.arm != "baseline" or codemode.arm != "codemode":
        raise ValueError("Expected baseline report followed by codemode report.")
    comparable = (baseline.model, baseline.repeats, baseline.queries, baseline.criteria)
    candidate = (codemode.model, codemode.repeats, codemode.queries, codemode.criteria)
    if comparable != candidate:
        raise ValueError(
            "Reports must use the same model, repeats, queries, and criteria."
        )


def compare(baseline: BenchmarkReport, codemode: BenchmarkReport) -> bool:
    _validate_pair(baseline, codemode)
    base_requests = _median(baseline, "requests")
    code_requests = _median(codemode, "requests")
    reduction = 0.0 if base_requests == 0 else 1 - code_requests / base_requests
    base_latency = _median(baseline, "latency_seconds")
    code_latency = _median(codemode, "latency_seconds")
    contracts = _contract_violations(codemode)
    new_errors = _error_classes(codemode) - _error_classes(baseline)
    error_runs = _optional_comparison(
        baseline.error_bearing_run_count, codemode.error_bearing_run_count
    )
    tool_failures = _optional_comparison(
        baseline.total_tool_failure_count, codemode.total_tool_failure_count
    )
    schemas = _schema_comparison(
        baseline.output_schema_digest, codemode.output_schema_digest
    )
    criteria = codemode.criteria
    checks = (
        reduction >= criteria.minimum_requests_reduction,
        code_latency <= base_latency * criteria.maximum_latency_ratio,
        contracts == 0,
        not new_errors,
        error_runs[2],
        tool_failures[2],
        schemas[2],
    )
    print("| Criterion | Actual | Threshold | Result |")
    print("|---|---:|---:|---|")
    print(_row("Median requests reduction", f"{reduction:.1%}", ">= 40%", checks[0]))
    print(
        _row(
            "Median latency",
            f"{code_latency:.3f}s",
            f"<= {base_latency:.3f}s",
            checks[1],
        )
    )
    print(_row("Error-bearing runs", error_runs[0], error_runs[1], error_runs[2]))
    print(
        _row(
            "Total tool failures", tool_failures[0], tool_failures[1], tool_failures[2]
        )
    )
    print(_row("Output schema digest", schemas[0], schemas[1], schemas[2]))
    print(_row("Contract violations", str(contracts), "0", checks[2]))
    print(
        _row(
            "New tool-error classes",
            ", ".join(sorted(new_errors)) or "none",
            "none",
            checks[3],
        )
    )
    print(f"\nVERDICT: {'ADOPT' if all(checks) else 'DO NOT ADOPT'}")
    return all(checks)


def _main() -> bool:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=_validated_path)
    parser.add_argument("codemode", type=_validated_path)
    args = parser.parse_args()
    return compare(_load(args.baseline), _load(args.codemode))


if __name__ == "__main__":
    raise SystemExit(not _main())
