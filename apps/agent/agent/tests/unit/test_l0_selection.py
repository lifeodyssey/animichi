"""Composition of the L0 smoke set: one per path + the P0 trilingual subset.

Card AC: the L0 suite covers every behavior path and its P0 subset executes
across ja/zh/en. Even-index sampling guaranteed neither, so these tests pin the
explicit composition — including against the real shipped dataset.
"""

from __future__ import annotations

import json
from pathlib import Path

from agent.tests.eval.l0_selection import (
    L0Case,
    locales_covered,
    select_l0_case_ids,
)

_DATASET = Path(__file__).parents[1] / "eval" / "datasets" / "agent_eval_v3.json"
_L0_CAP = 80


def _dataset_cases() -> list[L0Case]:
    rows = json.loads(_DATASET.read_text())
    return [L0Case(row["id"], row["path"], row["locale"]) for row in rows]


def _synthetic(
    paths: int, locales: tuple[str, ...] = ("ja", "zh", "en")
) -> list[L0Case]:
    return [
        L0Case(f"p{path}_{locale}", f"path-{path}", locale)
        for path in range(paths)
        for locale in locales
    ]


def test_every_behavior_path_is_represented() -> None:
    cases = _synthetic(paths=10)

    selected = set(select_l0_case_ids(cases, cap=12))

    covered = {case.path for case in cases if case.case_id in selected}
    assert len(covered) == 10


def test_core_selection_rotates_locales_across_paths() -> None:
    cases = _synthetic(paths=3)

    selected = select_l0_case_ids(cases, cap=3)

    assert selected == ["p0_ja", "p1_zh", "p2_en"]


def test_remaining_budget_widens_early_paths_to_trilingual() -> None:
    cases = _synthetic(paths=3)

    selected = select_l0_case_ids(cases, cap=5)

    assert {"p0_zh", "p0_en"}.issubset(set(selected))


def test_selection_never_exceeds_the_cap() -> None:
    assert len(select_l0_case_ids(_synthetic(paths=10), cap=12)) == 12


def test_selection_is_deterministic() -> None:
    cases = _synthetic(paths=10)

    assert select_l0_case_ids(cases, cap=12) == select_l0_case_ids(cases, cap=12)


def test_cap_at_or_above_dataset_size_returns_everything() -> None:
    cases = _synthetic(paths=2)

    assert len(select_l0_case_ids(cases, cap=99)) == len(cases)


def test_path_missing_a_locale_falls_back_instead_of_dropping_the_path() -> None:
    cases = [L0Case("only_en", "path-0", "en"), L0Case("b_ja", "path-1", "ja")]

    assert select_l0_case_ids(cases, cap=1) == ["only_en"]


def test_shipped_dataset_l0_set_covers_every_path() -> None:
    cases = _dataset_cases()

    selected = set(select_l0_case_ids(cases, _L0_CAP))

    covered = {case.path for case in cases if case.case_id in selected}
    assert covered == {case.path for case in cases}


def test_shipped_dataset_l0_set_executes_across_ja_zh_en() -> None:
    cases = _dataset_cases()

    selected = select_l0_case_ids(cases, _L0_CAP)

    assert locales_covered(cases, selected) == {"ja", "zh", "en"}


def test_shipped_dataset_l0_set_is_the_configured_size() -> None:
    assert len(select_l0_case_ids(_dataset_cases(), _L0_CAP)) == _L0_CAP
