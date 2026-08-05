"""Deterministic composition of the L0 smoke set (S1.13).

The L0 tier is defined by the card as "one case per behavior path plus the P0
trilingual set", not as "the first N rows". Even-index sampling (``cap_cases``)
gave neither guarantee: it could miss paths entirely and skew the ja/zh/en mix.

This module composes the set explicitly and deterministically:

1. one case per behavior path, with the locale rotated across ja/zh/en so the
   core set is language-balanced by construction; then
2. the remaining budget spent widening the earliest paths to full trilingual
   coverage — the P0 subset.

The selection is a pure function of the dataset order, so two runs on the same
dataset always evaluate the same cases.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TypeVar

LOCALE_ROTATION = ("ja", "zh", "en")
CaseT = TypeVar("CaseT")


@dataclass(frozen=True)
class L0Case:
    """The two dataset fields the L0 composition depends on."""

    case_id: str
    path: str
    locale: str


def select_l0_case_ids(cases: Sequence[L0Case], cap: int) -> list[str]:
    """Return the L0 case ids: one per path (locale-rotated), then P0 fill."""
    if cap <= 0 or cap >= len(cases):
        return [case.case_id for case in cases]
    core = _one_per_path(cases)
    return _fill_to_cap(core, cases, cap)


def select_l0_cases(
    cases: Sequence[CaseT], to_l0: Callable[[CaseT], L0Case], cap: int
) -> list[CaseT]:
    """Apply the L0 composition to any sequence carrying the L0 fields."""
    selected = set(select_l0_case_ids([to_l0(case) for case in cases], cap))
    return [case for case in cases if to_l0(case).case_id in selected]


def locales_covered(cases: Sequence[L0Case], selected: Sequence[str]) -> set[str]:
    """The locales present in a selection — the i18n assertion's subject."""
    chosen = set(selected)
    return {case.locale for case in cases if case.case_id in chosen}


def _one_per_path(cases: Sequence[L0Case]) -> list[str]:
    grouped = _by_path(cases)
    return [
        _preferred(grouped[path], LOCALE_ROTATION[index % len(LOCALE_ROTATION)])
        for index, path in enumerate(grouped)
    ]


def _by_path(cases: Sequence[L0Case]) -> dict[str, list[L0Case]]:
    grouped: dict[str, list[L0Case]] = {}
    for case in cases:
        grouped.setdefault(case.path, []).append(case)
    return grouped


def _preferred(candidates: Sequence[L0Case], locale: str) -> str:
    matching = next((case for case in candidates if case.locale == locale), None)
    return (matching or candidates[0]).case_id


def _fill_to_cap(core: list[str], cases: Sequence[L0Case], cap: int) -> list[str]:
    selected = list(core[:cap])
    chosen = set(selected)
    for case_id in _trilingual_fill_order(cases, chosen):
        if len(selected) >= cap:
            break
        selected.append(case_id)
    return selected


def _trilingual_fill_order(cases: Sequence[L0Case], chosen: set[str]) -> list[str]:
    """Ids that widen the earliest paths to full ja/zh/en coverage, in order."""
    grouped = _by_path(cases)
    return [
        case_id
        for path in grouped
        for case_id in _missing_locale_ids(grouped[path], chosen)
    ]


def _missing_locale_ids(candidates: Sequence[L0Case], chosen: set[str]) -> list[str]:
    covered = {case.locale for case in candidates if case.case_id in chosen}
    missing = [locale for locale in LOCALE_ROTATION if locale not in covered]
    return [
        _first_id(candidates, locale) for locale in missing if _has(candidates, locale)
    ]


def _has(candidates: Sequence[L0Case], locale: str) -> bool:
    return any(case.locale == locale for case in candidates)


def _first_id(candidates: Sequence[L0Case], locale: str) -> str:
    return next(case.case_id for case in candidates if case.locale == locale)
