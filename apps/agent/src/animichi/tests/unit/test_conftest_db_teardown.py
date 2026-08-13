"""Teardown and fail-closed contracts for the Neon and offline DB fixtures."""

from __future__ import annotations

from datetime import datetime
from typing import cast

import pytest

from animichi.tests import conftest_db
from animichi.tests.conftest_db import _neon_target
from animichi.tests.db_config import DatabaseArm, DatabaseConfig
from animichi.tests.neon_api import Branch


class StopFailingContainer:
    def start(self) -> StopFailingContainer:
        return self

    def get_wrapped_container(self) -> StopFailingContainer:
        return self

    def stop(self, timeout: int | None = None) -> None:
        if timeout is None:
            raise RuntimeError("container stop failed")


class TeardownApi:
    project_id = "project-test"

    def __init__(self) -> None:
        self.deleted: tuple[str, str] | None = None

    def resolve_test_base(self) -> Branch:
        return Branch("br-parent", "test-base", self.project_id, "br-main", False)

    def list_branches(self) -> tuple[Branch, ...]:
        return ()

    def wait_for_ephemeral(
        self,
        before: tuple[Branch, ...],
        parent: Branch,
        claim_name: str,
        created_after: datetime,
    ) -> Branch:
        del before, parent, created_after
        return Branch("br-child", claim_name, self.project_id, "br-parent", False)

    def connection_uri(self, branch_id: str) -> str:
        assert branch_id == "br-child"
        return "postgresql://u:p@ep-safe.neon.tech/test"

    def wait_until_deleted(self, branch_id: str) -> None:
        assert branch_id == "br-child"
        raise RuntimeError("still present")

    def delete_claimed_branch(self, branch_id: str, claim_name: str) -> None:
        self.deleted = (branch_id, claim_name)


def test_container_stop_failure_cannot_skip_claimed_branch_delete() -> None:
    config = DatabaseConfig(
        DatabaseArm.NEON, neon_api_key="secret", neon_project_id="project-test"
    )
    api = TeardownApi()
    with pytest.raises(RuntimeError, match="container stop failed"):
        with _neon_target(
            config,
            cast(conftest_db.NeonApi, api),
            lambda _config, _parent: StopFailingContainer(),
        ):
            pass
    assert api.deleted is not None
    assert api.deleted[0] == "br-child"
    assert api.deleted[1].startswith("wt-test-")


# AC6: the offline arm fails closed with the SAME actionable Docker guidance as
# the db-fresh-schema gate — install Docker Desktop or start colima — never a
# silent skip. Missing image names the one-time build command.
def test_require_offline_image_docker_unavailable_is_actionable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(conftest_db, "_docker_available", lambda: False)
    with pytest.raises(
        RuntimeError, match=r"Docker Desktop.*colima.*brew install colima"
    ):
        conftest_db._require_offline_image()


def test_require_offline_image_missing_image_names_build_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(conftest_db, "_docker_available", lambda: True)
    monkeypatch.setattr(conftest_db, "_offline_image_present", lambda: False)
    with pytest.raises(RuntimeError, match="docker build"):
        conftest_db._require_offline_image()
