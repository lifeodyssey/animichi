"""Shared eval infrastructure for all eval layers.

Provides dataset loading and model precheck utilities.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

CASE_TIMEOUT_S = 60

# Fake credentials the parent tests/conftest.py injects via os.environ.setdefault.
# Eval may replace these (and unset vars) from .env, but a real value already in
# the process environment (CI secret, rotated key, model override) must win.
_ENV_FAKE_SENTINELS = frozenset(
    {"test-key", "postgresql://test:test@localhost:5432/test"}
)


def real_env_updates(
    file_values: Mapping[str, str | None],
    environ: Mapping[str, str],
) -> dict[str, str]:
    """Return the .env entries to apply without clobbering the real process env.

    A key is applied only when the current environment value is missing or is one
    of the parent conftest's fake sentinels — so CI secrets and rotated keys win.
    """
    updates: dict[str, str] = {}
    for key, value in file_values.items():
        if value is None:
            continue
        current = environ.get(key)
        if current is None or current in _ENV_FAKE_SENTINELS:
            updates[key] = value
    return updates


@dataclass
class EvalCase:
    """A single eval case loaded from a dataset JSON file."""

    id: str
    query: str
    locale: str
    expected_steps: list[str]
    expected_intent: str
    context: dict[str, object] | None = field(default=None)


def load_dataset(path: Path) -> list[EvalCase]:
    """Load a dataset JSON file and return typed EvalCase objects.

    Raises FileNotFoundError when the file does not exist.
    """
    text = path.read_text()
    rows: list[dict[str, object]] = json.loads(text)
    cases: list[EvalCase] = []
    for row in rows:
        raw_steps = row["expected_steps"]
        steps = list(raw_steps) if isinstance(raw_steps, list) else []
        raw_context = row.get("context")
        context: dict[str, object] | None = None
        if isinstance(raw_context, dict):
            context = raw_context
        cases.append(
            EvalCase(
                id=str(row["id"]),
                query=str(row["query"]),
                locale=str(row["locale"]),
                expected_steps=steps,
                expected_intent=str(row["expected_intent"]),
                context=context,
            )
        )
    return cases


@dataclass
class JourneyCase:
    """A single journey-eval case loaded from runtime_journey_v1.json."""

    id: str
    query: str
    locale: str
    expected_stage: str
    expected_message_min_len: int
    expected_data_keys: list[str]
    expected_results_keys: list[str] = field(default_factory=list)
    expected_nearby_fields: list[str] = field(default_factory=list)
    expected_route_keys: list[str] = field(default_factory=list)


def _str_list(row: dict[str, object], key: str, *, required: bool = False) -> list[str]:
    """Extract a list of strings from a JSON row, defaulting to empty."""
    raw = row.get(key)
    if required and not isinstance(raw, list):
        query = row.get("query", "<unknown>")
        raise ValueError(f"Dataset row '{query}' missing required key: {key}")
    return [str(k) for k in raw] if isinstance(raw, list) else []


def load_journey_dataset(path: Path) -> list[JourneyCase]:
    """Load a journey-eval dataset JSON and return typed JourneyCase objects."""
    text = path.read_text()
    rows: list[dict[str, object]] = json.loads(text)
    return [
        JourneyCase(
            id=str(row["id"]),
            query=str(row["query"]),
            locale=str(row["locale"]),
            expected_stage=str(row["expected_stage"]),
            expected_message_min_len=int(row["expected_message_min_len"]),
            expected_data_keys=_str_list(row, "expected_data_keys", required=True),
            expected_results_keys=_str_list(row, "expected_results_keys"),
            expected_nearby_fields=_str_list(row, "expected_nearby_fields"),
            expected_route_keys=_str_list(row, "expected_route_keys"),
        )
        for row in rows
    ]


async def precheck_model(model_id: str) -> None:
    """Verify that the model endpoint is reachable.

    Raises RuntimeError when the model cannot be reached.
    """
    from agent.agents.base import parse_model_spec

    model = parse_model_spec(model_id, use_settings_fallbacks=False)
    if model is None:
        raise RuntimeError(f"Cannot build model for {model_id}")
