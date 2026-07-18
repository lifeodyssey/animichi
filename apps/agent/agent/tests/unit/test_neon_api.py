"""Recorded-fixture tests for Neon branch resolution and mutation identity."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import cast

import pytest

from agent.tests.conftest_db import _neon_target
from agent.tests.db_config import DatabaseArm, DatabaseConfig, dsn_host
from agent.tests.neon_api import (
    Branch,
    NeonApi,
    assert_mutable_branch,
    parse_branches,
    resolve_ephemeral_branch,
    resolve_test_base,
)

FIXTURES = Path(__file__).parents[1] / "fixtures" / "neon_api"


def _fixture(name: str) -> object:
    return cast(object, json.loads((FIXTURES / name).read_text(encoding="utf-8")))


def _parent() -> Branch:
    return resolve_test_base(
        _fixture("branches_before.json"),
        _fixture("test_base_detail.json"),
        "project-test",
    )


def test_recorded_parent_and_ephemeral_branch_resolution() -> None:
    before = parse_branches(_fixture("branches_before.json"))
    after = parse_branches(_fixture("branches_after.json"))
    assert resolve_ephemeral_branch(before, after, _parent()).id == "br-ephemeral"


def test_recorded_parent_name_on_id_mismatch_is_rejected() -> None:
    with pytest.raises(RuntimeError, match="name-on-id verification failed"):
        resolve_test_base(
            _fixture("branches_before.json"),
            _fixture("ephemeral_detail.json"),
            "project-test",
        )


def test_recorded_branch_delta_rejects_concurrent_candidates() -> None:
    before = parse_branches(_fixture("branches_before.json"))
    after = parse_branches(_fixture("branches_after.json"))
    concurrent = Branch(
        "br-concurrent", "br-other", "project-test", _parent().id, False
    )
    with pytest.raises(RuntimeError, match="multiple new branches"):
        resolve_ephemeral_branch(before, (*after, concurrent), _parent())


class RecordedRequester:
    def __init__(self, responses: Mapping[str, object]) -> None:
        self.responses = responses
        self.calls: list[str] = []

    def __call__(self, path: str) -> object | None:
        self.calls.append(path)
        return self.responses.get(path)


def test_connection_uri_uses_explicit_role_database_and_direct_endpoint() -> None:
    path = (
        "projects/project-test/connection_uri?branch_id=br-ephemeral"
        "&database_name=neondb&role_name=neondb_owner&pooled=false"
    )
    requester = RecordedRequester({path: _fixture("connection_uri.json")})
    uri = NeonApi("secret", "project-test", requester).connection_uri("br-ephemeral")
    assert "database_name=neondb" in requester.calls[0]
    assert "role_name=neondb_owner" in requester.calls[0]
    assert "pooled=false" in requester.calls[0]
    assert dsn_host(uri) == "ep-recorded.ap-southeast-1.aws.neon.tech"


def test_byo_identity_accepts_recorded_disposable_branch() -> None:
    responses = {
        "projects/project-test/endpoints/ep-recorded": _fixture("endpoint_detail.json"),
        "projects/project-test/branches/br-ephemeral": _fixture(
            "ephemeral_detail.json"
        ),
    }
    api = NeonApi("secret", "project-test", RecordedRequester(responses))
    dsn = "postgresql://owner:secret@ep-recorded.ap-southeast-1.aws.neon.tech/neondb"
    assert api.assert_mutable_dsn(dsn).name == "scratch/phase-a"


@pytest.mark.parametrize("name", ["main", "staging", "test-base", "preview/42"])
def test_byo_identity_rejects_protected_branch_names(name: str) -> None:
    branch = Branch("br-protected", name, "project-test", None, False)
    with pytest.raises(RuntimeError, match="refusing mutation"):
        assert_mutable_branch(branch)


def test_byo_identity_rejects_default_branch_with_unprotected_name() -> None:
    branch = Branch("br-default", "production", "project-test", None, True)
    with pytest.raises(RuntimeError, match="refusing mutation"):
        assert_mutable_branch(branch)


class FailingApi:
    project_id = "project-test"

    def resolve_test_base(self) -> Branch:
        return Branch("br-test-base", "test-base", self.project_id, "br-main", False)

    def list_branches(self) -> tuple[Branch, ...]:
        return ()

    def wait_for_ephemeral(self, before: tuple[Branch, ...], parent: Branch) -> Branch:
        raise RuntimeError("recorded API branch delta was ambiguous")


class FakeContainer:
    def __init__(self) -> None:
        self.stopped = False

    def start(self) -> FakeContainer:
        return self

    def stop(self) -> None:
        self.stopped = True


def test_branch_resolution_failure_still_stops_container() -> None:
    config = DatabaseConfig(
        DatabaseArm.NEON, neon_api_key="secret", neon_project_id="project-test"
    )
    container = FakeContainer()
    api = cast(NeonApi, FailingApi())
    with pytest.raises(RuntimeError, match="branch delta was ambiguous"):
        with _neon_target(config, api, lambda _config, _parent: container):
            pytest.fail("failing API must not yield a database target")
    assert container.stopped is True
