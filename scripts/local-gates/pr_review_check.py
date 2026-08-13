"""The required PR check for the local review gate (issue #1008).

Reads unresolved review threads, top-level managed findings, the current head
SHA, and an authorized acknowledgement bound to the findings snapshot, then
emits one typed gate verdict (AC4). A new commit or a later managed finding
changes the snapshot, so an older acknowledgement is stale and the gate stays
blocked (AC5).

The findings extraction lives in ``pr_findings`` (identity-aware, bot-authored
tokens) and the human review-approval marker / authorized-human rule live in
``pr_approval``; this module is the gate that composes them. When no local
verdict artifact is supplied (the GitHub workflow path), the check requires the
strict, head/base/brief-bound human review-approval marker (issue #1008 finding
7); the local ``--verdict`` path supplies the same Standards/Spec decision from
the artifact instead.

Pure stdlib; imports the verdict model from ``review_verdict``, the schema
validator from ``verdict_schema``, the gate data types from
``pr_check_types``, and the JSON payload from ``pr_check_json``. The bash
wrapper ``pr-review-check.sh`` collects the GitHub state and delegates the
judgement here.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Sequence
from typing import Final, cast

from pr_approval import (
    MSG_LOCAL as MSG_MARKER_LOCAL,
)
from pr_approval import (
    MarkerResult,
    authorized_comments,
    marker_verdict,
)
from pr_check_json import gate_to_json
from pr_check_types import AckResult, Comment, CommentRaw, PrGate
from pr_findings import managed_findings
from review_verdict import (
    HEX_RE,
    LocalGate,
    Verdict,
    findings_snapshot,
    gate_local,
)
from verdict_parse import parse_verdict
from verdict_schema import validate_verdict

ACK_MARKER_RE: Final[re.Pattern[str]] = re.compile(
    r"线程判定|findings triaged|评论判定|toplevel triaged", re.IGNORECASE
)
SNAPSHOT_RE: Final[re.Pattern[str]] = re.compile(r"snapshot=([0-9a-f]{64})")
COMMENT_FIELDS: Final[tuple[str, ...]] = (
    "author_association",
    "login",
    "body",
    "author_type",
    "id",
    "url",
)
MSG_CLEAR: Final[str] = "no managed findings to acknowledge"
MSG_MISSING: Final[str] = "managed findings exist but no ack comment"
MSG_UNAUTHORIZED: Final[str] = (
    "only authorized human comments acknowledge findings; bot self-dismissal "
    "is not maintainer triage"
)
MSG_BOUND: Final[str] = "authorized ack bound to the current findings snapshot"
MSG_STALE: Final[str] = (
    "authorized ack references an older findings snapshot; a new commit or "
    "later finding invalidated it"
)


# Judge the acknowledgement bound to the current findings snapshot (AC4/AC5).
def ack_verdict(
    comments: Sequence[Comment], head_sha: str, findings: Sequence[str]
) -> AckResult:
    snapshot = findings_snapshot(head_sha, findings)
    if not findings:
        return AckResult("clear", snapshot, MSG_CLEAR)
    acked = _marker_comments(comments)
    if not acked:
        return AckResult("missing", snapshot, MSG_MISSING)
    return _judge_ack(authorized_comments(acked), snapshot)


def _marker_comments(comments: Sequence[Comment]) -> list[Comment]:
    return [comment for comment in comments if ACK_MARKER_RE.search(comment.body)]


def _judge_ack(authorized: Sequence[Comment], snapshot: str) -> AckResult:
    if not authorized:
        return AckResult("unauthorized", snapshot, MSG_UNAUTHORIZED)
    bound = SNAPSHOT_RE.search(authorized[-1].body)
    if bound is not None and bound.group(1) == snapshot:
        return AckResult("bound", snapshot, MSG_BOUND)
    return AckResult("stale", snapshot, MSG_STALE)


# The required PR gate: threads AND findings/ack AND the review decision (AC4).
# The review decision comes from the local verdict artifact when supplied,
# otherwise from the human review-approval marker in the comments. The marker's
# brief must match the canonical PR-body brief-digest record collected by
# ``collect`` (``expected_brief``); the GitHub path has no brief file, so a
# missing or malformed record fails closed (issue #1008 finding 7 rework).
def check_pr_gate(
    threads_unresolved: int,
    head_sha: str,
    comments: Sequence[Comment],
    verdict: Verdict | None = None,
    base_sha: str = "",
    brief_text: str = "",
    expected_brief: str = "",
) -> PrGate:
    findings = managed_findings(comments)
    ack = ack_verdict(comments, head_sha, findings)
    local = _gate_local(verdict, base_sha, head_sha, brief_text)
    marker = _marker_for(local, comments, head_sha, base_sha, expected_brief)
    return _assemble_gate(threads_unresolved, head_sha, findings, ack, marker, local)


def _marker_for(
    local: LocalGate | None,
    comments: Sequence[Comment],
    head_sha: str,
    base_sha: str,
    expected_brief: str,
) -> MarkerResult:
    if local is not None:
        return MarkerResult("local", MSG_MARKER_LOCAL)
    return marker_verdict(comments, head_sha, base_sha, expected_brief)


def _assemble_gate(
    threads_unresolved: int,
    head_sha: str,
    findings: tuple[str, ...],
    ack: AckResult,
    marker: MarkerResult,
    local: LocalGate | None,
) -> PrGate:
    return PrGate(
        approve=_pr_approve(threads_unresolved, ack, marker, local),
        head_sha=head_sha,
        threads_unresolved=threads_unresolved,
        findings=findings,
        snapshot=ack.snapshot,
        ack=ack.status,
        marker=marker.status,
        local=local,
        reason="; ".join(_gate_reasons(threads_unresolved, ack, marker, local)),
    )


def _gate_local(
    verdict: Verdict | None, base_sha: str, head_sha: str, brief_text: str
) -> LocalGate | None:
    if verdict is None:
        return None
    return gate_local(verdict, base_sha, head_sha, brief_text)


def _gate_reasons(
    threads_unresolved: int,
    ack: AckResult,
    marker: MarkerResult,
    local: LocalGate | None,
) -> list[str]:
    reasons: list[str] = []
    if threads_unresolved != 0:
        reasons.append(f"{threads_unresolved} unresolved review thread(s)")
    if ack.status not in ("clear", "bound"):
        reasons.append(f"managed findings not acknowledged ({ack.status})")
    if marker.status not in ("local", "bound"):
        reasons.append(f"review approval not on record ({marker.status})")
    _local_reasons(local, reasons)
    return reasons


def _local_reasons(local: LocalGate | None, reasons: list[str]) -> None:
    if local is not None and local.state != "approve":
        reasons.extend(local.reasons)


def _pr_approve(
    threads_unresolved: int,
    ack: AckResult,
    marker: MarkerResult,
    local: LocalGate | None,
) -> bool:
    return (
        threads_unresolved == 0
        and ack.status in ("clear", "bound")
        and marker.status in ("local", "bound")
        and (local is None or local.state == "approve")
    )


def _load_json(path: str) -> object:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _load_comments(path: str) -> tuple[Comment, ...]:
    raw = _load_json(path)
    if not isinstance(raw, list):
        raise TypeError(f"{path} must contain a JSON array of comments")
    return tuple(_parse_comment(item, path) for item in raw)


def _parse_comment(item: object, path: str) -> Comment:
    if not isinstance(item, dict):
        raise TypeError(f"{path} comment entries must be objects")
    return Comment(**_comment_values(cast(CommentRaw, item), path))


def _comment_values(item: CommentRaw, path: str) -> dict[str, str]:
    return {field: _comment_field(item, field, path) for field in COMMENT_FIELDS}


def _comment_field(item: CommentRaw, field: str, path: str) -> str:
    value = item.get(field)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise TypeError(f"{path} comment field {field} must be a string")
    return value


def _head_sha(args: argparse.Namespace) -> str:
    return _sha_field("head_sha", _load_json(f"{args.dir}/head_sha.json"))


def _base_sha(args: argparse.Namespace) -> str:
    if args.base:
        return _sha_field("base_sha", {"base_sha": args.base})
    return _sha_field("base_sha", _load_json(f"{args.dir}/base_sha.json"))


# Fail closed on an absent, empty, malformed, or wrong-typed pinned SHA
# (review-gate §1): the snapshot an ACK binds to is meaningless without a
# pinned head, and a stale head or base can never clear the approval marker.
# The value must be an actual string — a numeric 40/64-digit JSON value must
# fail closed, never be stringified into an accepted pin (issue #1008 finding
# 5 rework).
def _sha_field(name: str, raw: object) -> str:
    if not isinstance(raw, dict):
        raise TypeError(f"{name} must be a JSON object")
    value = raw.get(name)
    if not isinstance(value, str) or len(value) != 40 or not HEX_RE.match(value):
        raise ValueError(f"{name} must be 40 lowercase hex characters")
    return value


def _threads(threads_raw: object) -> int:
    if not isinstance(threads_raw, dict):
        raise TypeError("threads.json unresolved must be a non-negative integer")
    threads = threads_raw.get("unresolved", -1)
    if not isinstance(threads, int) or isinstance(threads, bool) or threads < 0:
        raise ValueError("threads.json unresolved must be a non-negative integer")
    return threads


def _verdict_inputs(args: argparse.Namespace) -> tuple[Verdict | None, str]:
    if not args.verdict:
        return None, ""
    raw = _load_json(args.verdict)
    if validate_verdict(raw):
        raise ValueError("verdict file failed schema validation")
    return parse_verdict(raw), _read_brief(args.brief)


# The canonical brief digest the GitHub path binds the approval marker to. It
# is collected from the PR-body ``review-gate brief:`` record, never read from
# an arbitrary caller-supplied value; a missing or malformed record fails
# closed (issue #1008 finding 7 rework). The digest must be an actual string —
# a numeric 64-digit JSON value fails closed instead of stringifying (finding
# 5 rework).
def _expected_brief(dir_path: str) -> str:
    raw = _load_json(f"{dir_path}/brief_digest.json")
    if not isinstance(raw, dict):
        raise TypeError("brief_digest.json must be a JSON object")
    digest = raw.get("brief_digest")
    if not isinstance(digest, str) or len(digest) != 64 or not HEX_RE.match(digest):
        raise ValueError(
            "no canonical brief-digest record; the marker cannot bind to an unknown brief"
        )
    return digest


def _read_brief(path: str) -> str:
    if not path:
        return ""
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def cmd_pr_check(args: argparse.Namespace) -> int:
    head_sha = _head_sha(args)
    threads = _threads(_load_json(f"{args.dir}/threads.json"))
    comments = _load_comments(f"{args.dir}/comments.json")
    verdict, brief_text = _verdict_inputs(args)
    base_sha = _base_sha(args)
    expected_brief = _expected_brief(args.dir) if verdict is None else ""
    gate = check_pr_gate(
        threads, head_sha, comments, verdict, base_sha, brief_text, expected_brief
    )
    print(gate_to_json(gate))
    return 0 if gate.approve else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="required PR gate (issue #1008)")
    sub = parser.add_subparsers(dest="subcommand", required=True)
    pr = sub.add_parser("pr-check", help="judge the collected GitHub state")
    pr.add_argument("dir")
    pr.add_argument("--verdict", default="")
    pr.add_argument("--brief", default="")
    pr.add_argument("--base", default="")
    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.subcommand != "pr-check":
        return 2
    try:
        return cmd_pr_check(args)
    except (OSError, TypeError, ValueError) as error:
        print(f"pr-check failed closed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
