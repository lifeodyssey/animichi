"""Compact model-authored outputs for the Animichi runtime."""

from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict, field_validator

from agent.agents.session_state import ClarificationReason


class _CompactOutput(BaseModel):
    """Forbid the retired model-authored intent, data, and UI envelopes."""

    model_config = ConfigDict(extra="forbid")

    message: str


class SearchResponseModel(_CompactOutput):
    """Brief prose wrapper for a registry-backed search response."""


class RouteResponseModel(_CompactOutput):
    """Brief prose wrapper for a registry-backed route response."""


class GreetingResponseModel(_CompactOutput):
    """Brief greeting, thanks, farewell, or capability introduction."""


class ClarifyResponseModel(_CompactOutput):
    """Terminal clarification output with stable candidate identity only."""

    reason: ClarificationReason
    candidate_ids: list[str]

    @field_validator("candidate_ids", mode="before")
    @classmethod
    def _coerce_stringified_list(cls, value: object) -> object:
        """Accept MiMo's JSON-stringified list while preserving strict items."""
        if not isinstance(value, str):
            return value
        try:
            return json.loads(value)
        except (ValueError, TypeError, RecursionError):
            return value


class QAResponseModel(_CompactOutput):
    """Full prose answer; the message intentionally has no length cap."""


class PartialResponseModel(_CompactOutput):
    """Runner-authored notice for a graceful incomplete result."""


RuntimeStageOutput = (
    ClarifyResponseModel
    | SearchResponseModel
    | RouteResponseModel
    | GreetingResponseModel
    | QAResponseModel
)

AgentResultOutput = RuntimeStageOutput | PartialResponseModel
