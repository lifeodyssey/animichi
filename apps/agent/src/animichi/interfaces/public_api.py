"""Thin public API surface over the runtime pipeline.

Orchestration logic only — response building lives in ``response_builder``,
session management in ``session_facade``, and persistence in ``persistence``.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from functools import cached_property
from time import perf_counter
from typing import Protocol, cast
from uuid import uuid4

import httpx
import structlog
from fastapi import HTTPException

from animichi.agents.agent_result import AgentResult, AttributedUsage, UsagePayer
from animichi.agents.animichi_agent import animichi_agent
from animichi.agents.animichi_runner import (
    MemoryStore,
    build_translation_context,
    deserialize_message_history,
    new_translation_usage,
    resolve_request_model,
    run_animichi_agent,
    to_model_turn_usage,
    translation_usage,
)
from animichi.agents.base import (
    ModelAliasError,
    build_model_http_client,
    resolve_model,
)
from animichi.agents.error_boundary import (
    is_byok_credential_rejection,
    is_provider_error,
)
from animichi.agents.error_messages import build_input_error_message
from animichi.agents.runtime_deps import (
    OnStep,
    StepEvent,
    StepStatus,
    TitleTranslator,
    new_step_call_id,
)
from animichi.agents.selected_route import execute_selected_itinerary
from animichi.agents.selection import (
    SelectionError,
    execute_multi_selection,
    execute_place_selection,
    validate_candidate_selection,
)
from animichi.agents.session_state import SessionState
from animichi.agents.translation import (
    TranslationContext,
    TranslationResult,
    translate_text,
    translate_title,
    translation_agent,
)
from animichi.application.errors import ApplicationError, ErrorCode
from animichi.clients.catalog_client import CatalogClient, CatalogClientProtocol
from animichi.config.settings import Settings, get_settings
from animichi.domain.fact_ledger import record_turn_facts
from animichi.domain.ports import (
    BangumiRepo,
    CatalogLookup,
    ConversationLog,
    RequestAudit,
    SessionRepo,
    UsageMeter,
)
from animichi.infrastructure.memory import postgres_memory_store
from animichi.infrastructure.observability import (
    record_runtime_request,
    runtime_span,
)
from animichi.infrastructure.session import SessionStore, create_session_store
from animichi.interfaces.db_repos import (
    bangumi_repo,
    messages_repo,
    request_audit_repo,
    session_repo,
    usage_repo,
)
from animichi.interfaces.error_registry import (
    internal_error_response,
    public_error_response,
    timeout_error_response,
)
from animichi.interfaces.persistence import (
    build_response_session,
    create_owned_session,
    extract_plan_steps,
    load_session_state,
    persist_messages,
    persist_result,
)
from animichi.interfaces.response_builder import agent_result_to_response
from animichi.interfaces.schemas import (
    PublicAPIError,
    PublicAPIRequest,
    PublicAPIResponse,
    as_json_object,
)
from animichi.interfaces.session_facade import (
    build_context_block,
    build_message_history,
    extract_context_delta,
    normalize_session_state,
)
from animichi.interfaces.usage_metering import (
    UsagePrices,
    record_turn_usage,
    scope_for_identity,
)
from animichi.utils.language import detect_language, resolve_reply_language

__all__ = [
    "PublicAPIError",
    "PublicAPIRequest",
    "PublicAPIResponse",
    "RuntimeAPI",
    "detect_language",
    "handle_public_request",
]

logger = structlog.get_logger(__name__)


class _ModelLike(Protocol):
    """Structural stand-in for the framework model type (opaque passthrough)."""


def _byok_credential_rejected_response() -> PublicAPIResponse:
    """Fixed, safe copy only (T7): never echoes `str(exc)`, which could carry
    provider response body content."""
    return public_error_response(
        "byok_credential_rejected",
        intent="error",
    )


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

    # Iter6 C4: each repo is resolved at most once *per instance*, lazily,
    # on first actual use — never reflected on every call. `cached_property`
    # (not eager resolution in `__init__`) is deliberate: a `db` whose pool
    # hasn't been connected yet raises `RuntimeError` from these properties
    # (`SupabaseClient.session`/`.bangumi`/etc — "call connect() first"), and
    # that must surface where a caller can catch it — inside a request
    # handled by `handle()`, wrapped by FastAPI's exception handlers, not
    # while merely constructing the `RuntimeAPI` facade itself (which is not
    # request-scoped and has no exception handler around it). Eagerly
    # resolving all seven in `__init__` was tried first and reverted after
    # `test_unconnected_client_surfaces_error` caught it turning a clean 500
    # into an app-construction-time crash — see the C4 PR discussion.
    @cached_property
    def _session_repo(self) -> SessionRepo | None:
        return session_repo(self._db)

    @cached_property
    def _bangumi_repo(self) -> BangumiRepo | None:
        return bangumi_repo(self._db)

    @cached_property
    def _usage_repo(self) -> UsageMeter | None:
        return usage_repo(self._db)

    @cached_property
    def _messages_repo(self) -> ConversationLog | None:
        return messages_repo(self._db)

    @cached_property
    def _request_audit_repo(self) -> RequestAudit | None:
        return request_audit_repo(self._db)

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
        repo = self._session_repo
        if repo is None or not await repo.check_session_owner(session_id, user_id):
            raise HTTPException(status_code=404, detail="Conversation not found.")

    async def handle(
        self,
        request: PublicAPIRequest,
        *,
        model: _ModelLike | str | None = None,
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
                    is_byok=is_byok,
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
                    session_repo=self._session_repo,
                    bangumi_repo=self._bangumi_repo,
                    messages_repo=self._messages_repo,
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

                await self._record_usage(result, user_id, user_type, is_byok=is_byok)
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
        *,
        is_byok: bool = False,
    ) -> None:
        """SD-18 metering hook: bank this turn's RunUsage into ``daily_usage``.

        The request's primary BYOK call is zero-cost, while supplemental calls
        are priced from their actual payer attribution.
        """
        if result is None:
            return
        for item in _attributed_usage(result, is_byok):
            await _record_attributed_usage(
                self._usage_repo, item, user_id, user_type, self._usage_prices()
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
        await create_owned_session(
            self._session_repo, session_id, user_id, request.text, state
        )
        return session_id, True

    async def _load_session(
        self,
        session_id: str | None,
        request: PublicAPIRequest,
    ) -> tuple[dict[str, object], dict[str, object] | None, list[object]]:
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
        message_history = build_message_history(previous_state)
        return previous_state, context, message_history

    async def _execute_pipeline(
        self,
        request: PublicAPIRequest,
        context: dict[str, object] | None,
        message_history: list[object],
        effective_model: _ModelLike | str | None,
        on_step: OnStep | None,
        span: object,
        user_id: str | None,
        *,
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
                is_byok=is_byok,
            )
        except TimeoutError:
            _span_record_exception(span, TimeoutError("agent timed out"))
            logger.warning("agent_timeout", text=request.text[:50])
            return (
                None,
                timeout_error_response(self._settings.agent_deadline),
                context_delta,
            )
        except ModelAliasError as exc:
            _span_record_exception(span, exc)
            return (
                None,
                public_error_response("invalid_model_alias"),
                context_delta,
            )
        except SelectionError as exc:
            _span_record_exception(span, exc)
            return None, _invalid_selection_response(), context_delta
        except ApplicationError as exc:
            _span_record_exception(span, exc)
            details = as_json_object(exc.details)
            return (
                None,
                public_error_response(exc.error_code, details=details),
                context_delta,
            )
        except Exception as exc:
            _span_record_exception(span, exc)
            if is_byok and is_byok_credential_rejection(exc):
                logger.warning("byok_credential_rejected")
                return None, _byok_credential_rejected_response(), context_delta
            error_msg = str(exc)
            if is_provider_error(exc):
                logger.warning("provider_error", error=error_msg[:200])
                return (
                    None,
                    public_error_response("provider_error", intent="error"),
                    context_delta,
                )
            logger.error("pipeline_unhandled_exception", exc_info=exc)
            return (
                None,
                internal_error_response(),
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
                isolate_platform_usage=is_byok,
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
        history: list[object],
        effective_model: _ModelLike | str | None,
        on_step: OnStep | None,
        user_id: str | None = None,
        *,
        is_byok: bool = False,
    ) -> tuple[AgentResult, object | None, bool]:
        """Dispatch exactly one of point, candidate, or model request modes."""
        if request.selected_point_ids is not None:
            resolve_request_model(effective_model, self._model_http_client)
            result = await self._point_selection(request, context, on_step)
            return result, None, False
        if request.selected_candidate_ids is not None:
            resolve_request_model(effective_model, self._model_http_client)
            result = await self._candidate_selection(request, context, on_step)
            return result, None, False
        result = await self._model_request(
            request,
            context,
            history,
            effective_model,
            on_step,
            user_id,
            is_byok=is_byok,
        )
        return (
            result,
            resolve_request_model(effective_model, self._model_http_client),
            True,
        )

    async def _point_selection(
        self,
        request: PublicAPIRequest,
        context: dict[str, object] | None,
        on_step: OnStep | None,
    ) -> AgentResult:
        return await execute_selected_itinerary(
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
        history: list[object],
        effective_model: _ModelLike | str | None,
        on_step: OnStep | None,
        user_id: str | None,
        *,
        is_byok: bool = False,
    ) -> AgentResult:
        model = resolve_request_model(effective_model, self._model_http_client)
        supplemental_usage: list[AttributedUsage] = []
        result = await asyncio.wait_for(
            run_animichi_agent(
                text=request.text,
                # Iter6 C4 design note: replacing this cast with an
                # `isinstance(self._db, CatalogLookup)` guard changes
                # behavior for tests that patch `run_animichi_agent` itself
                # (the db value is then never dereferenced) — see the C4 PR
                # description for the flagged contradiction with the
                # behavior-equivalence constraint. Kept as the one
                # deliberately-retained cast; every other DatabasePort/
                # CatalogLookup cast and getattr accessor in this module is
                # gone.
                db=cast(CatalogLookup, self._db),
                model=model,
                locale=request.locale,
                context=context,
                message_history=deserialize_message_history(history),
                on_step=on_step,
                catalog=self._catalog,
                title_translator=(
                    self._server_title_translator(supplemental_usage)
                    if is_byok
                    else None
                ),
                memory_store=self._memory_store,
                user_id=user_id,
            ),
            timeout=self._settings.agent_deadline,
        )
        result.supplemental_usage.extend(supplemental_usage)
        return result

    def _server_title_translator(
        self, supplemental_usage: list[AttributedUsage]
    ) -> TitleTranslator:
        """D18: force `translate_anime_title` onto the server key on a BYOK
        turn. Without this override the tool inherits the active run's own
        model via `RunContext.model` (cheap connection reuse on every other
        turn) — which on a BYOK turn *is* the caller's credential. Passing an
        explicit callable here bypasses that inheritance: `ctx=None` makes
        `translate_title` fall back to `translation_agent`'s own baked-in
        server default, never the per-request override.
        """

        async def _translate(title: str, target_language: str) -> TranslationResult:
            usage = new_translation_usage()
            result = await translate_title(
                title,
                target_locale=target_language,
                kind="anime_title",
                catalog=self._catalog,
                ctx=build_translation_context(
                    resolve_model(translation_agent.model), usage
                ),
            )
            if usage.requests > 0:
                supplemental_usage.append(AttributedUsage(usage, "platform"))
            return result

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
                    messages_repo=self._messages_repo,
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

        if self._request_audit_repo is None:
            return

        try:
            await self._request_audit_repo.insert_request_log(
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
    model: _ModelLike | str | None = None,
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


def _selection_state(context: dict[str, object] | None) -> SessionState:
    """Restore the typed selection oracle from the unified session context."""
    raw = context.get("session_state_v2") if context is not None else None
    return SessionState.model_validate(raw) if isinstance(raw, dict) else SessionState()


def _invalid_selection_response(_message: str | None = None) -> PublicAPIResponse:
    """Return a typed stale/invalid selection response without mutating state."""
    return public_error_response(
        "invalid_selection",
        intent="clarify",
        ui={"component": "Clarification"},
    )


async def _apply_translation_gate(
    result: AgentResult,
    locale: str,
    on_step: OnStep | None,
    *,
    model: object | None,
    isolate_platform_usage: bool = False,
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
            ctx=_translation_context(result, model, isolate_platform_usage),
        )
        # Mutate the output model's message field
        object.__setattr__(result.output, "message", translated)
    except (OSError, RuntimeError, ValueError, TypeError):
        logger.warning("translation_gate_failed", locale=locale)
        status = "error"
    if on_step is not None:
        await on_step(StepEvent("translate", call_id, status, {}))


def _translation_context(
    result: AgentResult,
    model: object | None,
    isolate_platform_usage: bool = False,
) -> TranslationContext:
    selected = model or resolve_model(animichi_agent.model)
    usage = translation_usage(result, isolate_platform_usage)
    return build_translation_context(selected, usage)


def _attributed_usage(result: AgentResult, is_byok: bool) -> list[AttributedUsage]:
    payer: UsagePayer = "byok" if is_byok else "platform"
    primary = [] if result.usage is None else [AttributedUsage(result.usage, payer)]
    return [*primary, *result.supplemental_usage]


async def _record_attributed_usage(
    usage_repo: UsageMeter | None,
    item: AttributedUsage,
    user_id: str | None,
    user_type: str | None,
    platform_prices: UsagePrices,
) -> None:
    scope = scope_for_identity(user_id, user_type, is_byok=item.payer == "byok")
    prices = platform_prices if item.payer == "platform" else UsagePrices(0.0, 0.0)
    await record_turn_usage(
        usage_repo,
        usage=to_model_turn_usage(item.usage),
        scope=scope,
        prices=prices,
    )


async def record_attributed_usage(
    usage_repo: UsageMeter | None,
    item: AttributedUsage,
    user_id: str | None,
    user_type: str | None,
    platform_prices: UsagePrices,
) -> None:
    await _record_attributed_usage(
        usage_repo, item, user_id, user_type, platform_prices
    )


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
    from animichi.agents.base import describe_model

    if isinstance(model, str):
        return model
    return describe_model(model)
