"""Pure configuration rules shared by DB fixtures and the eval runner."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import urlparse


class DatabaseArm(StrEnum):
    DOCKER = "docker"
    NEON = "neon"
    BYO = "byo"


@dataclass(frozen=True)
class DatabaseConfig:
    arm: DatabaseArm
    database_url: str | None = None
    neon_api_key: str | None = None
    neon_project_id: str | None = None
    allow_mutation: bool = False


@dataclass(frozen=True)
class PreflightPlan:
    apply_atlas: bool
    verify_revisions: bool
    apply_seed: bool
    verify_identity: bool


def _value(environment: Mapping[str, str], name: str) -> str | None:
    value = environment.get(name, "").strip()
    return value or None


def _mutation_flag(environment: Mapping[str, str]) -> bool:
    value = _value(environment, "TEST_DB_ALLOW_MUTATION")
    if value not in (None, "0", "1"):
        raise RuntimeError("TEST_DB_ALLOW_MUTATION must be 0, 1, or unset")
    return value == "1"


def _validate_neon_credentials(key: str | None, project: str | None) -> None:
    if (key is None) != (project is None):
        raise RuntimeError("NEON_API_KEY and NEON_PROJECT_ID must be set together")


def select_database_arm(environment: Mapping[str, str]) -> DatabaseConfig:
    """Apply the v4.2 selector truth table without side effects."""
    url = _value(environment, "TEST_DATABASE_URL")
    selected = _value(environment, "TEST_DB")
    key = _value(environment, "NEON_API_KEY")
    project = _value(environment, "NEON_PROJECT_ID")
    mutation = _mutation_flag(environment)
    _validate_neon_credentials(key, project)
    if url and selected:
        raise RuntimeError("TEST_DATABASE_URL conflicts with TEST_DB")
    if url:
        return _byo_config(url, key, project, mutation)
    if mutation:
        raise RuntimeError(
            "TEST_DB_ALLOW_MUTATION is valid only with TEST_DATABASE_URL"
        )
    if selected in (None, DatabaseArm.DOCKER):
        return DatabaseConfig(DatabaseArm.DOCKER)
    if selected == DatabaseArm.NEON:
        return _neon_config(key, project)
    raise RuntimeError(f"unknown TEST_DB value: {selected}")


def _byo_config(
    url: str, key: str | None, project: str | None, mutation: bool
) -> DatabaseConfig:
    if mutation and (key is None or project is None):
        raise RuntimeError("BYO mutation requires NEON_API_KEY and NEON_PROJECT_ID")
    return DatabaseConfig(DatabaseArm.BYO, url, key, project, mutation)


def _neon_config(key: str | None, project: str | None) -> DatabaseConfig:
    if key is None or project is None:
        raise RuntimeError("TEST_DB=neon requires NEON_API_KEY and NEON_PROJECT_ID")
    return DatabaseConfig(DatabaseArm.NEON, neon_api_key=key, neon_project_id=project)


def preflight_plan(config: DatabaseConfig) -> PreflightPlan:
    if config.arm is not DatabaseArm.BYO:
        return PreflightPlan(True, False, True, False)
    return PreflightPlan(False, True, config.allow_mutation, config.allow_mutation)


def dsn_host(dsn: str) -> str:
    host = urlparse(dsn).hostname
    if host is None:
        raise RuntimeError("database URL has no host")
    return host


def is_local_host(host: str) -> bool:
    return host.lower() in {"localhost", "127.0.0.1", "::1"}


def endpoint_id_from_dsn(dsn: str) -> str:
    endpoint = dsn_host(dsn).split(".", maxsplit=1)[0].removesuffix("-pooler")
    if not endpoint.startswith("ep-"):
        raise RuntimeError("TEST_DATABASE_URL is not an identifiable Neon endpoint")
    return endpoint
