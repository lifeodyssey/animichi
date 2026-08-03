"""Small runtime dependency container around the typed SessionState registry."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from agent.agents.session_state import SessionState


class ToolState(BaseModel):
    """Non-result run inputs plus the sole typed response carrier."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    session: SessionState = Field(default_factory=SessionState)
    locale: str | None = None
    last_location: str | None = None
    origin_lat: float | None = None
    origin_lng: float | None = None
