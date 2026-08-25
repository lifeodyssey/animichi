#!/usr/bin/env python3
"""Behavioral tests for affected-component change planning."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLANNER = ROOT / ".github/scripts/change-plan.py"
MANIFEST = ROOT / ".github/ci/components.json"


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def commit_file(root: Path, path: str, content: str) -> str:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    git(root, "add", ".")
    git(root, "commit", "-qm", path)
    return git(root, "rev-parse", "HEAD")


def plan(root: Path, base: str, head: str, mode: str = "pr", purpose: str = "ci") -> dict[str, object]:
    result = subprocess.run(
        [sys.executable, str(PLANNER), "--root", str(root), "--manifest", str(MANIFEST),
         "--base", base, "--head", head, "--range", mode, "--purpose", purpose, "--format", "json"],
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)


def fixture() -> tuple[tempfile.TemporaryDirectory[str], Path, str]:
    temporary = tempfile.TemporaryDirectory()
    root = Path(temporary.name)
    git(root, "init", "-q")
    git(root, "config", "user.name", "test")
    git(root, "config", "user.email", "test@example.com")
    initial = commit_file(root, "seed.txt", "seed")
    return temporary, root, initial


def assert_reverse_closure() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "packages/contract/change.ts", "change")
        result = plan(root, initial, head)
        expected = {"agent", "catalog", "contract", "e2e", "edge", "migrator", "users", "web"}
        assert set(result["components"]) == expected
        assert result["direct_components"] == ["contract"]
        assert set(result["lanes"]) == {
            "cross-stack",
            "security-codeql-javascript",
            "security-codeql-python",
            "security-semgrep",
        }


def assert_pr_uses_merge_base() -> None:
    temporary, root, initial = fixture()
    with temporary:
        base = commit_file(root, Path("docs", "base.md").as_posix(), "base-only")
        git(root, "checkout", "-q", "-b", "feature", initial)
        head = commit_file(root, "apps/web/change.ts", "feature")
        assert plan(root, base, head)["direct_components"] == ["web"]


def assert_main_and_fallback() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "unknown-root.txt", "unknown")
        result = plan(root, initial, head, "main")
        assert result["fallback_all"] is True
        assert len(result["components"]) == 11
        assert set(result["lanes"]) == {
            "cross-stack",
            "security-codeql-javascript",
            "security-codeql-python",
            "security-semgrep",
            "security-sqlfluff",
        }


def assert_root_readmes_are_repository_quality_inputs() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "README.md", "known documentation")
        ci = plan(root, initial, head)
        deploy = plan(root, initial, head, "main", "deploy")
        assert ci["fallback_all"] is False
        assert ci["components"] == []
        assert ci["lanes"] == ["static-quality"]
        assert deploy["components"] == []


def assert_non_runtime_component_files_are_ci_only() -> None:
    temporary, root, initial = fixture()
    with temporary:
        tests = commit_file(root, "packages/contract/test/new.test.ts", "test")
        docs = commit_file(root, "migrations/AGENTS.md", "guidance")
        ci = plan(root, initial, docs)
        deploy = plan(root, initial, docs, "main", "deploy")
        assert set(ci["direct_components"]) == {"contract", "db"}
        assert set(ci["components"]) == {"contract", "db"}
        assert plan(root, initial, tests, "main", "deploy")["components"] == []
        assert deploy["fallback_all"] is False
        assert deploy["components"] == []


def assert_runtime_source_still_selects_deploy_unit() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "workers/edge/src/policy.ts", "runtime")
        deploy = plan(root, initial, head, "main", "deploy")
        assert deploy["direct_components"] == ["edge"]
        assert deploy["components"] == ["edge"]


def assert_repository_change_has_no_product_component() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, ".github/workflows/change.yml", "workflow")
        ci = plan(root, initial, head)
        deploy = plan(root, initial, head, "main", "deploy")
        assert ci["fallback_all"] is False
        assert ci["components"] == []
        assert ci["lanes"] == ["security-codeql-actions", "security-zizmor", "static-quality"]
        assert deploy["components"] == []


def assert_eval_is_path_scoped() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "apps/agent/src/animichi/agents/prompt.py", "prompt")
        result = plan(root, initial, head)
        assert "agent-eval" in result["lanes"]


def assert_security_tools_follow_affected_change() -> None:
    temporary, root, initial = fixture()
    with temporary:
        docs_head = commit_file(root, Path("docs", "note.md").as_posix(), "docs")
        assert not any(lane.startswith("security-") for lane in plan(root, initial, docs_head)["lanes"])
        web_head = commit_file(root, "apps/web/change.ts", "web")
        assert set(plan(root, docs_head, web_head)["lanes"]) == {
            "cross-stack",
            "security-codeql-javascript",
            "security-semgrep",
        }


def assert_test_triggers_are_ci_only() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "docs/ops/secrets.md", "secrets")
        pr = plan(root, initial, head)
        queue = plan(root, initial, head, "main")
        deploy = plan(root, initial, head, "main", "deploy")
        assert pr["direct_components"] == ["docs"]
        assert pr["source_components"] == ["docs"]
        assert pr["test_trigger_components"] == []
        assert pr["lanes"] == []
        assert queue["direct_components"] == ["docs"]
        assert deploy["direct_components"] == ["docs"]


def assert_cross_component_test_trigger() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "workers/edge/src/protect/turnstile.ts", "turnstile")
        assert plan(root, initial, head)["direct_components"] == ["edge", "web"]
        assert plan(root, initial, head, "main")["direct_components"] == ["edge", "web"]
        assert plan(root, initial, head, "main", "deploy")["direct_components"] == ["edge"]


def assert_regular_docs_stay_docs_only() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, Path("docs", "notes", "example.md").as_posix(), "ordinary docs")
        result = plan(root, initial, head)
        assert result["direct_components"] == ["docs"]
        assert result["components"] == ["docs"]


def main() -> None:
    assert_reverse_closure()
    assert_pr_uses_merge_base()
    assert_main_and_fallback()
    assert_root_readmes_are_repository_quality_inputs()
    assert_non_runtime_component_files_are_ci_only()
    assert_runtime_source_still_selects_deploy_unit()
    assert_repository_change_has_no_product_component()
    assert_eval_is_path_scoped()
    assert_security_tools_follow_affected_change()
    assert_test_triggers_are_ci_only()
    assert_cross_component_test_trigger()
    assert_regular_docs_stay_docs_only()
    print("change plan: affected CI, runtime-only CD, reverse closure, and fallback validated")


if __name__ == "__main__":
    main()
