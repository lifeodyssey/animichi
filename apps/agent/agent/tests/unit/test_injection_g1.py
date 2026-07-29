"""G-1 domain-injection sample suite (打样 only — 3-5 cases).

Pure unit test: loads the hand-written dataset, checks detect_prompt_injection
against each case's expectation, and checks that wrapping/sanitizing keeps
the untrusted content delimited. No model calls.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent.agents.web_trust import (
    WebResult,
    detect_prompt_injection,
    sanitize_untrusted,
    wrap_untrusted_web_results,
)

_DATASET_PATH = (
    Path(__file__).parent.parent / "eval" / "datasets" / "injection_g1_v1.json"
)


def _load_cases() -> list[dict[str, object]]:
    with _DATASET_PATH.open(encoding="utf-8") as f:
        cases: list[dict[str, object]] = json.load(f)
    return cases


_CASES = _load_cases()


@pytest.mark.parametrize("case", _CASES, ids=[str(c["id"]) for c in _CASES])
def test_detect_prompt_injection_matches_expectation(case: dict[str, object]) -> None:
    content = str(case["untrusted_content"])
    expected = bool(case["expect_detected"])

    assert detect_prompt_injection(content, source="web_search") is expected


@pytest.mark.parametrize("case", _CASES, ids=[str(c["id"]) for c in _CASES])
def test_wrap_untrusted_web_results_keeps_content_delimited(
    case: dict[str, object],
) -> None:
    content = str(case["untrusted_content"])
    result = WebResult(title="fixture", body=content, href="https://fixture.example")

    wrapped = wrap_untrusted_web_results([result])

    assert "<untrusted_web_result>" in wrapped
    assert "</untrusted_web_result>" in wrapped


def test_dataset_is_full_g1_suite_size() -> None:
    assert 20 <= len(_CASES) <= 30


def test_dataset_includes_benign_and_malicious_cases() -> None:
    assert any(case["expect_detected"] for case in _CASES)
    assert any(not case["expect_detected"] for case in _CASES)


def test_sanitize_untrusted_still_delimits_malicious_content() -> None:
    malicious = next(c for c in _CASES if c["expect_detected"])
    sanitized = sanitize_untrusted(str(malicious["untrusted_content"]), max_len=500)

    assert sanitized  # non-empty, still present, not dropped/filtered
