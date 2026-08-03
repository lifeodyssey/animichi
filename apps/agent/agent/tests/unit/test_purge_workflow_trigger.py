"""The purge sweep uses a Worker cron while GHA remains a manual fallback."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import yaml

ROOT = Path(__file__).resolve().parents[5]
WORKFLOW = ROOT / ".github" / "workflows" / "purge-anonymous-sessions.yml"
WRANGLER_CONFIG = ROOT / "workers" / "maintenance" / "wrangler.toml"

#: PyYAML's default (YAML 1.1) resolver parses the unquoted `on:` workflow
#: key as the boolean `True`, not the string `"on"` — a well-known gotcha.
#: Reading via this constant documents that rather than silently relying on
#: it, so anyone reading `doc[_ON]` doesn't mistake it for a typo.
_ON = True


def _load() -> dict[str, object]:
    return cast(dict[str, object], yaml.safe_load(WORKFLOW.read_text(encoding="utf-8")))


def test_workflow_file_exists() -> None:
    assert WORKFLOW.is_file()


def test_workflow_parses_as_valid_yaml_with_the_expected_top_level_shape() -> None:
    doc = _load()
    assert isinstance(doc, dict)
    assert {"name", "jobs", _ON} <= doc.keys()


def test_workflow_schedule_is_disabled_during_worker_cutover() -> None:
    doc = _load()
    triggers = doc[_ON]
    assert isinstance(triggers, dict)
    assert "schedule" not in triggers


def test_worker_owns_the_original_cron_schedule() -> None:
    source = WRANGLER_CONFIG.read_text(encoding="utf-8")
    assert source.count('crons = ["37 18 * * *", "37 19 * * *"]') == 3


def test_workflow_also_allows_manual_dispatch() -> None:
    doc = _load()
    assert "workflow_dispatch" in doc[_ON]


def test_workflow_invokes_the_purge_cli_module() -> None:
    doc = _load()
    steps = doc["jobs"]["purge"]["steps"]
    run_commands = [step["run"] for step in steps if "run" in step]
    assert any("agent.scripts.purge_anonymous_sessions" in cmd for cmd in run_commands)


def test_workflow_supplies_the_supabase_db_url_secret() -> None:
    doc = _load()
    steps = doc["jobs"]["purge"]["steps"]
    sweep_step = next(
        step
        for step in steps
        if "run" in step and "purge_anonymous_sessions" in step["run"]
    )
    assert sweep_step["env"]["SUPABASE_DB_URL"] == "${{ secrets.SUPABASE_DB_URL }}"


def test_workflow_job_has_a_timeout() -> None:
    doc = _load()
    assert isinstance(doc["jobs"]["purge"]["timeout-minutes"], int)
