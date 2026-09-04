"""The serializer-independent view of an exported dataset, for the TS round trip.

``Dataset.to_file`` is pydantic-evals' own serializer; a TS test that compares
what it loaded against that same file only ever compares the file with itself.
This module writes the second entry of the pair: the cases as the *dataclasses*
hold them, so a mutation on either side of the round trip shows up as a
difference instead of moving both sides together.

Written by ``run_agent_eval.py --export-cases``; read by
``packages/eval/test/dataset-roundtrip.test.ts``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import cast

from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator

from animichi.agents.agent_result import AgentResult
from animichi.tests.eval.evaluators import AgentExpected, AgentInput

AgentCase = Case[AgentInput, AgentResult, AgentExpected]
AgentDataset = Dataset[AgentInput, AgentResult, AgentExpected]
JsonValue = Mapping[str, object] | Sequence[object] | str | int | float | bool | None


def _fields(value: object) -> Mapping[str, object] | None:
    if value is None:
        return None
    if not is_dataclass(value) or isinstance(value, type):
        raise TypeError(f"expected a dataclass instance, got {type(value).__name__}")
    return asdict(value)


def _spec(evaluator: Evaluator[AgentInput, AgentResult, AgentExpected]) -> JsonValue:
    return cast(JsonValue, evaluator.as_spec().model_dump(mode="json"))


def _case_view(case: AgentCase) -> Mapping[str, object]:
    return {
        "evaluators": [_spec(evaluator) for evaluator in case.evaluators],
        "expected_output": case.expected_output,
        "inputs": _fields(case.inputs),
        "metadata": _fields(case.metadata),
        "name": case.name,
    }


def case_view(dataset: AgentDataset) -> Mapping[str, object]:
    """The dataset as its Python objects describe themselves."""
    return {
        "cases": [_case_view(case) for case in dataset.cases],
        "evaluators": [_spec(evaluator) for evaluator in dataset.evaluators],
        "name": dataset.name,
    }


def write_case_view(dataset: AgentDataset, path: Path) -> None:
    """Write the view as stable, review-readable JSON (sorted keys, raw UTF-8)."""
    text = json.dumps(case_view(dataset), ensure_ascii=False, indent=2, sort_keys=True)
    path.write_text(text + "\n", encoding="utf-8")
