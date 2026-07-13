"""Four-layer agent eval harness on the two-tier execution shell."""

from __future__ import annotations

import json
import os
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import TypeAlias, cast

from dotenv import dotenv_values
from pydantic_ai.models import Model
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator
from pydantic_evals.reporting import EvaluationReport

from agent.agents.agent_result import AgentResult
from agent.agents.base import parse_model_spec
from agent.agents.runtime_deps import TitleTranslator, WebSearcher
from agent.clients.catalog_client import CatalogClientProtocol
from agent.domain.ports import DatabasePort
from agent.tests.eval.eval_common import real_env_updates
from agent.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    DataKeysPresent,
    LocaleMatch,
    NonemptyResults,
    RouteOrderCorrect,
    StepEfficiency,
    ToolCallRecall,
    build_l3_evaluators,
)
from agent.tests.eval.exec_tiers import (
    EvalTierTarget,
    cap_cases,
    read_max_cases,
)

Row: TypeAlias = Mapping[str, object]
TaskFn: TypeAlias = Callable[[AgentInput], Awaitable[AgentResult]]
AgentReport: TypeAlias = EvaluationReport[AgentInput, AgentResult, AgentExpected]
CatalogFactory: TypeAlias = Callable[[], CatalogClientProtocol]


def _load_eval_env() -> None:
    updates = real_env_updates(
        dotenv_values(Path(__file__).parents[3] / ".env"), os.environ
    )
    for key, value in updates.items():
        if key != "LOGFIRE_TOKEN":
            os.environ[key] = value


_load_eval_env()

DEFAULT_MODEL_ID = "openai:deepseek-v4-pro@https://api.deepseek.com"
EVAL_MODEL_ID = os.environ.get("EVAL_MODEL", DEFAULT_MODEL_ID)
EVAL_CONCURRENCY = int(os.environ.get("EVAL_CONCURRENCY", "10"))
EVAL_L3 = os.environ.get("EVAL_L3") == "1"
JUDGE_MODEL_ID = os.environ.get("EVAL_JUDGE_MODEL", DEFAULT_MODEL_ID)
DATASET_PATH = (
    Path(__file__).parent
    / "datasets"
    / os.environ.get("EVAL_DATASET", "agent_eval_v3.json")
)
DATASET_NAME = DATASET_PATH.stem
BASELINES_DIR = Path(__file__).parent / "baselines"
RESULTS_DIR = Path(__file__).parent / "results"
_CORE_METRIC_NAMES = [
    "tool_recall",
    "tool_precision",
    "tool_f1",
    "route_order_correct",
    "data_keys_present",
    "locale_match",
    "step_efficiency",
]


def metric_names(*, has_nonempty_cases: bool, l3_on: bool) -> list[str]:
    names = list(_CORE_METRIC_NAMES)
    if has_nonempty_cases:
        names.append("nonempty_results")
    if l3_on:
        names += ["task_completion", "hallucination_check"]
    return names


def make_model(model_id: str | None = None) -> Model:
    return parse_model_spec(model_id or EVAL_MODEL_ID, use_settings_fallbacks=False)


def _str_list(row: Row, key: str) -> list[str]:
    raw = row.get(key)
    return [str(item) for item in raw] if isinstance(raw, list) else []


def _context(row: Row) -> Mapping[str, object] | None:
    raw = row.get("context")
    return (
        {str(key): value for key, value in raw.items()}
        if isinstance(raw, Mapping)
        else None
    )


def _selected_ids(row: Row) -> list[str] | None:
    raw = row.get("selected_point_ids")
    return [str(item) for item in raw] if isinstance(raw, list) else None


def _case(row: Row) -> Case[AgentInput, AgentResult, AgentExpected]:
    return Case(name=str(row["id"]), inputs=_input(row), metadata=_expected(row))


def _input(row: Row) -> AgentInput:
    return AgentInput(
        str(row.get("query", "")),
        str(row.get("locale", "ja")),
        _context(row),
        _selected_ids(row),
    )


def _expected(row: Row) -> AgentExpected:
    return AgentExpected(
        _str_list(row, "acceptable_stages"),
        _str_list(row, "expected_data_keys"),
        row.get("expect_nonempty") is True,
    )


def _row(item: object) -> Row:
    if not isinstance(item, Mapping):
        raise ValueError("Agent eval dataset rows must be objects.")
    return {str(key): value for key, value in item.items()}


def _rows(raw: object) -> list[Row]:
    if not isinstance(raw, list):
        raise ValueError("Agent eval dataset must be a list.")
    return [_row(item) for item in raw]


def load_cases() -> list[Case[AgentInput, AgentResult, AgentExpected]]:
    raw = cast(object, json.loads(DATASET_PATH.read_text()))
    return [_case(row) for row in _rows(raw)]


ALL_CASES = load_cases()
CASES = cap_cases(ALL_CASES, read_max_cases())
CAPPED = len(CASES) < len(ALL_CASES)
METRIC_NAMES = metric_names(
    has_nonempty_cases=any(
        case.metadata is not None and case.metadata.expect_nonempty for case in CASES
    ),
    l3_on=EVAL_L3,
)


def build_evaluators() -> list[Evaluator[AgentInput, AgentResult, AgentExpected]]:
    evaluators: list[Evaluator[AgentInput, AgentResult, AgentExpected]] = [
        ToolCallRecall(),
        RouteOrderCorrect(),
        DataKeysPresent(),
        NonemptyResults(),
        LocaleMatch(),
        StepEfficiency(),
    ]
    if EVAL_L3:
        evaluators.extend(build_l3_evaluators(make_model(JUDGE_MODEL_ID)))
    return evaluators


agent_dataset = Dataset(name=DATASET_NAME, cases=CASES, evaluators=build_evaluators())


async def _selected_task(inp: AgentInput) -> AgentResult:
    from agent.agents.selected_route import execute_selected_route
    from agent.tests.eval.mock_catalog_client import MockCatalogClient

    return await execute_selected_route(
        point_ids=inp.selected_point_ids or [],
        origin=None,
        locale=inp.locale,
        catalog=MockCatalogClient(),
    )


async def _agent_task(
    inp: AgentInput,
    db: DatabasePort,
    catalog_factory: CatalogFactory,
    model: Model,
    web_searcher: WebSearcher | None,
    title_translator: TitleTranslator | None,
) -> AgentResult:
    from agent.agents.pilgrimage_runner import run_pilgrimage_agent

    return await run_pilgrimage_agent(
        text=inp.query,
        db=db,
        model=model,
        locale=inp.locale,
        context=dict(inp.context) if inp.context is not None else None,
        catalog=catalog_factory(),
        web_searcher=web_searcher,
        title_translator=title_translator,
    )


def make_agent_task(
    db: DatabasePort,
    catalog_factory: CatalogFactory,
    model: Model | None = None,
    *,
    web_searcher: WebSearcher | None = None,
    title_translator: TitleTranslator | None = None,
) -> TaskFn:
    resolved_model = model or make_model()

    async def task(inp: AgentInput) -> AgentResult:
        if inp.selected_point_ids:
            return await _selected_task(inp)
        return await _agent_task(
            inp, db, catalog_factory, resolved_model, web_searcher, title_translator
        )

    return task


def _target_task(target: EvalTierTarget, model: Model | None) -> TaskFn:
    return make_agent_task(
        cast(DatabasePort, target.db),
        cast(CatalogFactory, target.catalog_factory),
        model,
        web_searcher=target.web_mocks.web_searcher,
        title_translator=target.web_mocks.title_translator,
    )


async def evaluate_target(
    target: EvalTierTarget,
    model: Model | None = None,
    model_id: str = EVAL_MODEL_ID,
) -> AgentReport:
    return await agent_dataset.evaluate(
        _target_task(target, model),
        name=f"{target.layer}_{model_id}",
        max_concurrency=EVAL_CONCURRENCY,
    )
