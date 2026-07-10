"""Health and root endpoint routes."""

from __future__ import annotations

import subprocess
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from agent.interfaces.routes._deps import (
    _get_runtime_api,
    _get_settings_from_request,
    _has_logfire_token,
    _json_response,
)

router = APIRouter(tags=["health"])

# Capture git info at module load time (once, at startup)
_STARTED_AT = datetime.now(UTC).isoformat()


def _git_short(args: list[str]) -> str:
    """Run a git command and return stdout stripped, or 'unknown' on failure."""
    try:
        result = subprocess.run(args, capture_output=True, text=True, check=False)
        return result.stdout.strip() or "unknown"
    except OSError:
        return "unknown"


_GIT_COMMIT = _git_short(["git", "rev-parse", "--short", "HEAD"])
_GIT_BRANCH = _git_short(["git", "branch", "--show-current"])


@router.get("/")
async def handle_root(request: Request) -> JSONResponse:
    settings = _get_settings_from_request(request)
    payload = {
        "service": "animichi-runtime",
        "status": "ok",
        "app_env": settings.app_env,
        "endpoints": {
            "healthz": "/healthz",
            "runtime": "/v1/runtime",
            "feedback": "/v1/feedback",
        },
    }
    return _json_response(payload)


@router.get("/healthz")
async def handle_health(request: Request) -> JSONResponse:
    runtime_api = _get_runtime_api(request)
    settings = _get_settings_from_request(request)
    payload = {
        "status": "ok",
        "service": "animichi-runtime",
        "git_commit": _GIT_COMMIT,
        "git_branch": _GIT_BRANCH,
        "started_at": _STARTED_AT,
        "app_env": settings.app_env,
        "observability_enabled": _has_logfire_token(),
        "db_adapter": type(getattr(runtime_api, "_db", None)).__name__,
        "session_store": type(getattr(runtime_api, "_session_store", None)).__name__,
    }
    return _json_response(payload)
