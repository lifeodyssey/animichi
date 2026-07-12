"""Standalone runner for the two-tier four-layer agent eval."""

from __future__ import annotations

import asyncio
import os
import sys

from agent.interfaces.public_api import default_catalog_client
from agent.tests.eval.eval_gate_flow import finish_cli_report
from agent.tests.eval.eval_harness import (
    CASES,
    EVAL_MODEL_ID,
    evaluate_target,
    make_model,
)
from agent.tests.eval.exec_tiers import (
    EvalTierTarget,
    is_fullstack,
    trajectory_web_mocks,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.null_database import NullDatabase


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


def _finish(failures: list[str] | None) -> None:
    if failures is None:
        print("Baseline created. Re-run to enforce gate.")
        return
    if failures:
        raise SystemExit("Regression:\n" + "\n".join(failures))
    print("All gates passed.")


async def _main() -> None:
    model_arg = _parse_model_arg()
    model_id = model_arg or EVAL_MODEL_ID
    target = await _target()
    try:
        print(f"\nRunning agent assessment: {len(CASES)} cases, model={model_id}")
        print(f"Tier: {target.tier}")
        print(target.source)
        report = await evaluate_target(target, make_model(model_id), model_id)
        report.print(include_input=True, include_output=True)
        _finish(finish_cli_report(report, target, model_id))
    finally:
        await _close_target(target)


if __name__ == "__main__":
    asyncio.run(_main())
