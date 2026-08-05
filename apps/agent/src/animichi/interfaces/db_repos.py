"""Extract narrow repo Protocols from the generic ``db: object`` boundary.

Iter6 C4: replaces the deleted ``domain.ports.get_*_repo``/``has_*_repo``
reflective accessors. Each extractor does exactly one ``getattr`` (the outer,
dynamically-named sub-repo lookup on an untyped ``db: object`` has no static
alternative in Python) followed by one ``iscoroutinefunction`` check on that
repo's characteristic method, then ``cast``s the result to its own narrow
Protocol type.

Why not isinstance-only ``@runtime_checkable`` Protocol narrowing (the first
version of this module, and the design doc's literal preference — "no
accessor functions, no cast")? It was tried and reverted: ``typing``'s
runtime-checkable ``isinstance()`` check for non-callable (property) members
uses ``inspect.getattr_static`` internally, which does **not** trigger
``unittest.mock.MagicMock.__getattr__``'s auto-vivification — so
``isinstance(MagicMock(), SomeHasXProtocol)`` is ``False`` for the plain,
unspecced ``MagicMock()`` doubles this test suite uses pervasively (only
``MagicMock(spec=X)`` populates real attributes that ``getattr_static`` can
see). Silently returning ``None`` for those doubles turned "repo present but
not configured for this call" into "repo absent", changing behavior for many
existing unit tests (verified empirically against the suite). This module
keeps the ``iscoroutinefunction`` wiring check the deleted accessors used for
exactly this reason, so "absent" and "not wired for async use" both collapse
to the same ``None`` — matching production and the existing test-double
convention. This is a disclosed, test-evidence-driven deviation from the
design's literal wording (see the C4 PR description): the *shape* of the old
per-repo ``getattr`` + ``iscoroutinefunction`` + ``cast`` survives (one
``cast`` per repo, each narrowing to that repo's own Protocol — never a
`cast(DatabasePort, ...)`-style aggregate), but it no longer lives in
``domain/ports.py`` as a reflective aggregate-adjacent API — it is seven
tiny, single-purpose, non-exported functions consolidated here instead of
scattered across call sites, and every downstream consumer takes the
resolved Protocol directly as a typed parameter.

Callers: ``RuntimeAPI.__init__`` (``animichi.interfaces.public_api``) is the
primary one — it resolves every repo it needs exactly once, in its
constructor, and every downstream function (``persistence.py``,
``usage_metering.py``, ``anon_quota.py``) takes the typed repo directly as a
parameter instead of the raw ``db``. ``usage_repo``/``anon_quota_repo`` also
have two direct callers outside ``RuntimeAPI``: the anonymous-budget and
per-identity-quota gates in ``animichi.interfaces.routes.chat`` and
``animichi.interfaces.routes.photo_search`` read them straight off
``request.app.state.db_client`` before those container-ingress checks run
(they gate a turn before ``RuntimeAPI.handle`` is even called, so there is no
``RuntimeAPI`` instance yet to resolve them on). "Repo absent" is expressed
by the extractor returning ``None`` to whichever of these callers invoked
it, never by a runtime probe deeper in the call chain.
"""

from __future__ import annotations

from asyncio import iscoroutinefunction
from typing import cast

from animichi.domain.ports import (
    AnonQuotaCounter,
    BangumiRepo,
    ConversationLog,
    RequestAudit,
    RouteArchive,
    SessionRepo,
    UsageMeter,
)


def _wired_sub_repo(db: object, attr: str, canary_method: str) -> object | None:
    """Return ``db.<attr>`` if it is wired with an async *canary_method*.

    Returns ``object``, not a narrow Protocol: each public wrapper below
    ``cast``s this to its own Protocol — the one place a cast is needed,
    since Python has no static way to type an attribute whose name is a
    runtime string.
    """
    repo = getattr(db, attr, None)
    if repo is None:
        return None
    if not iscoroutinefunction(getattr(repo, canary_method, None)):
        return None
    return cast(object, repo)


def session_repo(db: object) -> SessionRepo | None:
    """Return *db*'s session repo, or ``None`` if it is not wired for use."""
    repo = _wired_sub_repo(db, "session", "upsert_session")
    return cast(SessionRepo, repo) if repo is not None else None


def bangumi_repo(db: object) -> BangumiRepo | None:
    """Return *db*'s bangumi repo, or ``None`` if it is not wired for use."""
    repo = _wired_sub_repo(db, "bangumi", "filter_existing_ids")
    return cast(BangumiRepo, repo) if repo is not None else None


def routes_repo(db: object) -> RouteArchive | None:
    """Return *db*'s routes repo, or ``None`` if it is not wired for use."""
    repo = _wired_sub_repo(db, "routes", "save_route")
    return cast(RouteArchive, repo) if repo is not None else None


def usage_repo(db: object) -> UsageMeter | None:
    """Return *db*'s usage repo, or ``None`` if it is not wired for use."""
    repo = _wired_sub_repo(db, "usage", "accumulate_usage")
    return cast(UsageMeter, repo) if repo is not None else None


def anon_quota_repo(db: object) -> AnonQuotaCounter | None:
    """Return *db*'s anon-quota repo, or ``None`` if it is not wired for use."""
    repo = _wired_sub_repo(db, "anon_quota", "increment_and_count")
    return cast(AnonQuotaCounter, repo) if repo is not None else None


def messages_repo(db: object) -> ConversationLog | None:
    """Return *db*'s message log, or ``None`` if it is not wired for use."""
    repo = _wired_sub_repo(db, "messages", "insert_message")
    return cast(ConversationLog, repo) if repo is not None else None


def request_audit_repo(db: object) -> RequestAudit | None:
    """Return *db*'s request-audit log, or ``None`` if it is not wired for use."""
    repo = _wired_sub_repo(db, "feedback", "insert_request_log")
    return cast(RequestAudit, repo) if repo is not None else None
