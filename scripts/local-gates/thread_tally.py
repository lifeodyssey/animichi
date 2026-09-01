"""Sum per-page GraphQL review-thread tallies; fail closed on malformed data.

``pr-review-check.sh`` feeds one JSON object per page from the real GraphQL
thread parser — ``{"count": N, "malformed": M}`` — and this module prints the
total active-unresolved count, exiting 2 when any page is malformed (issue
#1008 §1 fail-closed). Malformed means a thread node whose ``isResolved`` or
``isOutdated`` is missing or not a boolean, or a response without a thread
array: that must never pass as a quiet ``{"unresolved": 0}``.
"""

from __future__ import annotations

import json
import sys
from typing import Final

MALFORMED_MSG: Final[str] = "BLOCKED: malformed review thread data."


def _page(line: str) -> dict[str, int]:
    page = json.loads(line)
    if not isinstance(page, dict):
        raise TypeError("thread tally page must be a JSON object")
    count = page.get("count", 0)
    malformed = page.get("malformed", 0)
    _check_tally_int("count", count)
    _check_tally_int("malformed", malformed)
    return {"count": count, "malformed": malformed}


def _check_tally_int(key: str, value: object) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise TypeError(f"thread tally {key} must be an integer")


def tally(lines: list[str]) -> tuple[int, int]:
    count = 0
    malformed = 0
    for line in lines:
        page = _tally_line(line)
        count += page["count"]
        malformed += page["malformed"]
    return count, malformed


def _tally_line(line: str) -> dict[str, int]:
    if not line.strip():
        return {"count": 0, "malformed": 0}
    return _page(line.strip())


def main(argv: list[str]) -> int:
    try:
        count, malformed = tally(sys.stdin.read().splitlines())
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"BLOCKED: unreadable thread tally: {error}", file=sys.stderr)
        return 2
    return _finish(count, malformed)


def _finish(count: int, malformed: int) -> int:
    if malformed:
        print(MALFORMED_MSG, file=sys.stderr)
        return 2
    print(count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
