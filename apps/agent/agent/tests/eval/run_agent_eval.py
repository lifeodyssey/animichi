"""Standalone runner for the two-tier four-layer agent eval."""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from pydantic_evals import Case
from pydantic_evals.lifecycle import CaseLifecycle
from pydantic_evals.reporting import ReportCase

from agent.agents.agent_result import AgentResult
from agent.interfaces.public_api import default_catalog_client
from agent.tests.eval.eval_gate_flow import (
    GateResult,
    finish_cli_report,
    gate_exit_code,
    gate_results_payload,
)
from agent.tests.eval.eval_harness import (
    CASES,
    EVAL_MODEL_ID,
    evaluate_target,
    make_model,
)
from agent.tests.eval.evaluators import AgentExpected, AgentInput
from agent.tests.eval.exec_tiers import (
    EvalTierTarget,
    ResultsPayload,
    is_fullstack,
    trajectory_web_mocks,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.null_database import NullDatabase

AgentCase = Case[AgentInput, AgentResult, AgentExpected]


@dataclass
class StreamingProgress:
    """Official pydantic-evals lifecycle factory with stable line output."""

    total: int
    completed: int = 0
    passed: int = 0
    failed: int = 0

    def __call__(self, case: AgentCase) -> StreamingCaseLifecycle:
        return StreamingCaseLifecycle(case, self)

    def emit(self, case_id: str, result: object) -> None:
        self.completed += 1
        passed = isinstance(result, ReportCase)
        self.passed += int(passed)
        self.failed += int(not passed)
        summary = "result=pass" if passed else _failure_summary(result)
        print(self._line(case_id, summary), file=sys.stderr, flush=True)

    def _line(self, case_id: str, summary: str) -> str:
        return (
            f"[eval] id={case_id} {summary} completed={self.completed}/{self.total} "
            f"passed={self.passed} failed={self.failed}"
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
    return f"result=fail error={clean}"


def _parse_model_arg() -> str | None:
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--eval-model" and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
        if arg.startswith("--eval-model="):
            return arg.split("=", 1)[1]
    return None


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


def invoke_gate(
    payload: ResultsPayload, layer: str, baselines_dir: Path, *, capped: bool
) -> GateResult:
    return gate_results_payload(payload, layer, baselines_dir, capped=capped)


def _finish(failures: list[str] | None) -> int:
    if failures is None:
        print("Baseline created. Re-run to enforce gate.")
    elif failures:
        print("Regression:\n" + "\n".join(failures), file=sys.stderr)
    else:
        print("All gates passed.")
    return gate_exit_code(failures)


async def _main() -> int:
    model_arg = _parse_model_arg()
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
        return _finish(finish_cli_report(report, target, model_id))
    finally:
        await _close_target(target)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
