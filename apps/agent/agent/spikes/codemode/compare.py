"""Compare baseline and CodeMode reports using preregistered criteria."""

from __future__ import annotations

import argparse
import statistics
from pathlib import Path

from agent.spikes.codemode.benchmark import BenchmarkReport


def _validated_path(arg: str) -> Path:
    path = Path(arg)
    if ".." in path.parts:
        raise SystemExit(f"Refusing traversal-suspicious path: {arg}")
    resolved = path.resolve()
    allowed_base = resolved.parent if path.is_absolute() else Path.cwd().resolve()
    if not resolved.is_relative_to(allowed_base) or not resolved.parent.is_dir():
        raise SystemExit(
            f"Path must stay within {allowed_base} and have an existing parent: {arg}"
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
    criteria = codemode.criteria
    checks = (
        reduction >= criteria.minimum_requests_reduction,
        code_latency <= base_latency * criteria.maximum_latency_ratio,
        contracts == 0,
        not new_errors,
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


def _main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=_validated_path)
    parser.add_argument("codemode", type=_validated_path)
    args = parser.parse_args()
    compare(_load(args.baseline), _load(args.codemode))


if __name__ == "__main__":
    _main()
