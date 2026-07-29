"""Small runtime dependency container around the typed SessionState registry."""

from __future__ import annotations

from typing import TypeAlias, cast

from pydantic import BaseModel, ConfigDict, Field

from agent.agents.session_state import SessionState

LegacyPayload: TypeAlias = dict[str, object]


class ToolState(BaseModel):
    """Non-result run inputs plus the sole typed response carrier."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    session: SessionState = Field(default_factory=SessionState)
    locale: str | None = None
    last_location: str | None = None
    origin_lat: float | None = None
    origin_lng: float | None = None

    def to_legacy_dict(self) -> LegacyPayload:
        """Expose only non-carrier diagnostics during the AgentResult migration."""
        return cast(
            LegacyPayload,
            self.model_dump(mode="json", exclude_unset=True, exclude={"session"}),
        )
