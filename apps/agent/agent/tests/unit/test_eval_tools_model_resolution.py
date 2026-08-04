"""Model-resolution coverage for the eval CLI tools (#744 review follow-up).

``agent/tools/eval_feedback_miner.py::mine()`` and
``agent/tools/eval_scorer.py::run()`` each resolve their model via
``model_id or _default_model()`` before doing any real work — line 82 and
line 92 respectively. That line only executes when the *whole* surrounding
function runs, and both talk to a live Postgres pool (``mine()`` also talks
to a live PydanticAI ``Agent``), so reaching it means doubling out those
collaborators, the same way ``test_eval_feedback_miner_output_wiring.py``
already doubles out ``mine()`` itself for ``run()``'s output-path tests.

Two pre-existing bugs, independent of #732/#744, had to be worked around to
make these functions callable at all — neither is introduced or fixed by
this file, both are reported upstream instead of silently patched:

1. ``agent.infrastructure.supabase.client.SupabaseClient.pool`` is a
   getter-only property (``client.pool = pool`` raises ``AttributeError``),
   and the class exposes no ``fetch_bad_feedback`` /
   ``fetch_request_log_unscored`` method at all — only
   ``client.feedback.fetch_bad_feedback(...)`` via the repository-facade
   properties. Both tools call the flat, nonexistent form directly.
2. ``pydantic_ai`` 2.21.0 renamed ``OpenAIModel`` to ``OpenAIChatModel``;
   ``agent.tools.eval_feedback_miner`` still imports the retired name, so
   ``mine()`` raises ``ImportError`` on its very first real invocation.

Both tools are therefore currently non-functional as CLI scripts. These
tests double out ``SupabaseClient`` and the ``pydantic_ai.models.openai``
import target entirely so the model-resolution line under test — the one
piece of logic this PR actually changed — can execute for real, without
depending on those unrelated bugs being fixed first.
"""

from __future__ import annotations

import pytest

from agent.tools import eval_feedback_miner, eval_scorer


class _FakePool:
    async def close(self) -> None:
        return None


async def _fake_create_pool(*args: object, **kwargs: object) -> _FakePool:
    return _FakePool()


class _FakeMinerClient:
    def __init__(self) -> None:
        self.pool: object | None = None

    async def fetch_bad_feedback(self, *, limit: int) -> list[dict[str, str]]:
        return [{"intent": "search_bangumi", "query_text": "uji station"}]


class _CapturingModel:
    def __init__(self, name: str, *, provider: object) -> None:
        self.name = name
        self.provider = provider


class _CapturingAgent:
    """Stand-in for pydantic_ai.Agent that records the model it was built with."""

    captured_model: object = None

    def __init__(self, model: object, **_: object) -> None:
        type(self).captured_model = model

    async def run(self, _prompt: str) -> object:
        class _Result:
            output = eval_feedback_miner._MinerOutput(suggestions=[])

        return _Result()


@pytest.fixture(autouse=True)
def _mock_miner_collaborators(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://test/db")
    monkeypatch.setattr("asyncpg.create_pool", _fake_create_pool)
    monkeypatch.setattr(
        "agent.infrastructure.supabase.client.SupabaseClient", _FakeMinerClient
    )
    monkeypatch.setattr(
        "pydantic_ai.models.openai.OpenAIModel", _CapturingModel, raising=False
    )
    monkeypatch.setattr("pydantic_ai.Agent", _CapturingAgent)


async def test_mine_falls_back_to_default_model_when_none_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EVAL_MODEL", raising=False)

    await eval_feedback_miner.mine()

    assert _CapturingAgent.captured_model.name == "qwen3.5-9b"


async def test_mine_reads_eval_model_env_var_when_no_explicit_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EVAL_MODEL", "openai:custom-model@https://example.com/v1")

    await eval_feedback_miner.mine()

    assert _CapturingAgent.captured_model.name == "custom-model"


async def test_mine_prefers_an_explicit_model_id_over_the_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EVAL_MODEL", "openai:should-be-ignored@https://example.com/v1")

    await eval_feedback_miner.mine(
        model_id="openai:gpt-4o-mini@https://api.openai.com/v1"
    )

    assert _CapturingAgent.captured_model.name == "gpt-4o-mini"


class _FakeScorerClient:
    def __init__(self) -> None:
        self.pool: object | None = None

    async def fetch_request_log_unscored(self, *, limit: int) -> list[dict[str, str]]:
        # Empty on purpose: run()'s model-resolution line (the one this test
        # covers) runs before any row-scoring loop, so an empty result set
        # isolates it from score_row()'s own (separately mocked) model use.
        return []


async def test_run_resolves_the_default_model_before_scoring_any_rows(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://test/db")
    monkeypatch.delenv("EVAL_MODEL", raising=False)
    monkeypatch.setattr("asyncpg.create_pool", _fake_create_pool)
    monkeypatch.setattr(
        "agent.infrastructure.supabase.client.SupabaseClient", _FakeScorerClient
    )

    await eval_scorer.run()

    out = capsys.readouterr().out
    assert "model=openai:qwen3.5-9b@http://localhost:1234/v1" in out


async def test_run_reads_eval_model_env_var_when_no_explicit_id(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://test/db")
    monkeypatch.setenv("EVAL_MODEL", "openai:custom-model@https://example.com/v1")
    monkeypatch.setattr("asyncpg.create_pool", _fake_create_pool)
    monkeypatch.setattr(
        "agent.infrastructure.supabase.client.SupabaseClient", _FakeScorerClient
    )

    await eval_scorer.run()

    out = capsys.readouterr().out
    assert "model=openai:custom-model@https://example.com/v1" in out
