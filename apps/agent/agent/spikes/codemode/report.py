"""Leaf report schema shared by the CodeMode recorder and JSON comparator."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Arm = Literal["baseline", "codemode"]


class PreregisteredCriteria(BaseModel):
    model_config = ConfigDict(frozen=True)
    minimum_requests_reduction: float = 0.40
    maximum_latency_ratio: float = 1.0
    require_valid_typed_outputs: bool = True
    allow_new_tool_error_classes: bool = False


PREREGISTERED_CRITERIA = PreregisteredCriteria()


class RunMeasurement(BaseModel):
    query: str
    repeat: int
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    latency_seconds: float
    output_type: str | None = None
    valid_typed_output: bool = False
    tool_call_count: int = 0
    tool_error_classes: list[str] = []
    exception_type: str | None = None
    exception: str | None = None


class BenchmarkReport(BaseModel):
    schema_version: Literal[1] = 1
    arm: Arm
    model: str
    repeats: int
    queries: list[str]
    criteria: PreregisteredCriteria = PREREGISTERED_CRITERIA
    output_schema_digest: str | None = None
    error_bearing_run_count: int | None = None
    total_tool_failure_count: int | None = None
    runs: list[RunMeasurement]
