"""The purge sweep must have a scheduled trigger (issue #273 Task 3, P1-5).

Follows the agent-eval-nightly.yml precedent: a standalone workflow with a
`schedule:` cron trigger that invokes the purge CLI as a module.
"""

from __future__ import annotations

from pathlib import Path

WORKFLOW = (
    Path(__file__).resolve().parents[5]
    / ".github"
    / "workflows"
    / "purge-anonymous-sessions.yml"
)


def test_workflow_file_exists() -> None:
    assert WORKFLOW.is_file()


def test_workflow_has_a_cron_schedule_trigger() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "schedule:" in text
    assert "cron:" in text


def test_workflow_invokes_the_purge_cli_module() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "agent.scripts.purge_anonymous_sessions" in text


def test_workflow_supplies_the_supabase_db_url_secret() -> None:
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "SUPABASE_DB_URL" in text
    assert "secrets.SUPABASE_DB_URL" in text
