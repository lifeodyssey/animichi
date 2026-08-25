"""Behavioral tests for delivery-control change planning."""

from change_plan_test_support import commit_file, fixture, plan


def assert_shared_delivery_change_triggers_every_release_unit() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, ".github/actions/build-release-unit/action.yml", "shared build")
        ci = plan(root, initial, head)
        deploy = plan(root, initial, head, "main", "deploy")
        expected = {"agent", "catalog", "db", "edge", "infra", "migrator", "users", "web"}
        assert ci["components"] == []
        assert set(deploy["direct_components"]) == expected
        assert set(deploy["components"]) == expected


def assert_web_delivery_adapter_targets_web() -> None:
    temporary, root, initial = fixture()
    with temporary:
        head = commit_file(root, ".github/scripts/inject-release-web-runtime-config.mjs", "web")
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


def assert_delivery_routing() -> None:
    assert_shared_delivery_change_triggers_every_release_unit()
    assert_web_delivery_adapter_targets_web()
    assert_database_delivery_adapter_targets_database()


if __name__ == "__main__":
    assert_delivery_routing()
    print("change plan: shared and unit-specific delivery controls validated")
