"""Managed-finding extraction for the required PR check (issue #1008).

Findings come from bot-authored top-level comments (qodo Bugs / Rule
violations, SonarCloud Quality Gate). Each managed-finding token carries the
comment identity (``id``/``url``) and a digest of its body so the findings
snapshot changes when a later finding lands or an existing finding body
changes, even at the same numeric count (issue #1008 finding 4). A finding
with neither ``id`` nor ``url`` has no stable identity and fails closed: two
malformed same-count findings must never collide into one token and preserve
an old acknowledgement. An unknown author type on a finding-shaped comment
also fails closed: the gate must not guess.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Final

from pr_check_types import Comment
from review_verdict import sha256_hex

BUGS_RE: Final[re.Pattern[str]] = re.compile(r"Bugs \((\d+)\)", re.IGNORECASE)
RULES_RE: Final[re.Pattern[str]] = re.compile(
    r"Rule violations \((\d+)\)", re.IGNORECASE
)
FINDING_RE: Final[re.Pattern[str]] = re.compile(
    r"Bugs \(\d+\)|Rule violations \(\d+\)|Quality Gate Failed", re.IGNORECASE
)


def managed_findings(comments: Sequence[Comment]) -> tuple[str, ...]:
    tokens: list[str] = []
    for comment in comments:
        tokens.extend(_finding_tokens(comment))
    return tuple(sorted(set(tokens)))


def _finding_count(body: str, pattern: re.Pattern[str]) -> int:
    match = pattern.search(body)
    return int(match.group(1)) if match else 0


def _finding_tokens(comment: Comment) -> list[str]:
    if not FINDING_RE.search(comment.body):
        return []
    if comment.author_type == "Bot":
        return _bot_finding_tokens(comment)
    return _classify_unknown(comment)


def _classify_unknown(comment: Comment) -> list[str]:
    if comment.author_type == "":
        raise ValueError(
            "managed-finding comment has no attributable author type; "
            "cannot classify the finding"
        )
    return []


def _bot_finding_tokens(comment: Comment) -> list[str]:
    tokens: list[str] = []
    bugs = _finding_count(comment.body, BUGS_RE)
    rules = _finding_count(comment.body, RULES_RE)
    if bugs >= 1:
        tokens.append(_managed_token("qodo-bugs", bugs, comment))
    if rules >= 1:
        tokens.append(_managed_token("qodo-rule-violations", rules, comment))
    _quality_gate_token(comment, tokens)
    return tokens


def _quality_gate_token(comment: Comment, tokens: list[str]) -> None:
    if "Quality Gate Failed" in comment.body:
        tokens.append(_managed_token("sonar-quality-gate", None, comment))


def _managed_token(kind: str, count: int | None, comment: Comment) -> str:
    identity = _stable_identity(comment)
    body_digest = sha256_hex(comment.body)[:12]
    if count is None:
        return f"{kind}:{identity}:{body_digest}"
    return f"{kind}:{count}:{identity}:{body_digest}"


def _stable_identity(comment: Comment) -> str:
    if comment.id:
        return comment.id
    if comment.url:
        return comment.url
    raise ValueError(
        "managed-finding comment has no stable identity; both id and url are empty"
    )
