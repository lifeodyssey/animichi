"""Pytest entrypoints for the two-tier four-layer agent eval."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from agent.interfaces.public_api import default_catalog_client
from agent.tests.eval.eval_gate_flow import (
    GateResult,
    NoEvaluatedCases,
    finish_cli_report,
    gate_results_payload,
)
from agent.tests.eval.eval_harness import (
    EVAL_MODEL_ID,
    AgentInput,
    evaluate_target,
    make_agent_task,
)
from agent.tests.eval.exec_tiers import (
    EvalTierTarget,
    ResultsPayload,
    trajectory_web_mocks,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.null_database import NullDatabase

__all__ = ["AgentInput", "make_agent_task"]


# This pytest entry remains a compatibility alias for one transition; see spec §4.
def invoke_gate(
    payload: ResultsPayload, layer: str, baselines_dir: Path, *, capped: bool
) -> GateResult:
    return gate_results_payload(payload, layer, baselines_dir, capped=capped)


async def _run_pytest_tier(target: EvalTierTarget) -> None:
    report = await evaluate_target(target)
    report.print(include_input=True, include_output=True)
    try:
        failures = finish_cli_report(report, target, EVAL_MODEL_ID)
    except NoEvaluatedCases as exc:
        pytest.skip(str(exc))
    except SystemExit as exc:
        pytest.fail(str(exc))
    if failures is None:
        pytest.skip(f"Baseline created for {EVAL_MODEL_ID}; re-run to enforce gate.")
    assert not failures, "Regression:\n" + "\n".join(failures)


@pytest.mark.integration
async def test_agent_trajectory() -> None:
    await _run_pytest_tier(
        EvalTierTarget(
            db=NullDatabase(),
            catalog_factory=MockCatalogClient,
            layer="agent_l4_trajectory",
            tier="trajectory",
            source="DB: NullDatabase",
            web_mocks=trajectory_web_mocks(),
        )
    )


@pytest.mark.integration
@pytest.mark.skipif(
    os.environ.get("EVAL_FULLSTACK") != "1",
    reason="fullstack tier is opt-in (EVAL_FULLSTACK=1)",
)
async def test_agent_fullstack(request: pytest.FixtureRequest) -> None:
    await _run_pytest_tier(
        EvalTierTarget(
            db=request.getfixturevalue("real_db"),
            catalog_factory=default_catalog_client,
            layer="agent_l4",
            tier="fullstack",
            source="DB: real_db fixture",
        )
    )
