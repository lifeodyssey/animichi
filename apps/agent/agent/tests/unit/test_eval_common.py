"""Unit tests for eval_common shared infrastructure."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent.tests.eval.eval_common import (
    CASE_TIMEOUT_S,
    EvalCase,
    load_dataset,
    real_env_updates,
)


def test_case_timeout_is_60() -> None:
    assert CASE_TIMEOUT_S == 60


def test_real_env_updates_only_fills_unset_values() -> None:
    file_values = {"UNSET": "from-file", "EXISTING": "stale-file-value"}
    updates = real_env_updates(file_values, {"EXISTING": "process-value"})

    assert updates == {"UNSET": "from-file"}


class TestLoadDataset:
    def test_returns_typed_eval_case_objects(self, tmp_path: Path) -> None:
        dataset = [
            {
                "id": "test-01",
                "query": "test query",
                "locale": "ja",
                "expected_steps": ["resolve_anime", "search_bangumi"],
                "expected_intent": "search_bangumi",
            },
        ]
        path = tmp_path / "dataset.json"
        path.write_text(json.dumps(dataset))

        cases = load_dataset(path)

        assert len(cases) == 1
        case = cases[0]
        assert isinstance(case, EvalCase)
        assert case.id == "test-01"
        assert case.query == "test query"
        assert case.locale == "ja"
        assert case.expected_steps == ["resolve_anime", "search_bangumi"]
        assert case.expected_intent == "search_bangumi"

    def test_returns_multiple_cases(self, tmp_path: Path) -> None:
        dataset = [
            {
                "id": f"case-{i:02d}",
                "query": f"query {i}",
                "locale": "en",
                "expected_steps": ["greet_user"],
                "expected_intent": "greet",
            }
            for i in range(3)
        ]
        path = tmp_path / "dataset.json"
        path.write_text(json.dumps(dataset))

        cases = load_dataset(path)
        assert len(cases) == 3

    def test_loads_context_field(self, tmp_path: Path) -> None:
        dataset = [
            {
                "id": "ctx-01",
                "query": "query with context",
                "locale": "ja",
                "expected_steps": ["resolve_anime"],
                "expected_intent": "search_bangumi",
                "context": {"bangumi_id": 123},
            },
        ]
        path = tmp_path / "dataset.json"
        path.write_text(json.dumps(dataset))

        cases = load_dataset(path)

        assert cases[0].context == {"bangumi_id": 123}

    def test_context_defaults_to_none(self, tmp_path: Path) -> None:
        dataset = [
            {
                "id": "no-ctx",
                "query": "no context",
                "locale": "en",
                "expected_steps": ["greet_user"],
                "expected_intent": "greet",
            },
        ]
        path = tmp_path / "dataset.json"
        path.write_text(json.dumps(dataset))

        cases = load_dataset(path)

        assert cases[0].context is None

    def test_raises_on_missing_file(self) -> None:
        with pytest.raises(FileNotFoundError):
            load_dataset(Path("/nonexistent/dataset.json"))
