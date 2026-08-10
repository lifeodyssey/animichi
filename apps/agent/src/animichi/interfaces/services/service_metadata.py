"""Construction of the generated boundary models for root and health endpoints.

CONTRACT-1 (#938): the payloads served by ``GET /`` and ``GET /healthz`` are
built from ``animichi.interfaces.boundary.agent_models`` instead of
hand-written dicts. This service is a pure mapper: callers resolve git info,
started-at, and observability state, then pass the resolved values in.
"""

from __future__ import annotations

from animichi.config.settings import Settings
from animichi.interfaces.boundary.agent_models import (
    RootMetadata,
    RootMetadataEndpoints,
    ServiceMetadata,
)
from animichi.interfaces.public_api import RuntimeAPI

_SERVICE_NAME = "animichi-runtime"


class GetServiceMetadata:
    """Map already-resolved runtime values onto the generated boundary models."""

    def service_metadata(
        self,
        settings: Settings,
        runtime_api: RuntimeAPI,
        git_commit: str,
        git_branch: str,
        started_at: str,
        observability_enabled: bool,
    ) -> ServiceMetadata:
        return ServiceMetadata(
            status="ok",
            service=_SERVICE_NAME,
            git_commit=git_commit,
            git_branch=git_branch,
            started_at=started_at,
            app_env=settings.app_env,
            observability_enabled=observability_enabled,
            db_adapter=type(getattr(runtime_api, "_db", None)).__name__,
            session_store=type(getattr(runtime_api, "_session_store", None)).__name__,
        )

    def root_metadata(self, settings: Settings) -> RootMetadata:
        return RootMetadata(
            service=_SERVICE_NAME,
            status="ok",
            app_env=settings.app_env,
            endpoints=RootMetadataEndpoints(
                healthz="/healthz",
                runtime="/v1/runtime",
                feedback="/v1/feedback",
            ),
        )
