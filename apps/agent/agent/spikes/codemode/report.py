"""JSON contracts shared by the rematch runner and paired comparator."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Arm = Literal["control", "codemode-taught"]
Verdict = Literal["ADOPT", "BENCH AGAIN", "KILL"]
OFFICIAL_V1_METRICS = (
    "argument_correctness",
    "tool_correctness",
    "trajectory_match",
    "max_tool_calls",
    "data_keys_present",
    "locale_match",
    "nonempty_results",
    "step_efficiency",
)


class CaseMeasurement(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    scores: dict[str, float] = {}
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    error: str | None = None


class RematchReport(BaseModel):
    model_config = ConfigDict(frozen=True)

    schema_version: Literal[2] = 2
    arm: Arm
    model: str
    evaluator_version: Literal["official-v1"] = "official-v1"
    dataset: str
    subset_digest: str
    case_ids: list[str]
    scores: dict[str, float]
    request_p95: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    estimated_cost_usd: float
    cases: list[CaseMeasurement]
