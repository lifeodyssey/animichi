"""Static contract for issue-19 cases awaiting model-backed evaluation."""

from __future__ import annotations

import json
from pathlib import Path


def test_user_memory_eval_cases_remain_pending_and_issue_tagged() -> None:
    path = Path(__file__).parents[1] / "eval" / "cases" / "user_memory_cases.json"
    cases = json.loads(path.read_text())

    assert len(cases) == 4
    assert {case["id"] for case in cases} == {
        "MEM19_PREFERENCE_001",
        "MEM19_VISITED_001",
        "MEM19_LANGUAGE_001",
        "MEM19_ONE_OFF_001",
    }
    assert all("issue-19" in case["tags"] for case in cases)
    assert all("pending-eval" in case["tags"] for case in cases)
