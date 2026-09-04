"""The vocabulary one evaluator-oracle scenario is written in (#1301).

A scenario describes one agent turn at the level the evaluators read it: what
the case asked for, what the turn produced, and what each tool call recorded.
The scenarios themselves live in `evaluator_oracle_cases.py`; turning one into
Python objects is `evaluator_oracle_context.py`'s job, and projecting it onto
the wire shape `packages/eval/src/turn-transcript.ts` publishes is
`evaluator_oracle.py`'s.

The vocabulary is deliberately no richer than the wire. W3-2 (#1300) reads the
trajectory out of the SD-9 stream frames, which publish one `args` record per
call and nothing else about it — no normalized `params`, no `model_initiated`
flag. A scenario that could express more than that would let this oracle prove
a parity the TypeScript side has no way to reach.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

StepStatus = Literal["ok", "error", "unsettled"]
"""How a call ended. `unsettled` = the stream said it was made, never how it
ended; the span-tree ports treat it as not-successful, exactly like `error`."""


@dataclass(frozen=True)
class OracleStep:
    """One tool call: its name, the arguments published for it, its outcome."""

    tool: str
    args: dict[str, object] = field(default_factory=dict)
    status: StepStatus = "ok"


@dataclass(frozen=True)
class OracleItinerary:
    """The itinerary registry entry `_nonempty` and `_available_data_keys` read."""

    ordered_point_count: int
    source_row_count: int | None
    """`None` = no usable source search entry (absent ref, or a ref that misses)."""


@dataclass(frozen=True)
class OracleScenario:
    """One case: its inputs, its expectations, and the turn it produced."""

    case_id: str
    query: str
    locale: str
    intent: str
    message: str
    acceptable_stages: list[str] = field(default_factory=list)
    steps: list[OracleStep] = field(default_factory=list)
    data_keys: list[str] = field(default_factory=list)
    expect_nonempty: bool = False
    selected_point_ids: list[str] | None = None
    selected_candidate_ids: list[str] | None = None
    seeded_pending: dict[str, object] | None = None
    clarification_id: int | None = None
    pending_clarification: bool = False
    search_row_count: int | None = None
    itinerary: OracleItinerary | None = None
