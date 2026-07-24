"""Compact model-authored outputs for the Animichi runtime."""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from agent.agents.session_state import ClarificationReason


class _CompactOutput(BaseModel):
    """Forbid the retired model-authored intent, data, and UI envelopes."""

    model_config = ConfigDict(extra="forbid")

    message: str = Field(description="The natural-language reply shown to the user.")


class SearchResponseModel(_CompactOutput):
    """Brief prose wrapper for a registry-backed search response."""

    message: str = Field(
        description=(
            "Brief 1-2 sentence wrapper around a completed search; the app "
            "renders results from typed SessionState, so never re-type points, "
            "counts, or titles here."
        )
    )


class RouteResponseModel(_CompactOutput):
    """Brief prose wrapper for a registry-backed route response."""

    message: str = Field(
        description=(
            "Brief 1-2 sentence wrapper around a completed route; the app "
            "renders the route from typed SessionState, so never re-type stops, "
            "legs, or times here."
        )
    )


class GreetingResponseModel(_CompactOutput):
    """Brief greeting, thanks, farewell, or capability introduction."""

    message: str = Field(
        description=(
            "A standalone greeting, thanks, farewell, or capability-"
            "introduction reply; there is no search or route data to summarize."
        )
    )


class ClarifyResponseModel(_CompactOutput):
    """Terminal clarification output with stable candidate identity only."""

    message: str = Field(
        description=(
            "Brief 1-2 sentence prompt asking the user to disambiguate; the "
            "app renders candidate names from candidate_ids, so never restate "
            "them here."
        )
    )
    reason: ClarificationReason = Field(
        description=(
            "The disambiguation reason; must exactly match the pending tool "
            "outcome's own reason (anime_ambiguity, place_ambiguity, "
            "place_too_broad, unknown_place, missing_location, or "
            "anime_not_found)."
        )
    )
    candidate_ids: list[str] = Field(
        description=(
            "Candidate identifiers in the exact order the pending tool outcome "
            "supplied; never invented, reordered, or partially copied."
        )
    )

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

    message: str = Field(
        description=(
            "A full, appropriately-long general-QA answer; the prose IS the "
            "content, so never truncate it to one line."
        )
    )


class PartialResponseModel(_CompactOutput):
    """Runner-authored notice for a graceful incomplete result."""


class BlockedResponseModel(_CompactOutput):
    """Runner-authored refusal for a blocked user prompt."""


class ErrorResponseModel(_CompactOutput):
    """Runner-authored notice for an unexpected tool or agent-loop failure.

    SD-18: the uniform payload the error-boundary hook maps every otherwise
    unhandled exception onto. Never one of the model's own output_type choices.
    """

    error: Literal[True] = Field(
        default=True,
        description="Discriminator marking this as a uniform error payload.",
    )


RuntimeStageOutput = (
    ClarifyResponseModel
    | SearchResponseModel
    | RouteResponseModel
    | GreetingResponseModel
    | QAResponseModel
)

AgentResultOutput = (
    RuntimeStageOutput
    | PartialResponseModel
    | BlockedResponseModel
    | ErrorResponseModel
)
