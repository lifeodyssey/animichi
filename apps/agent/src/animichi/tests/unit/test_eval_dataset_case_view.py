"""The Python side of the #1299 round trip: the exported case view."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic_evals import Case, Dataset

from animichi.agents.agent_result import AgentResult
from animichi.tests.eval import run_agent_eval
from animichi.tests.eval.dataset_case_view import (
    AgentDataset,
    _fields,
    case_view,
    write_case_view,
)
from animichi.tests.eval.evaluators import AgentExpected, AgentInput, LocaleMatch
from animichi.tests.eval.run_agent_eval import CliArgs, _main, _parse_args


@pytest.fixture
def one_case_dataset() -> AgentDataset:
    case = Case[AgentInput, AgentResult, AgentExpected](
        name="probe",
        inputs=AgentInput("君の名は。の聖地", "ja"),
        metadata=AgentExpected(["search_bangumi"], ["results"], True),
    )
    return Dataset(name="probe_v1", cases=[case], evaluators=[LocaleMatch()])


def test_case_view_mirrors_the_dataclass_fields(one_case_dataset: AgentDataset) -> None:
    view = case_view(one_case_dataset)

    assert view["name"] == "probe_v1"
    assert view["evaluators"] == [{"arguments": None, "name": "LocaleMatch"}]
    assert view["cases"] == [
        {
            "evaluators": [],
            "expected_output": None,
            "inputs": {
                "clarification_id": None,
                "context": None,
                "locale": "ja",
                "query": "君の名は。の聖地",
                "seeded_pending": None,
                "selected_candidate_ids": None,
                "selected_point_ids": None,
            },
            "metadata": {
                "acceptable_stages": ["search_bangumi"],
                "data_keys": ["results"],
                "expect_nonempty": True,
            },
            "name": "probe",
        }
    ]


def test_case_view_file_is_stable_and_readable(
    tmp_path: Path, one_case_dataset: AgentDataset
) -> None:
    path = tmp_path / "probe.cases.json"

    write_case_view(one_case_dataset, path)

    text = path.read_text(encoding="utf-8")
    assert text.endswith("}\n")
    assert "君の名は。の聖地" in text
    assert json.loads(text) == json.loads(json.dumps(case_view(one_case_dataset)))


def test_case_view_refuses_a_non_dataclass_slot() -> None:
    with pytest.raises(TypeError, match="expected a dataclass instance"):
        _fields("not a dataclass")


def test_export_cases_without_export_dataset_is_a_cli_error(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as exc_info:
        _parse_args(["--export-cases", "out.cases.json"])

    assert exc_info.value.code == 2
    assert "--export-cases only applies to an --export-dataset run" in (
        capsys.readouterr().err
    )


def test_export_cases_parses_alongside_export_dataset() -> None:
    parsed = _parse_args(
        ["--export-dataset", "out.json", "--export-cases", "out.cases.json"]
    )

    assert parsed.export_dataset == Path("out.json")
    assert parsed.export_cases == Path("out.cases.json")


@pytest.mark.asyncio
async def test_export_mode_writes_both_artifacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset_path = tmp_path / "official.json"
    cases_path = tmp_path / "official.cases.json"

    async def unexpected_target() -> object:
        raise AssertionError("evaluation target must not be created in export mode")

    monkeypatch.setattr(run_agent_eval, "_target", unexpected_target)
    args = CliArgs(
        eval_model=None, export_dataset=dataset_path, export_cases=cases_path
    )

    assert await _main(args) == 0
    exported = json.loads(dataset_path.read_text())
    viewed = json.loads(cases_path.read_text())
    assert [case["name"] for case in exported["cases"]] == [
        case["name"] for case in viewed["cases"]
    ]
