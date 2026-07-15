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
    ToolReturnPart,
)
from pydantic_ai_harness.compaction import (
    SlidingWindow,
    SummarizingCompaction,
    TieredCompaction,
)

from agent.agents.runtime_deps import RuntimeDeps

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
    if data is None or data.get("ambiguous") is not True:
        return None
    candidates = data.get("candidates")
    if not isinstance(candidates, list):
        return None
    encoded = json.dumps(candidates, ensure_ascii=False, separators=(",", ":"))
    return f"[resolve_anime: ambiguous, ordered_candidates={encoded}]"


@dataclass(frozen=True)
class CompactToolReturns(Generic[AgentDepsT]):
    """Deterministically shrink old tool returns while retaining candidates."""

    summarize: ToolSummary
    keep_recent: int = KEEP_RECENT_MESSAGES

    async def compact(
        self, messages: list[ModelMessage], ctx: RunContext[AgentDepsT]
    ) -> list[ModelMessage]:
        del ctx
        cutoff = max(0, len(messages) - self.keep_recent)
        return [
            self._compact_message(message, i < cutoff)
            for i, message in enumerate(messages)
        ]

    def _compact_message(self, message: ModelMessage, old: bool) -> ModelMessage:
        if not old or not isinstance(message, ModelRequest):
            return message
        parts = [self._compact_return(part) for part in message.parts]
        return replace(message, parts=parts)

    def _compact_return(self, part: ModelRequestPart) -> ModelRequestPart:
        if (
            not isinstance(part, ToolReturnPart)
            or len(str(part.content)) <= TOOL_RETURN_MAX_CHARS
        ):
            return part
        summary = self._summary(part.tool_name, part.content)
        return replace(part, content=summary)

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
                max_tokens=HISTORY_MAX_TOKENS,
                keep_tokens=HISTORY_KEEP_TOKENS,
                preserve_first_user_message=False,
            ),
        ],
        target_tokens=HISTORY_MAX_TOKENS,
    )
