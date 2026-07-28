"""Shared dependencies, helpers, and request models for route modules."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Literal, cast

import structlog
from fastapi import Depends, Header, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from agent.clients.catalog_client import CatalogClientProtocol
from agent.config.settings import Settings
from agent.infrastructure.session import SessionStore, create_session_store
from agent.infrastructure.supabase.client import SupabaseClient
from agent.interfaces.public_api import PublicAPIResponse, RuntimeAPI
from agent.interfaces.schemas import GRACEFUL_TERMINAL_STATUSES
from agent.interfaces.usage_metering import ANONYMOUS_USER_TYPE

if TYPE_CHECKING:
    import logfire

_logger = structlog.get_logger(__name__)

_SCRUB_PATTERNS = (
    r"authorization",
    r"bearer(?=\s+[A-Za-z0-9._~+/=-]+)",
    r"(?=^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$)",
    r"api[._ -]?key",
    r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}",
)
_OPERATING_QUERY_FIELDS = frozenset({"query_text", "first_query"})
_MESSAGE_CONTENT_FIELDS = frozenset(
    {
        "pydantic_ai.all_messages",
        "gen_ai.input.messages",
        "gen_ai.output.messages",
        "gen_ai.system_instructions",
    }
)


@dataclass(frozen=True)
class TrustedAuthContext:
    user_id: str | None
    user_type: str | None


class ConversationPatchRequest(BaseModel):
    title: str

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("title must be a non-empty string.")
        return title


class FeedbackRequest(BaseModel):
    session_id: str | None = None
    query_text: str
    intent: str | None = None
    rating: Literal["good", "bad"]
    comment: str | None = None

    @field_validator("session_id", "intent", "comment")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        return text or None

    @field_validator("query_text")
    @classmethod
    def validate_query_text(cls, value: str) -> str:
        query_text = value.strip()
        if not query_text:
            raise ValueError("query_text is required.")
        return query_text


def _normalize_optional_header(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _reject_credentialed_anonymous(
    user_type: str | None, credential: str | None
) -> None:
    """Refuse an anonymous stamp that arrived with a credential (issue #441).

    The edge strips ``Authorization`` before stamping an identity, so the pair
    can only co-occur when a presented credential failed to verify and the
    request was demoted anyway, or when the container was reached directly.
    Serving it anonymously would meter and rate-limit the turn under the wrong
    identity and hide the expiry from a client built to refresh on 401.
    """
    if user_type == ANONYMOUS_USER_TYPE and credential is not None:
        raise HTTPException(status_code=401, detail="Valid credentials required.")


def _get_trusted_auth_context(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
    x_user_type: Annotated[str | None, Header(alias="X-User-Type")] = None,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> TrustedAuthContext:
    user_type = _normalize_optional_header(x_user_type)
    _reject_credentialed_anonymous(user_type, _normalize_optional_header(authorization))
    return TrustedAuthContext(
        user_id=_normalize_optional_header(x_user_id),
        user_type=user_type,
    )


def _require_trusted_user(
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
) -> TrustedAuthContext:
    if auth.user_id is None:
        raise HTTPException(status_code=400, detail="X-User-Id header required.")
    return auth


def _get_runtime_api(request: Request) -> RuntimeAPI:
    return cast(RuntimeAPI, request.app.state.runtime_api)


def _get_settings_from_request(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def _get_db_from_request(request: Request) -> object:
    return cast(object, getattr(request.app.state, "db_client", None))


def _get_catalog_client(request: Request) -> CatalogClientProtocol | None:
    catalog = getattr(request.app.state, "catalog_client", None)
    return cast("CatalogClientProtocol | None", catalog)


def _require_supabase(db: object) -> SupabaseClient:
    if not isinstance(db, SupabaseClient):
        raise HTTPException(status_code=500, detail="Database client not available.")
    return db


def _public_api_response(response: PublicAPIResponse) -> JSONResponse:
    return _json_response(
        response.model_dump(mode="json"),
        status_code=_http_status_for_response(response),
    )


def _json_response(payload: object, status_code: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=jsonable_encoder(payload))


def _error_response(
    code: str,
    message: str,
    *,
    status_code: int,
    details: object | None = None,
) -> JSONResponse:
    error_payload: dict[str, object] = {
        "code": code,
        "message": message,
    }
    if details is not None:
        error_payload["details"] = details
    return _json_response({"error": error_payload}, status_code=status_code)


def _contains_json_invalid_error(errors_obj: object) -> bool:
    if not isinstance(errors_obj, list):
        return False
    for item in errors_obj:
        if isinstance(item, dict) and item.get("type") == "json_invalid":
            return True
    return False


def _http_error_code(status_code: int) -> str:
    if status_code == 400:
        return "invalid_request"
    if status_code == 401:
        return "authentication_error"
    if status_code == 403:
        return "forbidden"
    if status_code == 404:
        return "not_found"
    if status_code == 409:
        return "already_exists"
    if status_code == 429:
        return "rate_limited"
    if status_code >= 500:
        return "internal_error"
    return "http_error"


def _http_status_for_response(response: PublicAPIResponse) -> int:
    if response.success:
        return 200
    if response.status in GRACEFUL_TERMINAL_STATUSES:
        return 200

    codes = {error.code for error in response.errors}

    if codes & {
        "invalid_input",
        "invalid_model_alias",
        "invalid_selection",
        "missing_required_field",
        "invalid_format",
    }:
        return 400
    if codes & {"authentication_error", "invalid_credentials"}:
        return 401
    if codes & {"not_found"}:
        return 404
    if codes & {"already_exists"}:
        return 409
    if codes & {"rate_limited"}:
        return 429
    if codes & {"timeout"}:
        return 504

    return 500


# -- lifespan infrastructure helpers -----------------------------------


def build_supabase_client(settings: Settings) -> SupabaseClient:
    dsn = settings.supabase_db_url.strip()
    if not dsn:
        raise RuntimeError("SUPABASE_DB_URL is required to run the HTTP service.")
    return SupabaseClient(dsn)


def build_session_store(db: SupabaseClient | None = None) -> SessionStore:
    return create_session_store(db=db)


async def call_optional_async(target: object, method_name: str) -> None:
    method = getattr(target, method_name, None)
    if method is None:
        return
    result = method()
    if inspect.isawaitable(result):
        await cast(Awaitable[object], result)


def setup_logfire(settings: Settings, app: object | None = None) -> None:
    """Configure logfire; instrument frameworks only when a token is present.

    Without ``LOGFIRE_TOKEN`` this still calls ``logfire.configure`` so that
    spans/metrics from the observability wrapper become quiet no-ops instead
    of emitting ``LogfireNotConfiguredWarning``.
    """
    import logfire

    variables = _managed_prompt_variables()
    _enable_message_content_scrubbing()
    scrubbing = logfire.ScrubbingOptions(
        callback=_preserve_operating_query,
        extra_patterns=_SCRUB_PATTERNS,
    )
    logfire.configure(
        service_name=settings.observability_service_name,
        service_version=settings.observability_service_version,
        environment=settings.app_env,
        send_to_logfire="if-token-present",
        console=False,
        scrubbing=scrubbing,
        variables=variables,
    )
    if _has_logfire_token():
        _instrument_logfire(app)
        _logger.info("logfire_configured", service=settings.observability_service_name)


def _has_logfire_token() -> bool:
    import os

    return bool(os.environ.get("LOGFIRE_TOKEN"))


def _preserve_operating_query(match: logfire.ScrubMatch) -> object | None:
    """Keep query operating data intact while other matches are redacted."""
    # These fields drive product behavior and eval analysis, so their exact
    # text is intentionally preserved; message-content telemetry is not.
    if any(part in _OPERATING_QUERY_FIELDS for part in match.path):
        return cast(object, match.value)
    return None


def _enable_message_content_scrubbing() -> None:
    """Opt PydanticAI/GenAI message attributes into Logfire recursion."""
    from logfire._internal.scrubbing import BaseScrubber

    # Coupled to logfire._internal SAFE_KEYS until its public API supports
    # recursive scrubbing of PydanticAI and GenAI message attributes.
    BaseScrubber.SAFE_KEYS.difference_update(_MESSAGE_CONTENT_FIELDS)


def _managed_prompt_variables() -> logfire.VariablesOptions | None:
    import os

    import logfire

    credentials = _has_logfire_token() and bool(os.environ.get("LOGFIRE_API_KEY"))
    if os.environ.get("ANIMICHI_MANAGED_PROMPT") != "1" or not credentials:
        return None
    return logfire.VariablesOptions(timeout=(1.0, 1.0))


def _instrument_logfire(app: object | None) -> None:
    import logfire

    logfire.instrument_pydantic_ai()
    if app is not None:
        from fastapi import FastAPI as _FastAPI

        logfire.instrument_fastapi(cast(_FastAPI, app))
    logfire.instrument_httpx()
    logfire.instrument_asyncpg()
