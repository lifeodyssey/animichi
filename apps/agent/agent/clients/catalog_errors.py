"""Typed catalog error mirror: oRPC error envelope -> Python exceptions.

Mirror of ``packages/contract/src/errors.ts`` (see the contract README's
"Error contract" section). MUST stay in lockstep with the contract registry
and the Worker mirror ``workers/catalog/src/lib/errors.ts``; this side is
pinned by ``agent/tests/unit/test_catalog_errors.py``.

The catalog serializes a defined error as HTTP status = error status with a
JSON body ``{"defined", "code", "status", "message", "data"}``. ``category``
is intentionally NOT on the wire: it is derived here from ``code`` via this
module's own registry, so a buggy or compromised server cannot flip the
client into unexpected retry behavior.

Trust boundary (SD-19): the wire ``message`` is untrusted upstream content.
It is logged (truncated) for observability and then dropped — never stored on
the exception, never shown to users, never fed to LLM prompts. Exception text
is built locally from the code + validated ``data``.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import ClassVar, Literal, TypeVar

import structlog
from pydantic import BaseModel, ValidationError, field_validator

from agent.clients.errors import APIError, TransientAPIError

logger = structlog.get_logger(__name__)

ErrorCategory = Literal["user_actionable", "retryable", "system"]
UpstreamSource = Literal["bangumi", "anitabi", "unknown"]

_TRANSIENT_4XX_STATUS_CODES = frozenset({408, 429})
_WIRE_MESSAGE_LOG_LIMIT = 200
_UPSTREAM_SOURCES = frozenset({"bangumi", "anitabi", "unknown"})


class RouteTooManyClustersData(BaseModel):
    """Wire ``data`` for ROUTE_TOO_MANY_CLUSTERS (defaults: wire is untrusted)."""

    cluster_count: int = 0
    max_clusters: int = 0


class RouteTooManyPointsData(BaseModel):
    """Wire ``data`` for ROUTE_TOO_MANY_POINTS (defaults: wire is untrusted)."""

    point_count: int = 0
    max_points: int = 0


class WorkNotFoundData(BaseModel):
    """Wire ``data`` for WORK_NOT_FOUND (defaults: wire is untrusted)."""

    bangumi_id: str = ""


class UpstreamUnavailableData(BaseModel):
    """Wire ``data`` for UPSTREAM_UNAVAILABLE; unknown sources coerce safely."""

    upstream: UpstreamSource = "unknown"

    @field_validator("upstream", mode="before")
    @classmethod
    def _coerce_unknown(cls, value: object) -> object:
        """Coerce any non-member wire value to ``unknown`` (untrusted input)."""
        return value if value in _UPSTREAM_SOURCES else "unknown"


class CatalogError(APIError):
    """Base for defined catalog errors; ``str()`` is locally built (SD-19)."""

    code: ClassVar[str] = ""
    category: ClassVar[ErrorCategory] = "system"

    def __init__(self, message: str) -> None:
        super().__init__(message, error_code=self.code)

    def steering_hint(self) -> str:
        """LLM-facing steering detail for ModelRetry (SD-19).

        Built ONLY from the code + whitelisted numeric/enum fields, NEVER from a
        wire string or ``str(self)``. Overridden per user-actionable subclass.
        """
        return "the request was rejected by the catalog"


class RouteTooManyClustersError(CatalogError):
    """The selection spans more geographic areas than a route allows."""

    code: ClassVar[str] = "ROUTE_TOO_MANY_CLUSTERS"
    category: ClassVar[ErrorCategory] = "user_actionable"

    def __init__(self, data: RouteTooManyClustersData) -> None:
        self.cluster_count = data.cluster_count
        self.max_clusters = data.max_clusters
        super().__init__(
            f"Route rejected: {data.cluster_count} areas exceeds "
            f"the maximum of {data.max_clusters}"
        )

    def steering_hint(self) -> str:
        return f"{self.cluster_count} areas exceeds the maximum of {self.max_clusters}"


class RouteTooManyPointsError(CatalogError):
    """The route request carries more point ids than a route allows."""

    code: ClassVar[str] = "ROUTE_TOO_MANY_POINTS"
    category: ClassVar[ErrorCategory] = "user_actionable"

    def __init__(self, data: RouteTooManyPointsData) -> None:
        self.point_count = data.point_count
        self.max_points = data.max_points
        super().__init__(
            f"Route rejected: {data.point_count} point ids exceeds "
            f"the maximum of {data.max_points}"
        )

    def steering_hint(self) -> str:
        return f"{self.point_count} point ids exceeds the maximum of {self.max_points}"


class WorkNotFoundError(CatalogError):
    """The requested work has no pilgrimage points in the catalog."""

    code: ClassVar[str] = "WORK_NOT_FOUND"
    category: ClassVar[ErrorCategory] = "user_actionable"

    def __init__(self, data: WorkNotFoundData) -> None:
        self.bangumi_id = data.bangumi_id
        super().__init__(f"No pilgrimage points found for work '{data.bangumi_id}'")

    def steering_hint(self) -> str:
        return "the requested work has no pilgrimage points in the catalog"


class UpstreamUnavailableError(CatalogError, TransientAPIError):
    """An upstream catalog source (Bangumi/Anitabi) is temporarily down.

    Deliberately also a :class:`TransientAPIError`: the retryable category
    must flow through the client's existing retry-with-backoff loop.
    """

    code: ClassVar[str] = "UPSTREAM_UNAVAILABLE"
    category: ClassVar[ErrorCategory] = "retryable"

    def __init__(self, data: UpstreamUnavailableData) -> None:
        self.upstream = data.upstream
        super().__init__(f"Catalog upstream ({data.upstream}) temporarily unavailable")


class _ErrorEnvelope(BaseModel):
    """The oRPC error body ``{defined, code, status, message, data}`` (untrusted)."""

    defined: bool = False
    code: str = ""
    message: str = ""
    data: object = None


ModelT = TypeVar("ModelT", bound=BaseModel)


def _validate_or_default(model: type[ModelT], data: object) -> ModelT:
    """Validate wire ``data``; malformed content falls back to safe defaults."""
    try:
        return model.model_validate(data)
    except ValidationError:
        return model()


def _too_many_clusters(data: object) -> CatalogError:
    """Build the typed exception for ROUTE_TOO_MANY_CLUSTERS."""
    return RouteTooManyClustersError(
        _validate_or_default(RouteTooManyClustersData, data)
    )


def _too_many_points(data: object) -> CatalogError:
    """Build the typed exception for ROUTE_TOO_MANY_POINTS."""
    return RouteTooManyPointsError(_validate_or_default(RouteTooManyPointsData, data))


def _work_not_found(data: object) -> CatalogError:
    """Build the typed exception for WORK_NOT_FOUND."""
    return WorkNotFoundError(_validate_or_default(WorkNotFoundData, data))


def _upstream_unavailable(data: object) -> CatalogError:
    """Build the typed exception for UPSTREAM_UNAVAILABLE."""
    return UpstreamUnavailableError(_validate_or_default(UpstreamUnavailableData, data))


_BUILDERS: dict[str, Callable[[object], CatalogError]] = {
    "ROUTE_TOO_MANY_CLUSTERS": _too_many_clusters,
    "ROUTE_TOO_MANY_POINTS": _too_many_points,
    "WORK_NOT_FOUND": _work_not_found,
    "UPSTREAM_UNAVAILABLE": _upstream_unavailable,
}


def parse_catalog_error(status_code: int, body: object, url: str) -> APIError:
    """Map an error response to a typed exception, else the status heuristic.

    Known envelope codes yield :class:`CatalogError` subclasses; anything else
    (non-JSON body, foreign shape, unknown code) falls back to the legacy
    status-based classification so undefined failures keep today's behavior.
    """
    envelope = _parse_envelope(body)
    builder = _BUILDERS.get(envelope.code) if envelope is not None else None
    if envelope is None or envelope.defined is not True or builder is None:
        return _status_fallback(status_code, url)
    _log_wire_message(envelope, url)
    return builder(envelope.data)


def _parse_envelope(body: object) -> _ErrorEnvelope | None:
    """Narrow an untrusted error body to the oRPC envelope shape."""
    if not isinstance(body, dict):
        return None
    try:
        return _ErrorEnvelope.model_validate(body)
    except ValidationError:
        return None


def _log_wire_message(envelope: _ErrorEnvelope, url: str) -> None:
    """Log the untrusted wire message (truncated); it is dropped afterwards."""
    logger.warning(
        "catalog_defined_error",
        code=envelope.code,
        url=url,
        upstream_message=envelope.message[:_WIRE_MESSAGE_LOG_LIMIT],
    )


def _status_fallback(status_code: int, url: str) -> APIError:
    """The legacy heuristic: 5xx/408/429 transient, other 4xx immediate.

    Mirrors ``public_api._is_provider_error``, which treats 429/502/503 as
    transient.
    """
    if status_code >= 500 or status_code in _TRANSIENT_4XX_STATUS_CODES:
        return TransientAPIError(f"HTTP {status_code} from {url}")
    return APIError(f"HTTP {status_code} from {url}")
