"""Unit tests for the AI SDK SSE frame encoder (chat_stream_frames).

Covers the ToolPartTranslator's error-status branch and its terminal-error
flush, the two frame paths the happy-path route tests do not reach.
"""

from __future__ import annotations

from animichi.agents.runtime_deps import StepEvent
from animichi.interfaces.chat_stream_frames import (
    ToolPartTranslator,
    chat_response_wire,
)
from animichi.interfaces.schemas import PublicAPIResponse


def test_translate_error_status_emits_output_error_frame() -> None:
    translator = ToolPartTranslator()
    frames = translator.translate(
        StepEvent(tool="plan_route", call_id="call-9", status="error", data={})
    )

    assert len(frames) == 1
    assert '"type":"tool-output-error"' in frames[0]
    assert "call-9" in frames[0]
    assert frames[0].startswith("data: ")


def test_output_progress_emits_reconcilable_data_part() -> None:
    frames = ToolPartTranslator().translate(
        StepEvent(
            tool="greet_user",
            call_id="output-call",
            status="running",
            data={},
            kind="output",
        )
    )

    assert len(frames) == 1
    assert '"type":"data-response"' in frames[0]
    assert '"id":"response"' in frames[0]
    assert '"data":{"intent":"greet_user"}' in frames[0]


def test_error_status_does_not_leave_active_call() -> None:
    translator = ToolPartTranslator()
    translator.translate(
        StepEvent(tool="resolve_anime", call_id="call-1", status="error", data={})
    )

    assert translator.terminal_errors() == []


def test_terminal_errors_flush_active_calls_as_error_frames() -> None:
    translator = ToolPartTranslator()
    translator.translate(
        StepEvent(tool="search_bangumi", call_id="call-2", status="running", data={})
    )

    frames = translator.terminal_errors()

    assert len(frames) == 1
    assert '"type":"tool-output-error"' in frames[0]
    assert "call-2" in frames[0]
    assert translator.terminal_errors() == []


def test_clarify_wire_drops_non_dict_candidates() -> None:
    response = PublicAPIResponse(
        success=False,
        status="ok",
        intent="clarify",
        data={
            "reason": "anime_ambiguity",
            "candidates": ["not-a-dict", {"id": "c1", "title": "Keep"}],
        },
    )

    wire = chat_response_wire(response)

    assert wire["data"]["candidates"] == [{"id": "c1", "title": "Keep"}]


def test_search_wire_keeps_a_top_level_title() -> None:
    response = PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        data={
            "results": {
                "bangumi_id": "485",
                "title": "Haruhi",
                "rows": [],
                "metadata": {"anime_title": "Other"},
            }
        },
    )

    wire = chat_response_wire(response)

    assert wire["data"]["results"]["title"] == "Haruhi"


def test_search_wire_omits_title_when_absent_everywhere() -> None:
    response = PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        data={"results": {"bangumi_id": "485", "metadata": {}}},
    )

    wire = chat_response_wire(response)

    assert "title" not in wire["data"]["results"]
