#!/usr/bin/env python3
"""Behavioral tests for affected-component change planning."""

from pathlib import Path

from change_plan_test_support import commit_file, fixture, git, plan
from test_change_plan_delivery import assert_delivery_routing

CONTRACT_LANES = frozenset(
    {
        "cross-stack",
        "security-codeql-javascript",
        "security-codeql-python",
        "security-semgrep",
    }
)
FALLBACK_LANES = CONTRACT_LANES | {"security-sqlfluff"}
WEB_SECURITY_LANES = frozenset(
    {"cross-stack", "security-codeql-javascript", "security-semgrep"}
)


def assert_reverse_closure() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "packages/contract/change.ts", "change")
        result = plan(root, initial, head)
        expected = {
            "agent",
            "catalog",
            "contract",
            "e2e",
            "edge",
            "migrator",
            "users",
            "web",
        }
        assert set(result["components"]) == expected
        assert result["direct_components"] == ["contract"]
        assert set(result["lanes"]) == CONTRACT_LANES


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
        assert len(result["components"]) == 12
        assert set(result["lanes"]) == FALLBACK_LANES


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


def assert_non_runtime_component_tests_are_ci_only() -> None:
    temporary, root, initial = fixture()
    with temporary:
        tests = commit_file(root, "packages/contract/test/new.test.ts", "test")
        assert plan(root, initial, tests, "main", "deploy")["components"] == []


def assert_non_runtime_component_docs_are_ci_only() -> None:
    temporary, root, initial = fixture()
    with temporary:
        docs = commit_file(root, "migrations/AGENTS.md", "guidance")
        ci = plan(root, initial, docs)
        deploy = plan(root, initial, docs, "main", "deploy")
        assert ci["direct_components"] == ["db"]
        assert ci["components"] == ["db"]
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
        assert ci["lanes"] == [
            "security-codeql-actions",
            "security-zizmor",
            "static-quality",
        ]
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
        assert not any(
            lane.startswith("security-")
            for lane in plan(root, initial, docs_head)["lanes"]
        )
        web_head = commit_file(root, "apps/web/change.ts", "web")
        assert set(plan(root, docs_head, web_head)["lanes"]) == WEB_SECURITY_LANES


def assert_test_trigger_pr_routing() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "docs/ops/secrets.md", "secrets")
        pr = plan(root, initial, head)
        assert pr["direct_components"] == ["docs"]
        assert pr["source_components"] == ["docs"]
        assert pr["test_trigger_components"] == []
        assert pr["lanes"] == []


def assert_test_trigger_main_routing() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "docs/ops/secrets.md", "secrets")
        queue = plan(root, initial, head, "main")
        deploy = plan(root, initial, head, "main", "deploy")
        assert queue["direct_components"] == ["docs"]
        assert deploy["direct_components"] == ["docs"]


def assert_cross_component_test_trigger() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, "workers/edge/src/protect/turnstile.ts", "turnstile")
        assert plan(root, initial, head)["direct_components"] == ["edge", "web"]
        assert plan(root, initial, head, "main")["direct_components"] == ["edge", "web"]
        assert plan(root, initial, head, "main", "deploy")["direct_components"] == [
            "edge"
        ]


def assert_regular_docs_stay_docs_only() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(
            root, Path("docs", "notes", "example.md").as_posix(), "ordinary docs"
        )
        result = plan(root, initial, head)
        assert result["direct_components"] == ["docs"]
        assert result["components"] == ["docs"]


def assert_component_selection() -> None:
    assert_reverse_closure()
    assert_pr_uses_merge_base()
    assert_main_and_fallback()
    assert_root_readmes_are_repository_quality_inputs()
    assert_non_runtime_component_tests_are_ci_only()
    assert_non_runtime_component_docs_are_ci_only()
    assert_runtime_source_still_selects_deploy_unit()
    assert_repository_change_has_no_product_component()


def assert_lane_selection() -> None:
    assert_eval_is_path_scoped()
    assert_security_tools_follow_affected_change()
    assert_test_trigger_pr_routing()
    assert_test_trigger_main_routing()
    assert_cross_component_test_trigger()
    assert_regular_docs_stay_docs_only()


def main() -> None:
    assert_component_selection()
    assert_delivery_routing()
    assert_lane_selection()
    print(
        "change plan: affected CI, runtime-only CD, reverse closure, and fallback validated"
    )


if __name__ == "__main__":
    main()
