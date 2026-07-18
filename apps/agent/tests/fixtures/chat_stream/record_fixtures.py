"""Record real `/v1/chat` SSE fixtures for the chat contract card (C0.2).

Runs the production `stream_chat` generator against representative, deterministic
turn handlers and writes the raw SSE text to `*.sse` files next to this script.
The framing, chunk encoding, tool parts, and progressive `data-response` parts
are produced by the real runtime code path — only the model verdict is stubbed
so the output is reproducible without a live model or network.

Run (from the repo root):

    cd apps/agent && uv run python tests/fixtures/chat_stream/record_fixtures.py
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Sequence
from pathlib import Path
from typing import TYPE_CHECKING

# Settings validation demands these at import time; the recorder never uses a
# real DB or model, so stub values keep the script runnable and reproducible.
os.environ.setdefault("MIMO_API_KEY", "recording-stub")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test")

if TYPE_CHECKING:
    from agent.agents.runtime_deps import OnStep, StepEvent
    from agent.interfaces.routes.chat_stream import ChatHandler
    from agent.interfaces.schemas import PublicAPIResponse

_FIXTURE_DIR = Path(__file__).parent


def _search_response() -> PublicAPIResponse:
    from agent.interfaces.schemas import PublicAPIResponse

    results = {
        "kind": "bangumi",
        "bangumi_id": 12345,
        "title": "響け！ユーフォニアム",
        "row_count": 2,
        "status": "ok",
        "strategy": "bangumi",
        "summary": {"count": 2, "source": "catalog", "cache": "miss"},
        "rows": [
            {"id": "p1", "name": "宇治橋", "lat": 34.891, "lng": 135.807, "ep": 1},
            {"id": "p2", "name": "京阪宇治駅", "lat": 34.911, "lng": 135.806, "ep": 3},
        ],
    }
    route = {
        "ordered_points": ["p1", "p2"],
        "point_count": 2,
        "status": "ok",
        "total_walk_minutes": 12,
    }
    return PublicAPIResponse(
        success=True,
        status="ok",
        intent="plan_route",
        message="宇治の聖地を2件、徒歩ルートにまとめました。",
        data={"results": results, "route": route},
        ui={"component": "RoutePlannerWizard"},
    )


def _clarify_response() -> PublicAPIResponse:
    from agent.interfaces.schemas import PublicAPIResponse

    return PublicAPIResponse(
        success=True,
        status="needs_clarification",
        intent="clarify",
        message="どの作品でしょうか？",
        data={
            "reason": "title_ambiguous",
            "clarification_id": 1,
            "candidates": [
                {"id": "115908", "title": "涼宮ハルヒの憂鬱", "cover_url": None},
                {"id": "117696", "title": "涼宮ハルヒの消失", "cover_url": None},
            ],
        },
        ui={"component": "Clarification"},
    )


def _step(tool: str, status: str, data: dict[str, object]) -> StepEvent:
    from agent.agents.runtime_deps import StepEvent

    return StepEvent(tool=tool, status=status, data=data)


def _replaying_handler(
    steps: Sequence[StepEvent], response: PublicAPIResponse
) -> ChatHandler:
    async def handler(on_step: OnStep) -> PublicAPIResponse:
        for step in steps:
            await on_step(step)
        return response

    return handler


def _search_handler() -> ChatHandler:
    steps = [
        _step("resolve_anime", "running", {"title": "ユーフォ"}),
        _step("resolve_anime", "done", {"bangumi_id": 12345}),
        _step("search_bangumi", "running", {"bangumi_id": 12345}),
        _step("search_bangumi", "done", {"row_count": 2}),
        _step("plan_route", "running", {}),
        _step("plan_route", "done", {"point_count": 2}),
    ]
    return _replaying_handler(steps, _search_response())


def _clarify_handler() -> ChatHandler:
    steps = [
        _step("resolve_anime", "running", {"title": "ハルヒ"}),
        _step("resolve_anime", "done", {"ambiguous": True}),
    ]
    return _replaying_handler(steps, _clarify_response())


def _error_handler() -> ChatHandler:
    async def handler(_on_step: OnStep) -> PublicAPIResponse:
        raise RuntimeError("catalog upstream unavailable")

    return handler


async def _record(name: str, handler: ChatHandler) -> Path:
    from agent.interfaces.routes.chat_stream import stream_chat

    frames = [frame async for frame in stream_chat(handler)]
    path = _FIXTURE_DIR / f"{name}.sse"
    path.write_text("".join(frames), encoding="utf-8")
    return path


async def _record_all() -> None:
    for name, handler in (
        ("search", _search_handler()),
        ("clarify", _clarify_handler()),
        ("error", _error_handler()),
    ):
        path = await _record(name, handler)
        print(f"wrote {path.relative_to(_FIXTURE_DIR.parents[2])}")


if __name__ == "__main__":
    asyncio.run(_record_all())
