"""Unit tests for GetServiceMetadata (CONTRACT-1 #938).

Covers the pure mapper over the generated boundary models: every
ServiceMetadata field, the runtime-adapter class-name derivation, the
Literal["ok"] status enforcement, and the RootMetadata endpoints.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from animichi.config.settings import Settings
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.boundary.agent_models import ServiceMetadata
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.services.service_metadata import GetServiceMetadata

GIT_COMMIT = "a1b2c3d"
GIT_BRANCH = "main"
STARTED_AT = "2026-01-01T00:00:00+00:00"


def _runtime_api() -> RuntimeAPI:
    return RuntimeAPI(
        SimpleNamespace(),
        session_store=InMemorySessionStore(),
        model_http_client=MagicMock(),
    )


def _settings() -> Settings:
    return Settings(app_env="test-env", cors_allowed_origin="http://localhost:3000")


def _service_metadata() -> ServiceMetadata:
    return GetServiceMetadata().service_metadata(
        settings=_settings(),
        runtime_api=_runtime_api(),
        git_commit=GIT_COMMIT,
        git_branch=GIT_BRANCH,
        started_at=STARTED_AT,
        observability_enabled=True,
    )


def test_service_metadata_maps_every_field() -> None:
    metadata = _service_metadata()

    assert metadata.status == "ok"
    assert metadata.service == "animichi-runtime"
    assert metadata.git_commit == GIT_COMMIT
    assert metadata.git_branch == GIT_BRANCH
    assert metadata.started_at == STARTED_AT
    assert metadata.app_env == "test-env"
    assert metadata.observability_enabled is True


def test_service_metadata_derives_adapter_class_names_from_runtime_api() -> None:
    metadata = _service_metadata()

    assert metadata.db_adapter == "SimpleNamespace"
    assert metadata.session_store == "InMemorySessionStore"


def test_service_metadata_rejects_non_ok_status() -> None:
    with pytest.raises(ValidationError):
        ServiceMetadata(
            status="degraded",
            service="animichi-runtime",
            git_commit=GIT_COMMIT,
            git_branch=GIT_BRANCH,
            started_at=STARTED_AT,
            app_env="test-env",
            observability_enabled=True,
            db_adapter="SimpleNamespace",
            session_store="InMemorySessionStore",
        )


def test_root_metadata_maps_service_banner() -> None:
    metadata = GetServiceMetadata().root_metadata(_settings())

    assert metadata.service == "animichi-runtime"
    assert metadata.status == "ok"
    assert metadata.app_env == "test-env"
    assert metadata.endpoints.healthz == "/healthz"
    assert metadata.endpoints.runtime == "/v1/runtime"
    assert metadata.endpoints.feedback == "/v1/feedback"
