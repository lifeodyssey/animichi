"""Serializable settlement payload for the durable turn outbox (AC5).

The settlement port extracts everything an external-effect dispatcher needs to
apply usage / quota / audit onto plain JSON-safe values at enqueue time, so
the outbox row never carries framework or PydanticAI types and survives a
process restart verbatim. No FastAPI / PydanticAI import may appear here.
Each row is scoped to one ``OutboxKind`` but shares the same frozen payload;
the dispatcher applies only the sub-effect matching the row's kind.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Payer scope for one metered model call ("platform" | "byok").
Payer = str


@dataclass(frozen=True)
class UsageItem:
    """One metered model call, reduced to JSON-safe counts (AC5)."""

    payer: Payer
    requests: int
    prompt_tokens: int
    completion_tokens: int


@dataclass(frozen=True)
class SettlementPayload:
    """The durable, serializable description of one settled turn's effects."""

    session_id: str | None
    user_id: str | None
    user_type: str | None
    is_byok: bool
    settle_quota: bool
    elapsed_ms: int
    intent: str
    status: str
    request_text: str
    locale: str
    user_message_persisted: bool
    usage: tuple[UsageItem, ...] = ()
    plan_steps: list[str] | None = None

    def to_json(self) -> dict[str, object]:
        """Encode to JSON-safe object for the outbox ``payload`` column."""
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "user_type": self.user_type,
            "is_byok": self.is_byok,
            "settle_quota": self.settle_quota,
            "elapsed_ms": self.elapsed_ms,
            "intent": self.intent,
            "status": self.status,
            "request_text": self.request_text,
            "locale": self.locale,
            "user_message_persisted": self.user_message_persisted,
            "usage": [
                {
                    "payer": item.payer,
                    "requests": item.requests,
                    "prompt_tokens": item.prompt_tokens,
                    "completion_tokens": item.completion_tokens,
                }
                for item in self.usage
            ],
            "plan_steps": self.plan_steps,
        }

    @classmethod
    def from_json(cls, raw: object) -> SettlementPayload | None:
        """Decode a row's JSON payload back into a typed settlement payload."""
        if not isinstance(raw, dict):
            return None
        usage_raw = raw.get("usage")
        if not isinstance(usage_raw, list):
            return None
        usage: list[UsageItem] = []
        for item in usage_raw:
            if not isinstance(item, dict):
                return None
            usage.append(
                UsageItem(
                    payer=str(item.get("payer")),
                    requests=int(item.get("requests", 0)),
                    prompt_tokens=int(item.get("prompt_tokens", 0)),
                    completion_tokens=int(item.get("completion_tokens", 0)),
                )
            )
        steps = raw.get("plan_steps")
        return cls(
            session_id=_str_or_none(raw.get("session_id")),
            user_id=_str_or_none(raw.get("user_id")),
            user_type=_str_or_none(raw.get("user_type")),
            is_byok=bool(raw.get("is_byok", False)),
            settle_quota=bool(raw.get("settle_quota", False)),
            elapsed_ms=int(raw.get("elapsed_ms", 0)),
            intent=str(raw.get("intent", "unknown")),
            status=str(raw.get("status", "ok")),
            request_text=str(raw.get("request_text", "")),
            locale=str(raw.get("locale", "ja")),
            user_message_persisted=bool(raw.get("user_message_persisted", True)),
            usage=tuple(usage),
            plan_steps=[str(s) for s in steps] if isinstance(steps, list) else None,
        )


def _str_or_none(value: object) -> str | None:
    return str(value) if value is not None else None
