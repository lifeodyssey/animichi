"""Native history-compaction strategy and configuration."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from typing import Generic

from pydantic_ai import RunContext
from pydantic_ai._run_context import AgentDepsT
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelRequestPart,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai_harness.compaction import (
    SlidingWindow,
    SummarizingCompaction,
    TieredCompaction,
)

from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.session_state import SessionState

HISTORY_MAX_TOKENS = 5_500
HISTORY_KEEP_TOKENS = 1_100
SUMMARY_KEEP_TOKENS = 900
KEEP_RECENT_MESSAGES = 8
TOOL_RETURN_MAX_CHARS = 200

SUMMARY_PROMPT = """\
Summarize the older conversation so the Animichi agent can continue it accurately.
Preserve every clarify candidate and every structured entity VERBATIM, including anime
titles, point names, IDs, and ordered candidate lists. Never reorder, rename, translate,
merge, or omit candidates. Ordinal follow-ups such as "the first one", "第一个", and
"1番目のやつ" must still resolve to the same candidate after this summary.
Retain the user's intent, decisions, completed tool results, and unresolved next step.
Respond only with the compact continuation context.

<messages>
{messages}
</messages>\
"""

ToolSummary = Callable[[str, object], str]

# Task 5 (OQ-8(c)): tool arguments that carry a literal, user-supplied entity
# string worth rescuing verbatim across compaction — an anime title or a
# place name, keyed by the tool call's own argument name.
_ENTITY_ARG_FIELDS: dict[str, str] = {
    "resolve_anime": "title",
    "search_nearby": "location",
}


def _entity_from_call_args(tool_name: str, args: object) -> str | None:
    """Extract the literal entity argument, if any. `args` may be `None`
    (no matching `ToolCallPart`, e.g. an orphaned or already-compacted-away
    call) — that is folded in here rather than guarded separately upstream."""
    field = _ENTITY_ARG_FIELDS.get(tool_name)
    if field is None or not isinstance(args, Mapping):
        return None
    value = args.get(field)
    return value if isinstance(value, str) and value.strip() else None


def _tool_calls_in(message: ModelMessage) -> list[ToolCallPart]:
    if not isinstance(message, ModelResponse):
        return []
    return [part for part in message.parts if isinstance(part, ToolCallPart)]


def _call_args_by_id(messages: list[ModelMessage]) -> dict[str, Mapping[str, object]]:
    """Map each tool call's id to its own arguments, read from `ModelResponse`
    parts. `CompactToolReturns` otherwise only sees the paired `ModelRequest`
    tool-return message, which carries the (compact) result, not the call."""
    lookup: dict[str, Mapping[str, object]] = {}
    for message in messages:
        for call in _tool_calls_in(message):
            lookup[call.tool_call_id] = call.args_as_dict()
    return lookup


def _session_of(ctx: object) -> SessionState | None:
    """Exception-free lookup of the live session from `ctx.deps`.

    Degrades to `None` for any shape that isn't a real production
    `RunContext[RuntimeDeps]` (including the `None` sentinel some other
    compaction unit tests pass for `ctx`), matching the error-path AC: a
    lookup miss never raises out of the compaction tier.
    """
    deps = getattr(ctx, "deps", None)
    return deps.tool_state.session if isinstance(deps, RuntimeDeps) else None


def _current_anime_title(session: SessionState) -> str | None:
    return session.current_anime.title if session.current_anime is not None else None


def _mapping(content: object) -> Mapping[str, object] | None:
    if isinstance(content, Mapping):
        return content
    if not isinstance(content, str):
        return None
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, Mapping) else None


def _candidate_summary(content: object) -> str | None:
    data = _mapping(content)
    if data is None or data.get("outcome") != "needs_disambiguation":
        return None
    candidate_ids = data.get("candidate_ids")
    if not isinstance(candidate_ids, list):
        return None
    encoded = json.dumps(candidate_ids, ensure_ascii=False, separators=(",", ":"))
    return f"[resolve_anime: ambiguous, ordered_candidates={encoded}]"


@dataclass(frozen=True)
class CompactToolReturns(Generic[AgentDepsT]):
    """Deterministically shrink old tool returns while retaining candidates.

    `frozen=True` only means this dataclass's own two fields never change;
    `compact()` is not otherwise a pure transform — when `ctx.deps` carries a
    live session (production `RuntimeDeps`), it mutates the shared
    `session.compaction_retained_entities` ledger as a side effect (Task 5,
    OQ-8(c)). That mutation can happen more than once per turn (once per
    compacted `ToolReturnPart` in a multi-tool-call loop) and again on every
    later turn, because `session_facade.build_message_history` replays every
    past interaction's raw messages unchanged each turn rather than storing
    a compacted version — `RetainedEntityLedger`'s dedup/oldest-wins policy
    is what keeps that repeated replay from being observable as growth.
    """

    summarize: ToolSummary
    keep_recent: int = KEEP_RECENT_MESSAGES

    async def compact(
        self, messages: list[ModelMessage], ctx: RunContext[AgentDepsT]
    ) -> list[ModelMessage]:
        cutoff = max(0, len(messages) - self.keep_recent)
        call_args = _call_args_by_id(messages)
        session = _session_of(ctx)
        return [
            self._compact_message(message, i < cutoff, call_args, session)
            for i, message in enumerate(messages)
        ]

    def _compact_message(
        self,
        message: ModelMessage,
        old: bool,
        call_args: dict[str, Mapping[str, object]],
        session: SessionState | None,
    ) -> ModelMessage:
        if not old or not isinstance(message, ModelRequest):
            return message
        parts = [
            self._compact_return(part, call_args, session) for part in message.parts
        ]
        return replace(message, parts=parts)

    def _compact_return(
        self,
        part: ModelRequestPart,
        call_args: dict[str, Mapping[str, object]],
        session: SessionState | None,
    ) -> ModelRequestPart:
        if not isinstance(part, ToolReturnPart):
            return part
        self._retain_entity(part, call_args, session)
        if len(str(part.content)) <= TOOL_RETURN_MAX_CHARS:
            return part
        summary = self._summary(part.tool_name, part.content)
        return replace(part, content=summary)

    def _retain_entity(
        self,
        part: ToolReturnPart,
        call_args: dict[str, Mapping[str, object]],
        session: SessionState | None,
    ) -> None:
        """Task 5 (OQ-8(c)): rescue a literal call argument verbatim into
        session state before this tool return is shrunk to a summary.

        Skips a value that already equals `session.current_anime.title` —
        that title is already carried, unabridged, by `current_anime` (and,
        while still ambiguous, by `_candidate_summary`), so retaining it a
        second time here would just double-pay the same prompt budget.
        """
        if session is None:
            return
        value = _entity_from_call_args(part.tool_name, call_args.get(part.tool_call_id))
        if value is None or value == _current_anime_title(session):
            return
        session.compaction_retained_entities.record(part.tool_name, value)

    def _summary(self, tool_name: str, content: object) -> str:
        candidates = (
            _candidate_summary(content) if tool_name == "resolve_anime" else None
        )
        return (
            candidates if candidates is not None else self.summarize(tool_name, content)
        )


def native_history_compaction(summarize: ToolSummary) -> TieredCompaction[RuntimeDeps]:
    """Build cheap-to-expensive native history compaction."""
    return TieredCompaction(
        tiers=[
            CompactToolReturns[RuntimeDeps](summarize),
            # This summary request consumes the outer run's UsageLimits, so
            # request_limit must leave one call beyond the main model request.
            SummarizingCompaction(
                model=None,
                max_tokens=HISTORY_MAX_TOKENS,
                keep_tokens=SUMMARY_KEEP_TOKENS,
                summary_prompt=SUMMARY_PROMPT,
                preserve_first_user_message=True,
            ),
            SlidingWindow(
                # Required by SlidingWindow validation; TieredCompaction owns triggering.
                max_tokens=HISTORY_MAX_TOKENS,
                keep_tokens=HISTORY_KEEP_TOKENS,
                preserve_first_user_message=False,
            ),
        ],
        target_tokens=HISTORY_MAX_TOKENS,
    )
