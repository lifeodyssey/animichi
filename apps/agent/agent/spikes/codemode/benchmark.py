"""Run the Wave 2 CodeMode SPIKE benchmark on the trajectory-tier world.

PREREGISTERED_CRITERIA: adopt iff median requests reduction is at least 40%,
median latency is not worse, every run returns a valid typed output, and the
CodeMode arm introduces no new tool-error classes. This module only records
measurements; ``compare.py`` applies the frozen criteria.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import time
from collections.abc import Sequence
from pathlib import Path

from pydantic_ai import Agent
from pydantic_ai.models import Model

from agent.agents.animichi_agent import RuntimeOutput, build_animichi_agent
from agent.agents.base import describe_model, resolve_model
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    GreetingResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.interfaces.public_api import detect_language
from agent.spikes.codemode.agent import build_codemode_animichi_agent
from agent.spikes.codemode.report import Arm, BenchmarkReport, RunMeasurement
from agent.tests.eval.exec_tiers import trajectory_web_mocks
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.null_database import NullDatabase

QUERIES = (
    "ラブライブの聖地はどこ？",
    "Love Live的圣地在哪里",
    "Love Live pilgrimage locations",
    "君の名は。と聲の形、聖地が多いのはどっち?",
    "《你的名字》和《铃芽之旅》，哪个更适合安排一天圣地巡礼？",
    "Compare the pilgrimage spots for Your Name and Weathering with You.",
    "涼宮ハルヒの憂鬱と響け！ユーフォニアムの聖地を比較して。",
    "Compare Love Live Sunshine with the original Love Live pilgrimage areas.",
)
VALID_OUTPUT_TYPES = (
    ClarifyResponseModel,
    SearchResponseModel,
    RouteResponseModel,
    QAResponseModel,
    GreetingResponseModel,
)


def _build_agent(arm: Arm) -> Agent[RuntimeDeps, RuntimeOutput]:
    if arm == "codemode":
        return build_codemode_animichi_agent()
    return build_animichi_agent()


def _deps(query: str) -> RuntimeDeps:
    web = trajectory_web_mocks()
    return RuntimeDeps(
        db=NullDatabase(),
        locale=detect_language(query),
        query=query,
        catalog=MockCatalogClient(),
        web_searcher=web.web_searcher,
        title_translator=web.title_translator,
    )


def _tool_error_class(error: str | None) -> str:
    if not error:
        return "ToolFailure"
    prefix = error.partition(":")[0].strip().split()[-1]
    return prefix if prefix.endswith("Error") else "ToolFailure"


def _measurement(query: str, repeat: int, elapsed: float) -> RunMeasurement:
    return RunMeasurement(query=query, repeat=repeat, latency_seconds=elapsed)


def _step_errors(deps: RuntimeDeps) -> list[str]:
    return [_tool_error_class(step.error) for step in deps.steps if not step.success]


def _schema_digest(agent: Agent[RuntimeDeps, RuntimeOutput]) -> str:
    encoded = json.dumps(agent.output_json_schema(), sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()


async def _run_once(
    agent: Agent[RuntimeDeps, RuntimeOutput], model: Model, query: str, repeat: int
) -> RunMeasurement:
    deps = _deps(query)
    started = time.monotonic()
    try:
        result = await agent.run(query, deps=deps, model=model)
    except Exception as exc:
        row = _measurement(query, repeat, time.monotonic() - started)
        row.exception_type, row.exception = type(exc).__name__, str(exc)
        row.tool_call_count = len(deps.steps)
        row.tool_error_classes = _step_errors(deps)
        return row
    usage = result.usage
    return RunMeasurement(
        query=query,
        repeat=repeat,
        requests=usage.requests,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        latency_seconds=time.monotonic() - started,
        output_type=type(result.output).__name__,
        valid_typed_output=isinstance(result.output, VALID_OUTPUT_TYPES),
        tool_call_count=len(deps.steps),
        tool_error_classes=_step_errors(deps),
    )


async def run_benchmark(
    arm: Arm,
    repeats: int,
    *,
    model: Model | None = None,
    queries: Sequence[str] = QUERIES,
) -> BenchmarkReport:
    resolved = model or resolve_model(os.environ.get("EVAL_MODEL"))
    agent = _build_agent(arm)
    runs = [
        await _run_once(agent, resolved, query, repeat)
        for repeat in range(1, repeats + 1)
        for query in queries
    ]
    return BenchmarkReport(
        arm=arm,
        model=describe_model(resolved),
        repeats=repeats,
        queries=list(queries),
        output_schema_digest=_schema_digest(agent),
        error_bearing_run_count=sum(
            bool(run.exception_type or run.tool_error_classes) for run in runs
        ),
        total_tool_failure_count=sum(len(run.tool_error_classes) for run in runs),
        runs=runs,
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arm", choices=("baseline", "codemode"), required=True)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--out", type=_validated_path, required=True)
    return parser.parse_args()


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


async def _main() -> None:
    args = _parse_args()
    report = await run_benchmark(args.arm, args.repeats)
    args.out.write_text(report.model_dump_json(indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(_main())
