"""Extract the canonical brief-digest record from a PR body (issue #1008).

The review handoff records the digest of the reviewed brief in the PR body as
``review-gate brief: <64hex>``. ``pr-review-check.sh collect`` pipes the PR
body here; this module writes ``{"brief_digest": "<64hex>"}`` (or an empty
string when the record is absent) into the collect dir. ``check`` fails closed
on a missing or malformed record, so the approval marker can never bind to an
unknown brief.

Exactly one **full-line** canonical record is allowed (issue #1008 finding 6):
a body that repeats the record with two valid digests, or that mixes a valid
record with a malformed marker-like line (a bad digest, a 65-hex digest, or
the marker embedded in prose instead of on its own line), must fail closed
rather than silently pick the valid one — the gate can never guess which brief
was reviewed.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Final

# A canonical record occupies its own line: ``review-gate brief: <64 hex>``.
BRIEF_LINE_RE: Final[re.Pattern[str]] = re.compile(
    r"^review-gate\s+brief:\s*([0-9a-f]{64})$"
)
# A marker-like occurrence (case-insensitive), canonical or not.
MARKER_LIKE_RE: Final[re.Pattern[str]] = re.compile(
    r"review-gate\s+brief:", re.IGNORECASE
)


def extract(body: str) -> str:
    canonical, malformed = _split_records(body)
    _reject_duplicates(canonical)
    _reject_ambiguous(canonical, malformed)
    return canonical[0] if canonical else ""


def _split_records(body: str) -> tuple[list[str], list[str]]:
    canonical: list[str] = []
    malformed: list[str] = []
    for line in body.splitlines():
        found, stray = _classify_line(line)
        canonical.extend(found)
        malformed.extend(stray)
    return canonical, malformed


def _classify_line(line: str) -> tuple[list[str], list[str]]:
    stripped = line.strip()
    match = BRIEF_LINE_RE.match(stripped)
    if match is not None:
        return [match.group(1)], []
    if MARKER_LIKE_RE.search(stripped):
        return [], [stripped]
    return [], []


def _reject_duplicates(canonical: list[str]) -> None:
    if len(canonical) > 1:
        raise ValueError(
            "multiple review-gate brief records; expected exactly one canonical "
            "record in the PR body"
        )


def _reject_ambiguous(canonical: list[str], malformed: list[str]) -> None:
    if canonical and malformed:
        raise ValueError(
            "review-gate brief record is ambiguous: a canonical record coexists "
            "with malformed marker-like text; expected exactly one canonical record"
        )


def main(argv: list[str]) -> int:
    try:
        digest = extract(sys.stdin.read())
    except ValueError as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        return 2
    print(json.dumps({"brief_digest": digest}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
