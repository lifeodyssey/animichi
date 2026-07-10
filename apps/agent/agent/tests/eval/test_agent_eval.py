"""Unified agent eval with two execution tiers.

Tier 1 trajectory (default): real LLM + MockCatalogClient + NullDatabase.
Tier 2 fullstack (EVAL_FULLSTACK=1): real LLM + DB + real catalog.

Commands:
    uv run pytest agent/tests/eval/test_agent_eval.py -v -m integration --no-cov
    EVAL_FULLSTACK=1 uv run pytest agent/tests/eval/test_agent_eval.py -v -m integration --no-cov -k fullstack
    uv run python agent/tests/eval/test_agent_eval.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from dotenv import load_dotenv
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from agent.agents.agent_result import AgentResult
from agent.clients.catalog_client import CatalogClientProtocol
from agent.interfaces.public_api import default_catalog_client, detect_language
from agent.tests.eval.exec_tiers import (
    build_results_payload,
    cap_cases,
    collect_case_scores,
    error_rate_message,
    is_fullstack,
    read_max_cases,
    save_results,
)
from agent.tests.eval.gate import (
    BaselineRecord,
    bootstrap_gate,
    read_baseline_record,
    write_baseline_record,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.null_database import NullDatabase

load_dotenv(Path(__file__).parents[3] / ".env")

# ── Pluggable model ──────────────────────────────────────────────────

_DEFAULT_MODEL_ID = "openai:deepseek-v4-pro@https://api.deepseek.com"
_EVAL_MODEL_ID = os.environ.get("EVAL_MODEL", _DEFAULT_MODEL_ID)
# Lower EVAL_CONCURRENCY when the agent makes in-request external API calls
# (e.g. Anitabi write-through) that rate-limit/timeout under high concurrency.
_EVAL_CONCURRENCY = int(os.environ.get("EVAL_CONCURRENCY", "10"))


def _make_model(model_id: str | None = None) -> object:
    from agent.agents.base import parse_model_spec

    return parse_model_spec(model_id or _EVAL_MODEL_ID, use_settings_fallbacks=False)


# ── Case types ───────────────────────────────────────────────────────


@dataclass
class AgentInput:
    query: str
    locale: str
    context: dict[str, object] | None = None
    selected_point_ids: list[str] | None = None


@dataclass
class AgentExpected:
    acceptable_stages: list[str]
    data_keys: list[str] = field(default_factory=list)
    message_min_len: int = 2


# ── Evaluators ───────────────────────────────────────────────────────


class IntentMatch(Evaluator[AgentInput, AgentResult]):
    """1.0 if agent intent is in the list of acceptable stages."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        return (
            1.0 if ctx.output.intent in ctx.expected_output.acceptable_stages else 0.0
        )


class MessageQuality(Evaluator[AgentInput, AgentResult]):
    """1.0 if message meets minimum length."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        return (
            1.0
            if len(ctx.output.message) >= ctx.expected_output.message_min_len
            else 0.0
        )


class ToolExecution(Evaluator[AgentInput, AgentResult]):
    """1.0 if agent executed at least one tool successfully."""

    _NO_TOOL_STAGES = frozenset({"greet_user", "general_qa", "plan_selected"})

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None:
            return 0.0
        if ctx.expected_output and self._NO_TOOL_STAGES.intersection(
            ctx.expected_output.acceptable_stages
        ):
            return 1.0
        return 1.0 if any(s.success for s in ctx.output.steps) else 0.0


class DataCompleteness(Evaluator[AgentInput, AgentResult]):
    """1.0 if expected data keys are present in the response."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        expected_keys = set(ctx.expected_output.data_keys)
        if not expected_keys:
            return 1.0
        actual_keys = set(ctx.output.tool_state.keys())
        output = ctx.output.output
        if hasattr(output, "data"):
            od = output.data.model_dump(mode="json")
            if isinstance(od, dict):
                actual_keys.update(od.keys())
        for key in ("results", "route"):
            for tk in ctx.output.tool_state:
                if key in tk or tk in key:
                    actual_keys.add(key)
        return 1.0 if expected_keys.issubset(actual_keys) else 0.0


class StepEfficiency(Evaluator[AgentInput, AgentResult]):
    """Score based on step count proximity to expected."""

    _EXPECTED_STEPS: dict[str, int] = {
        "greet_user": 1,
        "general_qa": 1,
        "clarify": 1,
        "search_bangumi": 2,
        "search_nearby": 1,
        "plan_route": 3,
        "plan_selected": 1,
    }

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        step_count = len(ctx.output.steps)
        primary = (
            ctx.expected_output.acceptable_stages[0]
            if ctx.expected_output.acceptable_stages
            else "clarify"
        )
        target = self._EXPECTED_STEPS.get(primary, 2)
        diff = abs(step_count - target)
        if diff <= 1:
            return 1.0
        return 0.5 if diff <= 3 else 0.0


class ResponseLocale(Evaluator[AgentInput, AgentResult]):
    """1.0 if agent message language matches the requested locale."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or not ctx.output.message:
            return 0.0
        detected = detect_language(ctx.output.message)
        return 1.0 if detected == ctx.inputs.locale else 0.0


# ── Load dataset ─────────────────────────────────────────────────────

_DATASET_PATH = (
    Path(__file__).parent
    / "datasets"
    / os.environ.get("EVAL_DATASET", "agent_eval_v3.json")
)


def _str_list(row: dict[str, object], key: str) -> list[str]:
    raw = row.get(key)
    return [str(k) for k in raw] if isinstance(raw, list) else []


def _load_cases() -> list[Case[AgentInput, AgentResult, AgentExpected]]:
    raw: list[dict[str, object]] = json.loads(_DATASET_PATH.read_text())
    cases: list[Case[AgentInput, AgentResult, AgentExpected]] = []
    for row in raw:
        raw_ctx = row.get("context")
        ctx = dict(raw_ctx) if isinstance(raw_ctx, dict) else None
        raw_ids = row.get("selected_point_ids")
        sel_ids = [str(i) for i in raw_ids] if isinstance(raw_ids, list) else None
        cases.append(
            Case(
                name=str(row["id"]),
                inputs=AgentInput(
                    query=str(row.get("query", "")),
                    locale=str(row.get("locale", "ja")),
                    context=ctx,
                    selected_point_ids=sel_ids,
                ),
                expected_output=AgentExpected(
                    acceptable_stages=_str_list(row, "acceptable_stages"),
                    data_keys=_str_list(row, "expected_data_keys"),
                    message_min_len=int(row.get("expected_message_min_len", 2) or 2),
                ),
            )
        )
    return cases


_ALL_CASES = _load_cases()
_MAX_CASES = read_max_cases()
CASES = cap_cases(_ALL_CASES, _MAX_CASES)
_CAPPED = len(CASES) < len(_ALL_CASES)

agent_dataset = Dataset(
    name="agent_eval_v3",
    cases=CASES,
    evaluators=[
        IntentMatch(),
        MessageQuality(),
        ToolExecution(),
        DataCompleteness(),
        StepEfficiency(),
        ResponseLocale(),
    ],
)


# ── Task function ────────────────────────────────────────────────────


CatalogFactory = Callable[[], CatalogClientProtocol]


def make_agent_task(
    db: object, catalog_factory: CatalogFactory, model: object | None = None
) -> object:
    """Create the task: AgentInput → AgentResult."""
    resolved_model = model or _make_model()

    async def task(inp: AgentInput) -> AgentResult:
        if inp.selected_point_ids:
            from agent.agents.selected_route import execute_selected_route

            return await execute_selected_route(
                point_ids=inp.selected_point_ids,
                origin=None,
                locale=inp.locale,
                catalog=MockCatalogClient(),
            )
        from agent.agents.pilgrimage_runner import run_pilgrimage_agent

        return await run_pilgrimage_agent(
            text=inp.query,
            db=db,
            model=resolved_model,
            locale=inp.locale,
            context=inp.context,
            catalog=catalog_factory(),
        )

    return task


# ── Shared helpers ───────────────────────────────────────────────────

_BASELINES_DIR = Path(__file__).parent / "baselines"
_RESULTS_DIR = Path(__file__).parent / "results"
_DATASET_NAME = _DATASET_PATH.stem

_EVALUATOR_NAMES = [
    "IntentMatch",
    "MessageQuality",
    "ToolExecution",
    "DataCompleteness",
    "StepEfficiency",
    "ResponseLocale",
]


def _collect_scores(avg: object) -> dict[str, float]:
    scores_attr = getattr(avg, "scores", {})
    return {n: float(scores_attr.get(n, 0)) for n in _EVALUATOR_NAMES}


def _baseline_record(
    model_id: str,
    tier: str,
    scores: dict[str, float],
    cases: dict[str, dict[str, float]],
    evaluated_count: int,
) -> BaselineRecord:
    return BaselineRecord(
        model=model_id,
        dataset=_DATASET_NAME,
        tier=tier,
        case_count=len(CASES),
        evaluated_count=evaluated_count,
        scores=scores,
        cases=cases,
    )


def _print_scores(scores: dict[str, float], model_id: str, tier: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  Model:    {model_id}")
    print(f"  Tier:     {tier}")
    print(f"  Cases:    {len(CASES)}")
    for name, value in scores.items():
        print(f"  {name:<20}{value:.1%}")
    print(f"{'=' * 60}")


def _save_per_case_results(
    report: object, model_id: str, layer: str, tier: str, scores: dict[str, float]
) -> Path:
    payload = build_results_payload(
        report,
        model_id=model_id,
        dataset=_DATASET_NAME,
        tier=tier,
        case_count=len(CASES),
        scores=scores,
    )
    return save_results(
        results_dir=_RESULTS_DIR, layer=layer, model_id=model_id, payload=payload
    )


def _print_capped_notice() -> None:
    if not _CAPPED:
        return
    print(
        f"\nCAPPED eval run: {len(CASES)}/{len(_ALL_CASES)} cases; "
        "report-only (no baseline read/write/gate)."
    )


def _fail_if_high_error_rate(report: object) -> None:
    message = error_rate_message(report)
    if message is not None:
        pytest.fail(message)


def _read_baseline(layer: str, model_id: str) -> BaselineRecord | None:
    return read_baseline_record(
        layer,
        model_id,
        baselines_dir=_BASELINES_DIR,
        expected_case_count=len(CASES),
    )


def _write_baseline(record: BaselineRecord, layer: str, model_id: str) -> None:
    write_baseline_record(
        record, layer=layer, model_id=model_id, baselines_dir=_BASELINES_DIR
    )


# ── Pytest integration ───────────────────────────────────────────────


async def _evaluate_tier(
    db: object,
    catalog_factory: CatalogFactory,
    layer: str,
    model: object | None = None,
    model_id: str = _EVAL_MODEL_ID,
) -> object:
    task = make_agent_task(db, catalog_factory, model)
    return await agent_dataset.evaluate(
        task, name=f"{layer}_{model_id}", max_concurrency=_EVAL_CONCURRENCY
    )


async def _run_pytest_tier(
    db: object, catalog_factory: CatalogFactory, layer: str, tier: str
) -> None:
    report = await _evaluate_tier(db, catalog_factory, layer)
    report.print(include_input=True, include_output=True)
    avg = report.averages()
    scores = _collect_scores(avg) if avg else {}
    _save_per_case_results(report, _EVAL_MODEL_ID, layer, tier, scores)
    if avg is None:
        pytest.skip("All cases errored — check model endpoint and DB.")
    _finish_pytest_gate(report, layer, tier, scores)


def _finish_pytest_gate(
    report: object, layer: str, tier: str, scores: dict[str, float]
) -> None:
    _fail_if_high_error_rate(report)
    _print_scores(scores, _EVAL_MODEL_ID, tier)
    current_case_scores = collect_case_scores(report)
    if _CAPPED:
        _print_capped_notice()
        return
    _enforce_pytest_baseline(
        layer, tier, scores, current_case_scores, len(report.cases)
    )


def _enforce_pytest_baseline(
    layer: str,
    tier: str,
    scores: dict[str, float],
    cases: dict[str, dict[str, float]],
    evaluated_count: int,
) -> None:
    baseline = _read_baseline(layer, _EVAL_MODEL_ID)
    if baseline is None:
        record = _baseline_record(_EVAL_MODEL_ID, tier, scores, cases, evaluated_count)
        _write_baseline(record, layer, _EVAL_MODEL_ID)
        pytest.skip(f"Baseline created for {_EVAL_MODEL_ID}; re-run to enforce gate.")
    failures = bootstrap_gate(cases, baseline)
    assert not failures, "Regression:\n" + "\n".join(failures)


@pytest.mark.integration
async def test_agent_trajectory() -> None:
    """Run the default DB-free trajectory tier."""
    await _run_pytest_tier(
        NullDatabase(), MockCatalogClient, "agent_trajectory", "trajectory"
    )


@pytest.mark.integration
@pytest.mark.skipif(
    os.environ.get("EVAL_FULLSTACK") != "1",
    reason="fullstack tier is opt-in (EVAL_FULLSTACK=1)",
)
async def test_agent_fullstack(request: pytest.FixtureRequest) -> None:
    """Run the opt-in thin full-stack tier."""
    real_db = request.getfixturevalue("real_db")
    await _run_pytest_tier(real_db, default_catalog_client, "agent", "fullstack")


# ── Standalone runner ────────────────────────────────────────────────

if __name__ == "__main__":
    model_arg = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--eval-model" and i < len(sys.argv):
            model_arg = sys.argv[i + 1]
            break
        if arg.startswith("--eval-model="):
            model_arg = arg.split("=", 1)[1]
            break

    async def _standalone_target() -> tuple[object, CatalogFactory, str, str, str]:
        if not is_fullstack():
            return (
                NullDatabase(),
                MockCatalogClient,
                "agent_trajectory",
                "trajectory",
                "DB: NullDatabase",
            )
        db_url = os.environ.get(
            "SUPABASE_DB_URL",
            "postgresql://postgres:postgres@localhost:54322/postgres",
        )
        from agent.infrastructure.supabase.client import SupabaseClient

        db = SupabaseClient(db_url)
        await db.connect()
        return db, default_catalog_client, "agent", "fullstack", f"DB: {db_url[:50]}..."

    def _finish_standalone_gate(
        report: object, layer: str, tier: str, model_id: str, scores: dict[str, float]
    ) -> None:
        current_case_scores = collect_case_scores(report)
        if _CAPPED:
            _print_capped_notice()
            return
        baseline = _read_baseline(layer, model_id)
        if baseline is None:
            record = _baseline_record(
                model_id, tier, scores, current_case_scores, len(report.cases)
            )
            _write_baseline(record, layer, model_id)
            print("Baseline created. Re-run to enforce gate.")
            return
        failures = bootstrap_gate(current_case_scores, baseline)
        if failures:
            raise SystemExit("Regression:\n" + "\n".join(failures))
        print("All gates passed.")

    async def main() -> None:
        mid = model_arg or _EVAL_MODEL_ID
        model = _make_model(model_arg) if model_arg else _make_model()
        db, catalog_factory, layer, tier, source = await _standalone_target()
        print(f"\nRunning agent assessment: {len(CASES)} cases, model={mid}")
        print(f"Tier: {tier}")
        print(source)
        report = await _evaluate_tier(db, catalog_factory, layer, model, mid)
        report.print(include_input=True, include_output=True)

        avg = report.averages()
        current_scores = _collect_scores(avg) if avg else {}
        _save_per_case_results(report, mid, layer, tier, current_scores)
        if avg is None:
            raise SystemExit("All cases errored — check model endpoint and DB.")
        if message := error_rate_message(report):
            raise SystemExit(message)
        _print_scores(current_scores, mid, tier)
        _finish_standalone_gate(report, layer, tier, mid, current_scores)

    asyncio.run(main())
