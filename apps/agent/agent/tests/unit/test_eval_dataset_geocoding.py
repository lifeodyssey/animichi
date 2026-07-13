from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import cast

DATASET = Path(__file__).parents[1] / "eval" / "datasets" / "agent_eval_v3.json"
SUFFIX_CASES = {"C2_ja_005", "C2_zh_004", "C2_zh_006"}
PREFECTURE_NARROWING_CASES = SUFFIX_CASES | {"C2_ja_007"}
BARE_CASES = {"C2_ja_004", "C2_zh_005", "C2_en_004", "C2_en_005", "C2_ja_006"}
NEW_CASES = {
    "C1_ja_007",
    "C1_ja_008",
    "C1_en_006",
    "C1_zh_006",
    "C2_ja_007",
    "C5_ja_001",
    "C5_zh_001",
    "C5_en_001",
}


def _rows() -> dict[str, Mapping[str, object]]:
    raw = cast(list[object], json.loads(DATASET.read_text()))
    rows = [cast(Mapping[str, object], row) for row in raw]
    return {str(row["id"]): row for row in rows}


def test_b3_prefecture_carve_out_and_new_cases() -> None:
    rows = _rows()
    assert all(
        rows[id_]["acceptable_stages"] == ["search_nearby"] for id_ in BARE_CASES
    )
    assert all(rows[id_]["acceptable_stages"] == ["clarify"] for id_ in SUFFIX_CASES)
    assert NEW_CASES <= rows.keys()


def test_b3_c1_c2_flips_c4_trajectory_and_nonempty_tags() -> None:
    rows = _rows()
    flipped = [
        row
        for id_, row in rows.items()
        if id_.startswith(("C1_", "C2_")) and id_ not in PREFECTURE_NARROWING_CASES
    ]
    assert all(row["acceptable_stages"] == ["search_nearby"] for row in flipped)
    assert all(
        "clarify_after_nearby" in cast(list[str], row["acceptable_stages"])
        for id_, row in rows.items()
        if id_.startswith("C4_")
    )
    assert sum(row.get("expect_nonempty") is True for row in rows.values()) >= 15
