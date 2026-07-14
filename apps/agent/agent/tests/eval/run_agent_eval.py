"""Standalone runner for the two-tier four-layer agent eval.

The canonical ``agent_eval_v3.json`` remains a custom guarded source format.
``--export-dataset`` exposes the in-memory dataset through pydantic-evals'
official ``Dataset.to_file`` serialization without changing canonical storage.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from pydantic_evals import Case, Dataset
from pydantic_evals.lifecycle import CaseLifecycle
from pydantic_evals.reporting import ReportCase

from agent.agents.agent_result import AgentResult
from agent.interfaces.public_api import default_catalog_client
from agent.tests.eval.eval_gate_flow import (
    NoEvaluatedCases,
    finish_cli_report,
    gate_exit_code,
)
from agent.tests.eval.eval_harness import (
    CASES,
    DATASET_PATH,
    EVAL_MODEL_ID,
    AgentReport,
    agent_dataset,
    evaluate_target,
    make_model,
)
from agent.tests.eval.evaluators import AgentExpected, AgentInput
from agent.tests.eval.exec_tiers import (
    EvalTierTarget,
    is_fullstack,
    trajectory_web_mocks,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.null_database import NullDatabase

AgentCase = Case[AgentInput, AgentResult, AgentExpected]


@dataclass(frozen=True)
class CliArgs:
    eval_model: str | None
    export_dataset: Path | None


@dataclass
class StreamingProgress:
    """Official pydantic-evals lifecycle factory with stable line output."""

    total: int
    completed: int = 0
    evaluated: int = 0
    errored: int = 0

    def __call__(self, case: AgentCase) -> StreamingCaseLifecycle:
        return StreamingCaseLifecycle(case, self)

    def emit(self, case_id: str, result: object) -> None:
        self.completed += 1
        evaluated = isinstance(result, ReportCase)
        self.evaluated += int(evaluated)
        self.errored += int(not evaluated)
        summary = "result=ok" if evaluated else _failure_summary(result)
        print(self._line(case_id, summary), file=sys.stderr, flush=True)

    def _line(self, case_id: str, summary: str) -> str:
        return (
            f"[eval] id={case_id} {summary} completed={self.completed}/{self.total} "
            f"evaluated={self.evaluated} errored={self.errored}"
        )


class StreamingCaseLifecycle(CaseLifecycle[AgentInput, AgentResult, AgentExpected]):
    def __init__(self, case: AgentCase, progress: StreamingProgress) -> None:
        super().__init__(case)
        self._progress = progress

    async def teardown(self, result: object | None) -> None:
        if result is not None:
            self._progress.emit(str(self.case.name), result)


def _failure_summary(result: object) -> str:
    message = getattr(result, "error_message", "evaluation failed")
    clean = " ".join(str(message).split())[:100]
    return f"result=error error={clean}"


def _export_path(value: str) -> Path:
    path = Path(value)
    try:
        path.resolve().relative_to(DATASET_PATH.parent.resolve())
    except ValueError:
        return path
    raise argparse.ArgumentTypeError(
        "export target must not be the canonical dataset or reside under datasets/"
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--eval-model")
    mode.add_argument("--export-dataset", type=_export_path)
    return parser


def _parse_args(argv: Sequence[str] | None = None) -> CliArgs:
    parsed = _parser().parse_args(argv)
    return CliArgs(parsed.eval_model, parsed.export_dataset)


def _export_dataset(
    dataset: Dataset[AgentInput, AgentResult, AgentExpected], path: Path
) -> None:
    dataset.to_file(path, schema_path=None)


def _db_url() -> str:
    return os.environ.get(
        "SUPABASE_DB_URL", "postgresql://postgres:postgres@localhost:54322/postgres"
    )


async def _target() -> EvalTierTarget:
    if not is_fullstack():
        return _trajectory_target()
    return await _fullstack_target()


def _trajectory_target() -> EvalTierTarget:
    return EvalTierTarget(
        db=NullDatabase(),
        catalog_factory=MockCatalogClient,
        layer="agent_l4_trajectory",
        tier="trajectory",
        source="DB: NullDatabase",
        web_mocks=trajectory_web_mocks(),
    )


async def _fullstack_target() -> EvalTierTarget:
    from agent.infrastructure.supabase.client import SupabaseClient

    db_url = _db_url()
    db = SupabaseClient(db_url)
    await db.connect()
    return EvalTierTarget(
        db=db,
        catalog_factory=default_catalog_client,
        layer="agent_l4",
        tier="fullstack",
        source=f"DB: {db_url[:50]}...",
    )


async def _close_target(target: EvalTierTarget) -> None:
    close = getattr(target.db, "close", None)
    if close is not None:
        await close()


def _finish(failures: list[str] | None) -> int:
    if failures is None:
        print("Baseline created. Re-run to enforce gate.")
    elif failures:
        print("Regression:\n" + "\n".join(failures), file=sys.stderr)
    else:
        print("All gates passed.")
    return gate_exit_code(failures)


def _finish_report(report: AgentReport, target: EvalTierTarget, model_id: str) -> int:
    try:
        failures = finish_cli_report(report, target, model_id)
    except NoEvaluatedCases as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return _finish(failures)


async def _main(args: CliArgs | None = None) -> int:
    parsed = args or _parse_args()
    export_path = parsed.export_dataset
    if export_path is not None:
        _export_dataset(agent_dataset, export_path)
        print(f"Exported official dataset: {export_path}")
        return 0
    model_arg = parsed.eval_model
    model_id = model_arg or EVAL_MODEL_ID
    target = await _target()
    try:
        print(f"\nRunning agent assessment: {len(CASES)} cases, model={model_id}")
        print(f"Tier: {target.tier}")
        print(target.source)
        progress = StreamingProgress(len(CASES))
        report = await evaluate_target(
            target, make_model(model_id), model_id, lifecycle=progress, progress=False
        )
        report.print(include_input=True, include_output=True)
        return _finish_report(report, target, model_id)
    finally:
        await _close_target(target)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
