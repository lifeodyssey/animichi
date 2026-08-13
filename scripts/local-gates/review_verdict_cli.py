"""CLI for the local review verdict gate (issue #1008).

    review-verdict-cli.py digest  <brief-file>
    review-verdict-cli.py snapshot <head> [--findings a,b,c]
    review-verdict-cli.py validate <verdict.json>
    review-verdict-cli.py gate    <verdict.json> --base B --head H --brief F

Exit codes: 0 pass, 1 reject/stale/invalid, 2 usage error. `gate` prints one
JSON object. The bash wrapper ``review-verdict.sh`` resolves the base/head
defaults from git and delegates here.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable

from review_verdict import LocalGate, brief_digest, findings_snapshot, gate_local
from verdict_parse import parse_verdict
from verdict_schema import validate_verdict


def _read_text(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _load_json(path: str) -> object:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _print_violations(violations: list[str]) -> None:
    for violation in violations:
        print(violation, file=sys.stderr)


def _handle_digest(args: argparse.Namespace) -> int:
    print(brief_digest(_read_text(args.brief_file)))
    return 0


def _handle_snapshot(args: argparse.Namespace) -> int:
    findings = tuple(item for item in args.findings.split(",") if item)
    print(findings_snapshot(args.head, findings))
    return 0


def _handle_validate(args: argparse.Namespace) -> int:
    raw = _load_json(args.verdict_file)
    violations = validate_verdict(raw)
    if violations:
        _print_violations(violations)
        return 1
    print("OK")
    return 0


def _handle_gate(args: argparse.Namespace) -> int:
    raw = _load_json(args.verdict_file)
    violations = validate_verdict(raw)
    if violations:
        _print_violations(violations)
        return 1
    gate = gate_local(parse_verdict(raw), args.base, args.head, _read_text(args.brief))
    return _emit_gate(gate)


def _emit_gate(gate: LocalGate) -> int:
    print(_gate_json(gate))
    return 0 if gate.state == "approve" else 1


def _gate_json(gate: LocalGate) -> str:
    return json.dumps(
        {
            "state": gate.state,
            "standards": gate.standards,
            "spec": gate.spec,
            "reasons": list(gate.reasons),
        },
        sort_keys=True,
    )


def _add_digest_parser(
    sub: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    digest = sub.add_parser("digest", help="print the brief digest of a file")
    digest.add_argument("brief_file")


def _add_snapshot_parser(
    sub: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    snapshot = sub.add_parser("snapshot", help="print the findings snapshot for a head")
    snapshot.add_argument("head")
    snapshot.add_argument(
        "--findings", default="", help="comma-separated managed finding tokens"
    )


def _add_validate_parser(
    sub: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    validate = sub.add_parser("validate", help="validate a verdict artifact")
    validate.add_argument("verdict_file")


def _add_gate_parser(
    sub: argparse._SubParsersAction[argparse.ArgumentParser],
) -> None:
    gate = sub.add_parser("gate", help="judge a verdict against base/head/brief")
    gate.add_argument("verdict_file")
    gate.add_argument("--base", required=True)
    gate.add_argument("--head", required=True)
    gate.add_argument("--brief", required=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="local review verdict gate (issue #1008)"
    )
    sub = parser.add_subparsers(dest="subcommand", required=True)
    _add_digest_parser(sub)
    _add_snapshot_parser(sub)
    _add_validate_parser(sub)
    _add_gate_parser(sub)
    return parser


def _handlers() -> dict[str, Callable[[argparse.Namespace], int]]:
    return {
        "digest": _handle_digest,
        "snapshot": _handle_snapshot,
        "validate": _handle_validate,
        "gate": _handle_gate,
    }


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    handler = _handlers().get(args.subcommand)
    if handler is None:
        return 2
    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
