"""EVAL_SMOKE=1 capped-gate enforcement — the L0 smoke tier's red-line gate.

Card #228: a capped eval run is normally report-only (no gate at all). Setting
EVAL_SMOKE=1 makes it assert zero-errored cases and run the deterministic
direct thrash gate, while it still never reads or writes the statistical
baseline file (that stays L1-only, see test_eval_gate_equivalence.py).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agent.tests.eval.direct_gates import TrajectoryCase
from agent.tests.eval.eval_gate_flow import GateInput, SmokeRequiresCappedRun, _run_gate
from agent.tests.eval.gate import baseline_path
from agent.tests.eval.smoke_errors import SmokeError

_MODEL = "fixture"
_LAYER = "agent"
_AGENT_ERROR = SmokeError("e0", "ValidationError", "bad output", "agent")
_TRANSPORT_ERROR = SmokeError("t0", "ReadTimeout", "timed out", "transport")


def _gate_input(
    *,
    errors: tuple[SmokeError, ...] = (),
    trajectory: TrajectoryCase,
    case_count: int = 1,
) -> GateInput:
    return GateInput(
        model=_MODEL,
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=case_count,
        evaluated_count=case_count - len(errors),
        scores={},
        cases={},
        errors=errors,
        trajectories=(trajectory,),
    )


def _baseline_untouched(tmp_path: Path) -> bool:
    return not baseline_path(_LAYER, _MODEL, tmp_path).exists()


def test_smoke_gate_passes_on_clean_capped_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EVAL_SMOKE", "1")
    clean = _gate_input(trajectory=TrajectoryCase("ok", requests=5))

    failures = _run_gate(clean, _LAYER, tmp_path, capped=True)

    assert failures == []
    assert _baseline_untouched(tmp_path)


def test_smoke_gate_fails_on_errored_case(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EVAL_SMOKE", "1")
    errored = _gate_input(
        errors=(_AGENT_ERROR,), trajectory=TrajectoryCase("e0", requests=5)
    )

    failures = _run_gate(errored, _LAYER, tmp_path, capped=True)

    assert failures is not None
    assert any("1/1 cases errored inside the agent" in f for f in failures)
    assert any("e0 [agent] ValidationError: bad output" in f for f in failures)
    assert _baseline_untouched(tmp_path)


def test_smoke_gate_stays_green_on_a_provider_transport_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """#434: a model-API hiccup must not read as 'your code is broken'."""
    monkeypatch.setenv("EVAL_SMOKE", "1")
    blipped = _gate_input(
        errors=(_TRANSPORT_ERROR,),
        trajectory=TrajectoryCase("t0", requests=5),
        case_count=80,
    )

    failures = _run_gate(blipped, _LAYER, tmp_path, capped=True)

    assert failures == []
    assert _baseline_untouched(tmp_path)


def test_smoke_gate_fails_on_direct_gate_violation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EVAL_SMOKE", "1")
    thrashing = _gate_input(trajectory=TrajectoryCase("thrash", requests=13))

    failures = _run_gate(thrashing, _LAYER, tmp_path, capped=True)

    assert failures is not None and any("requests=13" in f for f in failures)
    assert _baseline_untouched(tmp_path)


def test_capped_report_stays_report_only_without_eval_smoke(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("EVAL_SMOKE", raising=False)
    broken = _gate_input(
        errors=(_AGENT_ERROR,), trajectory=TrajectoryCase("thrash", requests=13)
    )

    failures = _run_gate(broken, _LAYER, tmp_path, capped=True)

    assert failures == []
    assert _baseline_untouched(tmp_path)


def test_smoke_without_a_capped_run_fails_loudly_instead_of_silently_ignoring(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EVAL_SMOKE", "1")
    clean = _gate_input(trajectory=TrajectoryCase("ok", requests=5))

    with pytest.raises(SmokeRequiresCappedRun, match="requires a capped run"):
        _run_gate(clean, _LAYER, tmp_path, capped=False)

    assert _baseline_untouched(tmp_path)
