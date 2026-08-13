"""Source mutation for the review-gate mutation probes.

Called by ``review-verdict.test.sh`` with the mutation ``op`` (red → restore →
green, issue #1008). Each op changes exactly one invariant in the copied
source module; unknown ops exit 2 rather than guessing.
"""

from __future__ import annotations

import sys
from collections.abc import Callable

Mutation = Callable[[str], str]


def _drop_empty_evidence(source: str) -> str:
    return source.replace(
        "    if len(items) < min_items:",
        "    if False:  # mutated: emptiness check dropped",
        1,
    ).replace(
        "    check_evidence_completeness(verdict, errors)",
        "    True  # mutated: evidence completeness dropped",
        1,
    )


def _drop_evidence_proof(source: str) -> str:
    return source.replace(
        "def approval_evidence_reasons(verdict: Verdict) -> tuple[str, ...]:\n"
        "    return tuple(_gate_run_reasons(verdict) + _mutation_reasons(verdict))",
        "def approval_evidence_reasons(verdict: Verdict) -> tuple[str, ...]:\n"
        "    return ()  # mutated: approval-evidence proof dropped",
        1,
    )


def _drop_unknown_keys(source: str) -> str:
    return source.replace(
        "    for name in sorted(set(obj) - allowed):",
        "    if False:  # mutated: recursive unknown-key validation dropped",
        1,
    )


def _drop_rfc3339(source: str) -> str:
    return source.replace(
        "    if not isinstance(value, str) or not RFC3339_RE.match(value):",
        "    if not isinstance(value, str):  # mutated: RFC3339 strictness dropped",
        1,
    )


def _drop_ac_unique(source: str) -> str:
    return source.replace(
        "    if ac_id in seen:",
        "    if False:  # mutated: duplicate ac_id validation dropped",
        1,
    )


def _drop_ac_count(source: str) -> str:
    return source.replace(
        "    if (\n"
        "        isinstance(total, int)\n"
        "        and not isinstance(total, bool)\n"
        "        and len(mappings) != total\n"
        "    ):",
        "    if False:  # mutated: ac_total count validation dropped",
        1,
    )


MUTATIONS: dict[str, Mutation] = {
    "drop-empty-evidence": _drop_empty_evidence,
    "drop-evidence-proof": _drop_evidence_proof,
    "drop-unknown-keys": _drop_unknown_keys,
    "drop-rfc3339": _drop_rfc3339,
    "drop-ac-unique": _drop_ac_unique,
    "drop-ac-count": _drop_ac_count,
}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        return _usage_error()
    return _run(argv)


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _run(argv: list[str]) -> int:
    src, dst, op = argv
    handler = MUTATIONS.get(op)
    if handler is None:
        print(f"unknown source mutation: {op}", file=sys.stderr)
        return 2
    source = _read(src)
    with open(dst, "w", encoding="utf-8") as handle:
        handle.write(handler(source))
    return 0


def _usage_error() -> int:
    print("usage: mutate_source.py <src> <dst> <op>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
