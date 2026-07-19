"""Render a paired markdown comparison for two CodeMode rematch reports."""

from __future__ import annotations

import argparse
import statistics
from pathlib import Path

from agent.spikes.codemode.report import (
    OFFICIAL_V1_METRICS,
    RematchReport,
    Verdict,
)

SPIKE_DIR = Path(__file__).resolve().parent


def _load(path: Path) -> RematchReport:
    return RematchReport.model_validate_json(path.read_text())


def _validate_pair(control: RematchReport, taught: RematchReport) -> None:
    if control.arm != "control" or taught.arm != "codemode-taught":
        raise ValueError("Expected control followed by codemode-taught report.")
    shared = (control.model, control.dataset, control.evaluator_version)
    if shared != (taught.model, taught.dataset, taught.evaluator_version):
        raise ValueError("Reports must use the same model, dataset, and evaluator.")
    if (
        control.subset_digest != taught.subset_digest
        or control.case_ids != taught.case_ids
    ):
        raise ValueError("Reports must use the same ordered case subset.")


def _paired_delta(control: RematchReport, taught: RematchReport, metric: str) -> float:
    control_cases = {case.id: case for case in control.cases}
    taught_cases = {case.id: case for case in taught.cases}
    pairs = [
        taught_cases[case_id].scores[metric] - control_cases[case_id].scores[metric]
        for case_id in control.case_ids
        if metric in control_cases[case_id].scores
        and metric in taught_cases[case_id].scores
    ]
    return statistics.mean(pairs) if pairs else 0.0


def _verdict(control: RematchReport, taught: RematchReport) -> Verdict:
    correctness_ok = (
        taught.scores["tool_correctness"] >= control.scores["tool_correctness"] - 0.01
    )
    requests_ok = taught.request_p95 < control.request_p95
    cost_ok = taught.estimated_cost_usd <= control.estimated_cost_usd * 1.15
    if not correctness_ok:
        return "KILL"
    return "ADOPT" if requests_ok and cost_ok else "BENCH AGAIN"


def _metric_row(control: RematchReport, taught: RematchReport, metric: str) -> str:
    before, after = control.scores[metric], taught.scores[metric]
    delta = _paired_delta(control, taught, metric)
    return f"| {metric} | {before:.3f} | {after:.3f} | {delta:+.3f} |"


def _summary_rows(control: RematchReport, taught: RematchReport) -> list[str]:
    token_delta = taught.total_tokens - control.total_tokens
    cost_delta = taught.estimated_cost_usd - control.estimated_cost_usd
    return [
        f"| request_p95 | {control.request_p95} | {taught.request_p95} | {taught.request_p95 - control.request_p95:+d} |",
        f"| total_tokens | {control.total_tokens} | {taught.total_tokens} | {token_delta:+d} |",
        f"| estimated_cost_usd | {control.estimated_cost_usd:.4f} | {taught.estimated_cost_usd:.4f} | {cost_delta:+.4f} |",
    ]


def render(control: RematchReport, taught: RematchReport) -> str:
    _validate_pair(control, taught)
    rows = [_metric_row(control, taught, metric) for metric in OFFICIAL_V1_METRICS]
    rows.extend(_summary_rows(control, taught))
    verdict = _verdict(control, taught)
    lines = [
        "# CodeMode rematch report",
        "",
        f"Model: `{control.model}`  ",
        f"Paired subset: `{control.subset_digest}` ({len(control.case_ids)} cases)",
        "",
        "| Metric | ARM A control | ARM B taught | Paired delta (B−A) |",
        "|---|---:|---:|---:|",
        *rows,
        "",
        "## Verdict rubric",
        "",
        "- ADOPT: tool_correctness is within 0.01 of control, request_p95 is strictly lower, and estimated cost is no more than 15% higher.",
        "- BENCH AGAIN: correctness clears the 0.01 floor, but request p95 or cost misses the adoption threshold.",
        "- KILL: tool_correctness is more than 0.01 below control.",
        "",
        f"VERDICT: {verdict}",
    ]
    return "\n".join(lines) + "\n"


def compare(control: RematchReport, taught: RematchReport) -> Verdict:
    markdown = render(control, taught)
    print(markdown, end="")
    return _verdict(control, taught)


def _main() -> Verdict:
    argparse.ArgumentParser(description=__doc__).parse_args()
    control = _load(SPIKE_DIR / "rematch-control.json")
    taught = _load(SPIKE_DIR / "rematch-codemode-taught.json")
    markdown = render(control, taught)
    print(markdown, end="")
    (SPIKE_DIR / "rematch-report.md").write_text(markdown)
    return _verdict(control, taught)


if __name__ == "__main__":
    raise SystemExit(0 if _main() == "ADOPT" else 1)
