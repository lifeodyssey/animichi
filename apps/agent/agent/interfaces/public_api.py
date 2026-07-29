"""Thin public API surface over the runtime pipeline.

Orchestration logic only — response building lives in ``response_builder``,
session management in ``session_facade``, and persistence in ``persistence``.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter
from typing import cast
from uuid import uuid4

import httpx
import structlog
from fastapi import HTTPException
from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_ai.exceptions import FallbackExceptionGroup, ModelHTTPError
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models import Model
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness.memory import MemoryStore

from agent.agents.agent_result import AgentResult
from agent.agents.animichi_agent import animichi_agent
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.base import (
    ModelAliasError,
    build_model_http_client,
    get_default_model,
    resolve_model,
    resolve_model_alias,
)
from agent.agents.error_messages import build_input_error_message
from agent.agents.runtime_deps import (
    OnStep,
    StepEvent,
    StepStatus,
    TitleTranslator,
    new_step_call_id,
)
from agent.agents.selected_route import execute_selected_route
from agent.agents.selection import (
    SelectionError,
    execute_multi_selection,
    execute_place_selection,
    validate_candidate_selection,
)
from agent.agents.session_state import SessionState
from agent.agents.translation import TranslationResult, translate_text, translate_title
from agent.application.errors import ApplicationError, ErrorCode
from agent.clients.catalog_client import CatalogClient, CatalogClientProtocol
from agent.config.settings import Settings, get_settings
from agent.domain.fact_ledger import record_turn_facts
from agent.domain.ports import DatabasePort, get_session_repo
from agent.infrastructure.memory import postgres_memory_store
from agent.infrastructure.observability import (
    record_runtime_request,
    runtime_span,
)
from agent.infrastructure.session import SessionStore, create_session_store
from agent.interfaces.persistence import (
    build_response_session,
    create_owned_session,
    extract_plan_steps,
    load_session_state,
    persist_messages,
    persist_result,
)
from agent.interfaces.response_builder import (
    agent_result_to_response,
    application_error_response,
)
from agent.interfaces.schemas import (
    PublicAPIError,
    PublicAPIRequest,
    PublicAPIResponse,
    as_json_object,
)
from agent.interfaces.session_facade import (
    build_context_block,
    build_message_history,
    extract_context_delta,
    normalize_session_state,
)
from agent.interfaces.usage_metering import (
    UsagePrices,
    record_turn_usage,
    scope_for_identity,
)
from agent.utils.language import detect_language, resolve_reply_language

__all__ = [
    "PublicAPIError",
    "PublicAPIRequest",
    "PublicAPIResponse",
    "RuntimeAPI",
    "detect_language",
    "handle_public_request",
]

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class _TranslationContext:
    model: Model
    usage: RunUsage


_BYOK_CREDENTIAL_REJECTED_MESSAGE = (
    "Your BYOK provider rejected the credential. Please check your key and try again."
)


def _is_byok_credential_rejection(exc: BaseException) -> bool:
    """A provider-reported auth failure for a BYOK-supplied credential.

    Only `ModelHTTPError` carries a structured `status_code`; a 401/403 here
    means the caller's own key/base_url was rejected, never the server's.
    """
    return isinstance(exc, ModelHTTPError) and exc.status_code in (401, 403)


def _byok_credential_rejected_response() -> PublicAPIResponse:
    """Fixed, safe copy only (T7): never echoes `str(exc)`, which could carry
    provider response body content."""
    return PublicAPIResponse(
        success=False,
        status="error",
        intent="error",
        message=_BYOK_CREDENTIAL_REJECTED_MESSAGE,
        errors=[
            PublicAPIError(
                code="byok_credential_rejected",
                message=_BYOK_CREDENTIAL_REJECTED_MESSAGE,
            )
        ],
    )


def _is_provider_error(exc: BaseException) -> bool:
    """Detect transient provider errors by exception type, not string scanning."""
    if isinstance(exc, ModelHTTPError):
        return exc.status_code in (429, 502, 503)
    if isinstance(exc, FallbackExceptionGroup):
        return True
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 502, 503)
    return False


def _span_record_exception(span: object, exc: BaseException) -> None:
    """Best-effort span exception recording (OpenTelemetry compatible)."""
    record_exc = getattr(span, "record_exception", None)
    if callable(record_exc):
        record_exc(exc)


def default_catalog_client() -> CatalogClient:
    """Build the default Catalog read-path client from settings.

    Used when no client is injected so the catalog-only agent always has a
    client to route through; production injects one explicitly via the lifespan.
    """
    return CatalogClient(base_url=get_settings().catalog_api_url)


def _input_error_response(
    request: PublicAPIRequest, limit: int
) -> PublicAPIResponse | None:
    """Reject oversized text with safe localized copy."""
    if len(request.text) <= limit:
        return None
    message = build_input_error_message("message_too_long", request.locale)
    error = PublicAPIError(code=ErrorCode.INVALID_INPUT.value, message=message)
    return PublicAPIResponse(
        success=False,
        status="invalid_request",
        intent="unknown",
        message=message,
        errors=[error],
    )


class RuntimeAPI:
    """Thin interface-layer facade over the runtime agent."""

    def __init__(
        self,
        db: object,
        *,
        session_store: SessionStore | None = None,
        catalog: CatalogClientProtocol | None = None,
        settings: Settings | None = None,
        model_http_client: httpx.AsyncClient,
        memory_store: MemoryStore | None = None,
    ) -> None:
        self._db = db
        self._session_store = session_store or create_session_store()
        self._catalog: CatalogClientProtocol = catalog or default_catalog_client()
        self._settings = settings or get_settings()
        self._model_http_client = model_http_client
        self._memory_store = memory_store

    def bind_model_http_client(self, client: httpx.AsyncClient) -> None:
        """Bind the client owned by the surrounding application lifespan."""
        self._model_http_client = client

    @property
    def model_http_client(self) -> httpx.AsyncClient:
        """Return the required shared model transport."""
        return self._model_http_client

    async def validate_session_owner(
        self, session_id: str | None, user_id: str | None
    ) -> None:
        """Hide sessions that are not owned by the authenticated user."""
        if session_id is None or user_id is None:
            return
        session_repo = get_session_repo(self._db)
        if session_repo is None or not await session_repo.check_session_owner(
            session_id, user_id
        ):
            raise HTTPException(status_code=404, detail="Conversation not found.")

    async def handle(
        self,
        request: PublicAPIRequest,
        *,
        model: Model | str | None = None,
        is_byok: bool = False,
        user_id: str | None = None,
        user_type: str | None = None,
        on_step: OnStep | None = None,
    ) -> PublicAPIResponse:
        """Execute the runtime pipeline and normalize its output."""
        rejection = _input_error_response(request, self._settings.message_max_chars)
        if rejection is not None:
            return rejection
        session_id, is_new_session = await self._prepare_session(request, user_id)
        started_at = perf_counter()
        response: PublicAPIResponse | None = None
        effective_model = model if model is not None else request.model
        with runtime_span("runtime.handle") as span:
            _set_span_request_attrs(span, session_id, request, effective_model, user_id)

            result: AgentResult | None = None
            user_message_persisted = False
            try:
                previous_state, context, message_history = await self._load_session(
                    None if is_new_session else session_id, request
                )
                result, response, context_delta = await self._execute_pipeline(
                    request,
                    context,
                    message_history,
                    effective_model,
                    on_step,
                    span,
                    user_id,
                    is_byok,
                )

                if session_id is None:
                    session_id = uuid4().hex
                    span.set_attribute("runtime.session_id", session_id)

                response.session_id = session_id

                (
                    session_state,
                    user_message_persisted,
                    generated_title,
                ) = await persist_result(
                    db=self._db,
                    session_store=self._session_store,
                    session_id=session_id,
                    request=request,
                    result=result,
                    response=response,
                    context_delta=context_delta,
                    previous_state=previous_state,
                    user_id=user_id,
                )

                session_summary, route_history = build_response_session(session_state)
                response.session = as_json_object(session_summary)
                response.route_history = [
                    as_json_object(r) for r in route_history if isinstance(r, dict)
                ]
                response.generated_title = generated_title
                return response
            except Exception as exc:
                span.record_exception(exc)
                raise
            finally:
                elapsed_ms = (perf_counter() - started_at) * 1000
                intent = response.intent if response is not None else "unknown"
                status = response.status if response is not None else "error"
                success = response.success if response is not None else False
                error_count = len(response.errors) if response is not None else 1

                span.set_attribute("runtime.intent", intent)
                span.set_attribute("runtime.status", status)
                span.set_attribute("runtime.success", success)
                span.set_attribute("runtime.error_count", error_count)

                record_runtime_request(
                    duration_ms=elapsed_ms,
                    intent=intent,
                    status=status,
                    transport="public_api",
                )

                await self._record_usage(result, user_id, user_type, is_byok)
                await self._log_request(
                    session_id=session_id,
                    request=request,
                    result=result,
                    response=response,
                    elapsed_ms=elapsed_ms,
                    intent=intent,
                    status=status,
                    user_message_persisted=user_message_persisted,
                )

    def _usage_prices(self) -> UsagePrices:
        return UsagePrices(
            input_usd_per_mtok=self._settings.model_input_cost_per_mtok_usd,
            output_usd_per_mtok=self._settings.model_output_cost_per_mtok_usd,
        )

    async def _record_usage(
        self,
        result: AgentResult | None,
        user_id: str | None,
        user_type: str | None,
        is_byok: bool = False,
    ) -> None:
        """SD-18 metering hook: bank this turn's RunUsage into ``daily_usage``.

        This is the sole data source the anonymous daily-budget breaker (X4)
        reads, so it runs in ``handle``'s finally block — a failed turn still
        consumed tokens and must still be charged. A BYOK turn's token counts
        are still recorded for observability, but its cost is always zero —
        we did not pay the provider for it.
        """
        if result is None:
            return
        scope = scope_for_identity(user_id, user_type, is_byok=is_byok)
        prices = self._usage_prices() if scope != "byok" else UsagePrices(0.0, 0.0)
        await record_turn_usage(
            self._db, usage=result.usage, scope=scope, prices=prices
        )

    async def _prepare_session(
        self, request: PublicAPIRequest, user_id: str | None
    ) -> tuple[str | None, bool]:
        session_id = request.session_id or None
        await self.validate_session_owner(session_id, user_id)
        if session_id is not None or user_id is None:
            return session_id, False
        session_id = uuid4().hex
        state = normalize_session_state(None)
        await create_owned_session(self._db, session_id, user_id, request.text, state)
        return session_id, True

    async def _load_session(
        self,
        session_id: str | None,
        request: PublicAPIRequest,
    ) -> tuple[dict[str, object], dict[str, object] | None, list[ModelMessage]]:
        """Load session state, context block, and message history."""
        previous_state = (
            await load_session_state(self._session_store, session_id)
            if session_id
            else normalize_session_state(None)
        )
        context = build_context_block(previous_state)
        if request.origin_lat is not None and request.origin_lng is not None:
            if context is None:
                context = {}
            context["origin_lat"] = request.origin_lat
            context["origin_lng"] = request.origin_lng
        message_history = _deserialize_history(previous_state)
        return previous_state, context, message_history

    async def _execute_pipeline(
        self,
        request: PublicAPIRequest,
        context: dict[str, object] | None,
        message_history: list[ModelMessage],
        effective_model: Model | str | None,
        on_step: OnStep | None,
        span: object,
        user_id: str | None,
        is_byok: bool = False,
    ) -> tuple[AgentResult | None, PublicAPIResponse, dict[str, object]]:
        """Run the pipeline (or synthetic plan) and map result to response."""
        context_delta: dict[str, object] = {}
        try:
            result, resolved_model, model_path = await self._dispatch_request(
                request,
                context,
                message_history,
                effective_model,
                on_step,
                user_id,
                is_byok,
            )
        except TimeoutError:
            _span_record_exception(span, TimeoutError("agent timed out"))
            logger.warning("agent_timeout", text=request.text[:50])
            return (
                None,
                PublicAPIResponse(
                    success=False,
                    status="timeout",
                    intent="error",
                    message="The request took too long. Please try again.",
                    errors=[
                        PublicAPIError(
                            code=ErrorCode.TIMEOUT.value,
                            message=(
                                "Agent execution timed out after "
                                f"{self._settings.agent_deadline:.0f} seconds."
                            ),
                        )
                    ],
                ),
                context_delta,
            )
        except ModelAliasError as exc:
            _span_record_exception(span, exc)
            return (
                None,
                PublicAPIResponse(
                    success=False,
                    status="error",
                    intent="unknown",
                    message=str(exc),
                    errors=[
                        PublicAPIError(
                            code="invalid_model_alias",
                            message=str(exc),
                        )
                    ],
                ),
                context_delta,
            )
        except SelectionError as exc:
            _span_record_exception(span, exc)
            return None, _invalid_selection_response(str(exc)), context_delta
        except ApplicationError as exc:
            _span_record_exception(span, exc)
            return None, application_error_response(exc), context_delta
        except Exception as exc:
            _span_record_exception(span, exc)
            if is_byok and _is_byok_credential_rejection(exc):
                logger.warning("byok_credential_rejected")
                return None, _byok_credential_rejected_response(), context_delta
            error_msg = str(exc)
            if _is_provider_error(exc):
                logger.warning("provider_error", error=error_msg[:200])
                return (
                    None,
                    PublicAPIResponse(
                        success=False,
                        status="provider_error",
                        intent="error",
                        message="The AI service is temporarily unavailable. Please try again in a moment.",
                        errors=[
                            PublicAPIError(
                                code="provider_error",
                                message=error_msg[:500],
                            )
                        ],
                    ),
                    context_delta,
                )
            logger.error("pipeline_unhandled_exception", exc_info=exc)
            return (
                None,
                PublicAPIResponse(
                    success=False,
                    status="error",
                    intent="unknown",
                    message="The runtime failed before producing a pipeline result.",
                    errors=[
                        PublicAPIError(
                            code=ErrorCode.INTERNAL_ERROR.value,
                            message="An internal error occurred. Please try again.",
                        )
                    ],
                ),
                context_delta,
            )
        if model_path:
            await _apply_translation_gate(
                result,
                resolve_reply_language(request.text, request.locale),
                on_step,
                # D18: the post-turn translation pass reuses the run's own
                # model when it can (cheaper, same connection) — but on a
                # BYOK turn that model is the caller's own credential, and
                # this helper call must never be billed to it. `model=None`
                # forces `_translation_context`'s fallback to the server
                # default (`resolve_model(animichi_agent.model)`), which is
                # never influenced by a per-request override.
                model=None if is_byok else resolved_model,
            )
        response = agent_result_to_response(
            result,
            include_debug=request.include_debug,
        )
        # Command (mutates session_state.fact_ledger) kept separate from the
        # pure `extract_context_delta` query below (CQS) — the deterministic
        # post-turn recorder (OQ-4), run exactly once per turn.
        record_turn_facts(
            result.session_state.fact_ledger, result.steps, now=datetime.now(UTC)
        )
        context_delta = extract_context_delta(result)
        return result, response, context_delta

    async def _dispatch_request(
        self,
        request: PublicAPIRequest,
        context: dict[str, object] | None,
        history: list[ModelMessage],
        effective_model: Model | str | None,
        on_step: OnStep | None,
        user_id: str | None = None,
        is_byok: bool = False,
    ) -> tuple[AgentResult, Model | None, bool]:
        """Dispatch exactly one of point, candidate, or model request modes."""
        model = _resolve_request_model(
            effective_model,
            self._model_http_client,
        )
        if request.selected_point_ids is not None:
            result = await self._point_selection(request, context, on_step)
            return result, None, False
        if request.selected_candidate_ids is not None:
            result = await self._candidate_selection(request, context, on_step)
            return result, None, False
        result = await self._model_request(
            request, context, history, model, on_step, user_id, is_byok
        )
        return result, model, True

    async def _point_selection(
        self,
        request: PublicAPIRequest,
        context: dict[str, object] | None,
        on_step: OnStep | None,
    ) -> AgentResult:
        return await execute_selected_route(
            point_ids=list(request.selected_point_ids or []),
            state=_selection_state(context),
            origin=request.origin,
            locale=request.locale,
            catalog=self._catalog,
            on_step=on_step,
        )

    async def _candidate_selection(
        self,
        request: PublicAPIRequest,
        context: dict[str, object] | None,
        on_step: OnStep | None,
    ) -> AgentResult:
        state = _selection_state(context)
        selected = validate_candidate_selection(
            state,
            list(request.selected_candidate_ids or []),
            cast(int, request.clarification_id),
        )
        if selected.reason == "anime_ambiguity":
            return await execute_multi_selection(
                candidate_ids=selected.candidate_ids,
                state=state,
                locale=request.locale,
                catalog=self._catalog,
                on_step=on_step,
            )
        return await execute_place_selection(
            candidate_id=selected.candidate_ids[0],
            state=state,
            locale=request.locale,
            catalog=self._catalog,
            on_step=on_step,
        )

    async def _model_request(
        self,
        request: PublicAPIRequest,
        context: dict[str, object] | None,
        history: list[ModelMessage],
        model: Model | None,
        on_step: OnStep | None,
        user_id: str | None,
        is_byok: bool = False,
    ) -> AgentResult:
        return await asyncio.wait_for(
            run_animichi_agent(
                text=request.text,
                db=cast(DatabasePort, self._db),
                model=model,
                locale=request.locale,
                context=context,
                message_history=history,
                on_step=on_step,
                catalog=self._catalog,
                title_translator=self._server_title_translator() if is_byok else None,
                memory_store=self._memory_store,
                user_id=user_id,
            ),
            timeout=self._settings.agent_deadline,
        )

    def _server_title_translator(self) -> TitleTranslator:
        """D18: force `translate_anime_title` onto the server key on a BYOK
        turn. Without this override the tool inherits the active run's own
        model via `RunContext.model` (cheap connection reuse on every other
        turn) — which on a BYOK turn *is* the caller's credential. Passing an
        explicit callable here bypasses that inheritance: `ctx=None` makes
        `translate_title` fall back to `translation_agent`'s own baked-in
        server default, never the per-request override.
        """

        async def _translate(title: str, target_language: str) -> TranslationResult:
            return await translate_title(
                title,
                target_locale=target_language,
                kind="anime_title",
                catalog=self._catalog,
                ctx=None,
            )

        return _translate

    async def _log_request(
        self,
        *,
        session_id: str | None,
        request: PublicAPIRequest,
        result: AgentResult | None,
        response: PublicAPIResponse | None,
        elapsed_ms: float,
        intent: str,
        status: str,
        user_message_persisted: bool,
    ) -> None:
        """Persist user message on error (best-effort) and log request."""
        if not user_message_persisted and session_id and request.text:
            try:
                await persist_messages(
                    db=self._db,
                    session_id=session_id,
                    user_text=request.text,
                    result=None,
                    response=response
                    or PublicAPIResponse(
                        success=False, status="error", intent="unknown"
                    ),
                    persist_user_only=True,
                )
            except (OSError, RuntimeError, ValueError, TypeError):
                logger.warning(
                    "finally_persist_user_msg_failed",
                    session_id=session_id,
                )

        insert_request_log = getattr(self._db, "insert_request_log", None)
        if insert_request_log is None:
            return

        try:
            await insert_request_log(
                session_id=session_id,
                query_text=request.text,
                locale=request.locale,
                plan_steps=extract_plan_steps(result),
                intent=intent,
                status=status,
                latency_ms=int(elapsed_ms),
            )
        except (OSError, RuntimeError, ValueError, TypeError):
            logger.warning("request_log_failed", session_id=session_id)


async def handle_public_request(
    request: PublicAPIRequest,
    db: object,
    *,
    model: Model | str | None = None,
    session_store: SessionStore | None = None,
    user_id: str | None = None,
    on_step: OnStep | None = None,
) -> PublicAPIResponse:
    """Convenience helper for one-off public API execution."""
    model_client = build_model_http_client()
    api = RuntimeAPI(
        db,
        session_store=session_store,
        model_http_client=model_client,
        memory_store=postgres_memory_store(db),
    )
    try:
        return await api.handle(request, model=model, user_id=user_id, on_step=on_step)
    finally:
        await model_client.aclose()


def _deserialize_history(
    previous_state: dict[str, object],
) -> list[ModelMessage]:
    """Rebuild validated ModelMessage list from serialized session data."""
    raw_history = build_message_history(previous_state)
    if not raw_history:
        return []
    return list(ModelMessagesTypeAdapter.validate_python(raw_history))


def _selection_state(context: dict[str, object] | None) -> SessionState:
    """Restore the typed selection oracle from the unified session context."""
    raw = context.get("session_state_v2") if context is not None else None
    return SessionState.model_validate(raw) if isinstance(raw, dict) else SessionState()


def _resolve_request_model(
    model: Model | str | None,
    http_client: httpx.AsyncClient,
) -> Model | None:
    """Resolve defaults only with an SDK-compatible shared transport."""
    if model is None and isinstance(http_client, httpx.AsyncClient):
        return get_default_model(http_client=http_client)
    return resolve_model_alias(model, http_client=http_client)


def _invalid_selection_response(message: str) -> PublicAPIResponse:
    """Return a typed stale/invalid selection response without mutating state."""
    return PublicAPIResponse(
        success=False,
        status="invalid_request",
        intent="clarify",
        message=message,
        errors=[PublicAPIError(code="invalid_selection", message=message)],
        ui={"component": "Clarification"},
    )


async def _apply_translation_gate(
    result: AgentResult,
    locale: str,
    on_step: OnStep | None,
    *,
    model: Model | None,
) -> None:
    """Translate the agent message when its language mismatches *locale*.

    Mutates the output model's ``message`` field in place.
    """
    message = result.message
    if not message:
        return
    detected = resolve_reply_language(message, locale)
    if detected == locale:
        return
    call_id = new_step_call_id("translate")
    if on_step is not None:
        await on_step(StepEvent("translate", call_id, "running", {}))
    status: StepStatus = "done"
    try:
        translated = await translate_text(
            message,
            target_locale=locale,
            ctx=_translation_context(result, model),
        )
        # Mutate the output model's message field
        object.__setattr__(result.output, "message", translated)
    except (OSError, RuntimeError, ValueError, TypeError):
        logger.warning("translation_gate_failed", locale=locale)
        status = "error"
    if on_step is not None:
        await on_step(StepEvent("translate", call_id, status, {}))


def _translation_context(
    result: AgentResult, model: Model | None
) -> _TranslationContext:
    selected = model or resolve_model(animichi_agent.model)
    usage = result.usage or RunUsage()
    return _TranslationContext(model=selected, usage=usage)


def _set_span_request_attrs(
    span: object,
    session_id: str | None,
    request: PublicAPIRequest,
    effective_model: object,
    user_id: str | None,
) -> None:
    set_attr = getattr(span, "set_attribute", None)
    if not callable(set_attr):
        return
    if session_id:
        set_attr("runtime.session_id", session_id)
    set_attr("runtime.include_debug", request.include_debug)
    model_label = _runtime_model_label(effective_model)
    if model_label:
        set_attr("runtime.model", model_label)
    if user_id:
        set_attr("runtime.user_id", user_id)


def _runtime_model_label(model: object) -> str | None:
    if model is None:
        return None
    from agent.agents.base import describe_model

    if isinstance(model, str):
        return model
    return describe_model(model)
