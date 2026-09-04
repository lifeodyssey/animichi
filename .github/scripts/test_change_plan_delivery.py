"""Behavioral tests for delivery-control change planning."""

import json
from pathlib import Path

from change_plan_test_support import MANIFEST, commit_file, fixture, plan, run_plan


def assert_shared_delivery_change_triggers_every_release_unit() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(
            root, ".github/actions/build-release-unit/action.yml", "shared build"
        )
        ci = plan(root, initial, head)
        deploy = plan(root, initial, head, "main", "deploy")
        expected = {
            "agent",
            "catalog",
            "db",
            "edge",
            "infra",
            "migrator",
            "users",
            "web",
        }
        assert ci["components"] == []
        assert set(deploy["direct_components"]) == expected
        assert set(deploy["components"]) == expected


def assert_web_delivery_adapter_targets_web() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(
            root, ".github/scripts/inject-release-web-runtime-config.mjs", "web"
        )
        deploy = plan(root, initial, head, "main", "deploy")
        assert deploy["fallback_all"] is False
        assert deploy["direct_components"] == ["web"]
        assert deploy["components"] == ["web"]


def assert_database_delivery_adapter_targets_database() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, ".github/actions/install-atlas/action.yml", "atlas")
        deploy = plan(root, initial, head, "main", "deploy")
        assert deploy["fallback_all"] is False
        assert deploy["direct_components"] == ["db"]
        assert deploy["components"] == ["db"]


def malformed_manifest(root: Path) -> Path:
    document = json.loads(MANIFEST.read_text())
    document["deploy_triggers"][0]["paths"] = ".github/**"
    path = root / "components.json"
    path.write_text(json.dumps(document))
    return path


def assert_malformed_delivery_trigger_fails_closed() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, ".github/workflows/cd.yml", "delivery")
        result = run_plan(
            root, initial, head, "main", "deploy", malformed_manifest(root)
        )
        assert result.returncode == 1
        assert "deploy trigger paths" in result.stderr


def assert_delivery_routing() -> None:
    assert_shared_delivery_change_triggers_every_release_unit()
    assert_web_delivery_adapter_targets_web()
    assert_database_delivery_adapter_targets_database()
    assert_malformed_delivery_trigger_fails_closed()


if __name__ == "__main__":
    assert_delivery_routing()
    print("change plan: shared and unit-specific delivery controls validated")
