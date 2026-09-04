"""Record real `/v1/chat` SSE fixtures for the chat contract card (C0.2).

Runs the production `stream_chat` generator against representative, deterministic
turn handlers and writes the raw SSE text to `*.sse` files next to this script.
The framing, chunk encoding, tool parts, and progressive `data-response` parts
are produced by the real runtime code path — only the model verdict is stubbed
so the output is reproducible without a live model or network.

Beside each answered capture it also writes `<name>.agent-result.json` — the same
turn's ``AgentResult`` as the eight eval evaluators read it, produced by their
own accessors. That file is the expectation the Node-side transcript shaper is
measured against (`packages/eval`, W3-2 #1300); deriving both artifacts from one
declaration of the turn is what keeps them describing the same call.

**THE COMMITTED `.sse` FILES ARE OLDER THAN THIS SCRIPT.** Measured 2026-09-04:
re-running it today reorders the answer envelope's keys and empties the search
capture's `data`, because ``agent_result_to_response`` now projects the payload
from the session registry instead of the ``data`` mapping handed to
``make_result``. Those captures are the #1283-verified wire that `apps/web`'s
suite replays, so do NOT overwrite them from a run that has not first been
checked frame-for-frame against the web replay. Everything the evaluator view
reads — intent, message, the tool calls, the data keys — is unaffected by that
drift, which is why the expectation beside them is still theirs.

Run (from the repo root):

    cd apps/agent && uv run python tests/fixtures/chat_stream/record_fixtures.py
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

# Settings validation demands these at import time; the recorder never uses a
# real DB or model, so stub values keep the script runnable and reproducible.
os.environ.setdefault("MIMO_API_KEY", "recording-stub")
os.environ.setdefault("ZEN_GO_API_KEY", "recording-stub")
os.environ.setdefault(
    "AGENT_SVC_DATABASE_URL", "postgresql://test:test@localhost:5432/test"
)

if TYPE_CHECKING:
    from animichi.agents.agent_result import AgentResult, StepRecord
    from animichi.agents.runtime_deps import OnStep, StepEvent, StepStatus
    from animichi.interfaces.routes.chat_stream import ChatHandler
    from animichi.interfaces.schemas import PublicAPIResponse

_FIXTURE_DIR = Path(__file__).parent

# The locale every capture is recorded under. It is NOT on the wire — the
# response envelope's `session` is empty by contract — so it is stated here and
# the TS reader must be told the same value; see the ``locale`` member below.
_RECORDED_LOCALE = "ja"


def _search_result(calls: Sequence[ReplayedCall]) -> AgentResult:
    from animichi.tests.unit.conftest_public_api import make_result

    data = {
        "results": {
            "kind": "bangumi",
            "bangumi_id": 12345,
            "title": "響け！ユーフォニアム",
            "row_count": 2,
            "status": "ok",
            "strategy": "bangumi",
            "summary": {"count": 2, "source": "catalog", "cache": "miss"},
            "rows": [
                {
                    "id": "p1",
                    "name": "宇治橋",
                    "latitude": 34.891,
                    "longitude": 135.807,
                    "episode": 1,
                },
                {
                    "id": "p2",
                    "name": "京阪宇治駅",
                    "latitude": 34.911,
                    "longitude": 135.806,
                    "episode": 3,
                },
            ],
        },
        "itinerary": {
            "ordered_points": [
                {
                    "id": "p1",
                    "name": "宇治橋",
                    "bangumi_id": "12345",
                    "latitude": 34.891,
                    "longitude": 135.807,
                    "episode": 1,
                },
                {
                    "id": "p2",
                    "name": "京阪宇治駅",
                    "bangumi_id": "12345",
                    "latitude": 34.911,
                    "longitude": 135.806,
                    "episode": 3,
                },
            ],
            "point_count": 2,
            "status": "ok",
            "total_walk_minutes": 12,
        },
    }
    return make_result(
        "plan_route",
        message="宇治の聖地を2件、徒歩ルートにまとめました。",
        data=data,
        steps=_step_records(calls),
    )


def _clarify_result(calls: Sequence[ReplayedCall]) -> AgentResult:
    from animichi.tests.unit.conftest_public_api import make_result

    return make_result(
        "clarify",
        message="どの作品でしょうか？",
        data={"reason": "anime_ambiguity", "candidate_ids": ["115908", "117696"]},
        steps=_step_records(calls),
    )


def _wire_response(result: AgentResult) -> PublicAPIResponse:
    from animichi.interfaces.response_builder import agent_result_to_response

    return agent_result_to_response(result, include_debug=False)


@dataclass(frozen=True)
class ReplayedCall:
    """One tool call this recorder replays, as both sides of the wire see it.

    ``params`` is what the ``running`` event carries and what ``StepRecord``
    stores; ``data`` is the ``done`` event's payload. Declaring the pair once is
    the point: the ``.sse`` capture and the ``.agent-result.json`` expectation
    beside it must describe the SAME call, and two separate literals would let
    them drift apart silently.
    """

    tool: str
    params: dict[str, object]
    data: dict[str, object]


def _step(tool: str, status: StepStatus, data: dict[str, object]) -> StepEvent:
    from animichi.agents.runtime_deps import StepEvent

    return StepEvent(tool, f"{tool}-fixture", status, data)


def _step_events(calls: Sequence[ReplayedCall]) -> list[StepEvent]:
    return [
        event
        for call in calls
        for event in (
            _step(call.tool, "running", call.params),
            _step(call.tool, "done", call.data),
        )
    ]


def _step_records(calls: Sequence[ReplayedCall]) -> list[StepRecord]:
    from animichi.agents.agent_result import StepRecord

    return [
        StepRecord(tool=call.tool, is_success=True, params=call.params, data=call.data)
        for call in calls
    ]


def _replaying_handler(
    steps: Sequence[StepEvent], response: PublicAPIResponse
) -> ChatHandler:
    async def handler(on_step: OnStep) -> PublicAPIResponse:
        for step in steps:
            await on_step(step)
        return response

    return handler


_SEARCH_CALLS = (
    ReplayedCall("resolve_anime", {"title": "ユーフォ"}, {"bangumi_id": 12345}),
    ReplayedCall("search_bangumi", {"bangumi_id": 12345}, {"row_count": 2}),
    ReplayedCall("plan_route", {}, {"point_count": 2}),
)

_CLARIFY_CALLS = (
    ReplayedCall("resolve_anime", {"title": "ハルヒ"}, {"ambiguous": True}),
)


def _error_handler() -> ChatHandler:
    async def handler(_on_step: OnStep) -> PublicAPIResponse:
        raise RuntimeError("catalog upstream unavailable")

    return handler


def _answered_handler(
    result: AgentResult, calls: Sequence[ReplayedCall]
) -> ChatHandler:
    return _replaying_handler(_step_events(calls), _wire_response(result))


def _evaluator_view(result: AgentResult, calls: Sequence[ReplayedCall]) -> str:
    """The AgentResult as the eight eval evaluators read it, as JSON.

    Produced by the REAL accessors (``evaluators._actual_tools`` /
    ``_available_data_keys``) rather than restated, because this file is the
    expectation the Node-side shaper (`packages/eval`, W3-2 #1300) is compared
    against: an expectation written by hand would only prove that two hands
    agreed. ``locale`` is the recorded request locale — the wire carries none.
    """
    from animichi.tests.eval.evaluators import _actual_tools, _available_data_keys

    return json.dumps(
        {
            "intent": result.intent,
            "success": result.success,
            "message": result.message,
            "locale": _RECORDED_LOCALE,
            "data_keys": sorted(_available_data_keys(result)),
            "step_count": len(result.steps),
            "tools": _actual_tools(result),
            "trajectory": [_recorded_step(call) for call in calls],
        },
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )


def _recorded_step(call: ReplayedCall) -> dict[str, object]:
    return {"tool_name": call.tool, "args": call.params, "status": "ok"}


async def _record(name: str, handler: ChatHandler) -> Path:
    from animichi.interfaces.routes.chat_stream import stream_chat

    frames = [frame async for frame in stream_chat(handler)]
    path = _FIXTURE_DIR / f"{name}.sse"
    path.write_text("".join(frames), encoding="utf-8")
    return path


def _write_view(name: str, result: AgentResult, calls: Sequence[ReplayedCall]) -> Path:
    path = _FIXTURE_DIR / f"{name}.agent-result.json"
    path.write_text(f"{_evaluator_view(result, calls)}\n", encoding="utf-8")
    return path


def _relative(path: Path) -> str:
    return str(path.relative_to(_FIXTURE_DIR.parents[2]))


async def _record_answered(
    name: str, calls: Sequence[ReplayedCall], result: AgentResult
) -> None:
    """One capture and the expectation beside it, from one AgentResult."""
    print(f"wrote {_relative(await _record(name, _answered_handler(result, calls)))}")
    print(f"wrote {_relative(_write_view(name, result, calls))}")


async def _record_all() -> None:
    await _record_answered("search", _SEARCH_CALLS, _search_result(_SEARCH_CALLS))
    await _record_answered("clarify", _CLARIFY_CALLS, _clarify_result(_CLARIFY_CALLS))
    # The error turn never produced an AgentResult — the handler raises before
    # one exists — so it has a capture and no expectation to sit beside it.
    print(f"wrote {_relative(await _record('error', _error_handler()))}")


if __name__ == "__main__":
    asyncio.run(_record_all())
