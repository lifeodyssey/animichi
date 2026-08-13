"""Data types for the required PR check (issue #1008).

Small internal module so ``pr_review_check`` stays within the repo file limit
while every function keeps the 1-10-50 rule. ``PrGate`` is the single typed
gate verdict that ``pr_review_check`` produces and ``pr_check_json``
serializes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict

from review_verdict import LocalGate


# Raw GitHub comment shape before validation (total=False: every field is
# checked by ``_comment_field`` and coerced to ``str``; non-string fields fail
# closed). The parsed, typed view is ``Comment`` below.
class CommentRaw(TypedDict, total=False):
    author_association: str
    login: str
    body: str
    author_type: str
    id: str
    url: str


@dataclass(frozen=True)
class Comment:
    author_association: str
    login: str
    body: str
    author_type: str = ""
    id: str = ""
    url: str = ""


@dataclass(frozen=True)
class AckResult:
    status: str
    snapshot: str
    reason: str


@dataclass(frozen=True)
class MarkerResult:
    status: str
    reason: str


@dataclass(frozen=True)
class PrGate:
    approve: bool
    head_sha: str
    threads_unresolved: int
    findings: tuple[str, ...]
    snapshot: str
    ack: str
    marker: str
    local: LocalGate | None
    reason: str
