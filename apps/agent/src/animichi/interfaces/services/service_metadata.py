"""Construction of the generated boundary model for the health endpoint.

CONTRACT-1 (#938): the payload served by ``GET /healthz`` is built from
``animichi.interfaces.boundary.agent_models`` instead of a hand-written dict.
This service is a pure mapper: callers resolve git info, started-at, and
observability state, then pass the resolved values in.
"""

from __future__ import annotations

from animichi.config.settings import Settings
from animichi.interfaces.boundary.agent_models import ServiceMetadata
from animichi.interfaces.public_api import RuntimeAPI

_SERVICE_NAME = "animichi-runtime"


class GetServiceMetadata:
    """Map already-resolved runtime values onto the generated boundary model."""

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
