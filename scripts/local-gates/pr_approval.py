"""Human review-approval marker for the required PR check (issue #1008).

The marker substitutes for the local verdict artifact when ``check`` runs
without ``--verdict`` (the GitHub workflow path): a strict machine-readable
line in a comment by an authorized human that records both axes and the
reviewed base/head/brief pins (issue #1008 finding 7). Malformed,
unauthorized, rejected-axis, and stale markers all block.

The marker's ``brief`` must match the canonical brief digest that the review
handoff records in the PR body (``review-gate brief: <64hex>``); the GitHub
path has no brief file, so a syntax-only 64-hex check is not enough — a
wrong-but-well-formed digest must block (issue #1008 finding 7 rework). A
missing canonical record fails closed, so the marker can never bind to an
unknown brief.

The authorized-human rule lives here too so the findings ack and the approval
marker share one definition: only an ``OWNER``/``MEMBER``/``COLLABORATOR``
association with a GitHub ``User`` author type counts; a bot or an unreadable
author type fails closed (issue #1008 finding 3).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Final

from pr_check_types import Comment, MarkerResult

AUTHORIZED_ASSOCIATIONS: Final[frozenset[str]] = frozenset(
    {"OWNER", "MEMBER", "COLLABORATOR"}
)
HUMAN_TYPE: Final[str] = "User"
APPROVAL_PREFIX: Final[str] = "review-gate approval:"
APPROVAL_LINE_RE: Final[re.Pattern[str]] = re.compile(
    r"^review-gate approval: standards=(approve|reject) "
    r"spec=(approve|reject) base=([0-9a-f]{40}) "
    r"head=([0-9a-f]{40}) brief=([0-9a-f]{64})\s*$",
    re.IGNORECASE | re.MULTILINE,
)
MSG_MISSING: Final[str] = (
    "no local verdict and no authorized human review-approval marker"
)
MSG_UNAUTHORIZED: Final[str] = (
    "review-approval marker is not from an authorized human actor"
)
MSG_MALFORMED: Final[str] = "review-approval marker line is malformed"
MSG_REJECTED: Final[str] = "review-approval marker records a rejected axis"
MSG_STALE: Final[str] = "review-approval marker is bound to an older head or base"
MSG_UNBOUND: Final[str] = (
    "no canonical brief-digest record; the approval marker cannot be bound "
    "to the reviewed brief"
)
MSG_BRIEF: Final[str] = (
    "review-approval marker brief does not match the canonical brief digest"
)
MSG_BOUND: Final[str] = "human review-approval marker bound to head, base, and brief"
MSG_LOCAL: Final[str] = "local verdict artifact supplies the review decision"


def authorized_comments(comments: Sequence[Comment]) -> list[Comment]:
    return [
        comment
        for comment in comments
        if comment.author_association in AUTHORIZED_ASSOCIATIONS
        and comment.author_type == HUMAN_TYPE
    ]


def marker_verdict(
    comments: Sequence[Comment], head_sha: str, base_sha: str, expected_brief: str = ""
) -> MarkerResult:
    authorized = authorized_comments(_marker_candidates(comments))
    if not authorized:
        return _marker_absent(comments)
    match = APPROVAL_LINE_RE.search(authorized[-1].body)
    if match is None:
        return MarkerResult("malformed", MSG_MALFORMED)
    return _marker_parts(match, head_sha, base_sha, expected_brief)


def _marker_candidates(comments: Sequence[Comment]) -> list[Comment]:
    return [comment for comment in comments if APPROVAL_PREFIX in comment.body]


def _marker_absent(comments: Sequence[Comment]) -> MarkerResult:
    if not _marker_candidates(comments):
        return MarkerResult("missing", MSG_MISSING)
    return MarkerResult("unauthorized", MSG_UNAUTHORIZED)


def _marker_parts(
    match: re.Match[str], head_sha: str, base_sha: str, expected_brief: str
) -> MarkerResult:
    standards, spec, base, head, brief = match.groups()
    if standards != "approve" or spec != "approve":
        return MarkerResult("rejected", MSG_REJECTED)
    if not expected_brief:
        return MarkerResult("unbound", MSG_UNBOUND)
    status, message = _bound_state(
        base, head, brief, base_sha, head_sha, expected_brief
    )
    return MarkerResult(status, message)


def _bound_state(
    base: str, head: str, brief: str, base_sha: str, head_sha: str, expected_brief: str
) -> tuple[str, str]:
    if head != head_sha or base != base_sha:
        return "stale", MSG_STALE
    if brief == expected_brief:
        return "bound", MSG_BOUND
    return "brief", MSG_BRIEF
