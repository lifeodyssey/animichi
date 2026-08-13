"""Mutate a verdict fixture for the review-gate mutation probes.

Called by ``review-verdict.test.sh`` with the mutation ``op`` from the
red → restore → green probes (issue #1008). A single probe must change exactly
one invariant; unknown ops exit 2 rather than guessing. The mutation ops live
in ``mutate_verdict_ops`` so this dispatcher stays a thin CLI under the
200-line budget.
"""

from __future__ import annotations

import sys

from mutate_verdict_ops import MUTATIONS, load, save


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        return _usage_error()
    return _run(argv)


def _run(argv: list[str]) -> int:
    src, dst, op = argv
    handler = MUTATIONS.get(op)
    if handler is None:
        print(f"unknown op: {op}", file=sys.stderr)
        return 2
    save(dst, handler(load(src)))
    return 0


def _usage_error() -> int:
    print("usage: mutate_verdict.py <src> <dst> <op>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
