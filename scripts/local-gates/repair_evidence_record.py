#!/usr/bin/env python3
"""Orchestrator-facing recorder for verdict ``repair_evidence`` (issue #1008).

The AC6 cycle — reject -> OpenCode repair -> real gates/mutation -> fresh
approve -> PR-eligible — is satisfied only when the repair actually happened.
The verdict's ``repair_evidence`` records what truly ran, and this recorder is
the orchestrator's only way to produce that record:

- ``--mode local-deterministic-harness`` prints
  ``{"mode": "local-deterministic-harness"}`` and rejects every orchestrator
  field: the hermetic harness records itself, never an external session.
- ``--mode opencode --command C --session S --log F`` prints
  ``{"mode": "opencode", "command": C, "session": S, "log_digest": sha256(F)}``
  where C/S come verbatim from the CLI and the digest is computed from the log
  file F the orchestrator points at. The recorder never invents a command,
  session, or digest; a missing, empty, or unreadable log is a hard fail and
  nothing is printed.

Every record is re-validated through ``verdict_evidence`` before it reaches
stdout, so the recorder can never emit a ``repair_evidence`` the verdict schema
rejects (finding 5).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from typing import Final

from verdict_evidence import check_repair_evidence
from verdict_types import RepairEvidenceObject

LOCAL_MODE: Final[str] = "local-deterministic-harness"
OPENCODE_MODE: Final[str] = "opencode"


def _log_digest(log_path: str) -> str:
    """SHA-256 of the log file bytes; missing/empty/unreadable raises."""
    with open(log_path, "rb") as handle:
        content = handle.read()
    if not content:
        raise ValueError(f"repair log is empty: {log_path}")
    return hashlib.sha256(content).hexdigest()


def _local_record() -> RepairEvidenceObject:
    return {"mode": LOCAL_MODE}


def _opencode_record(args: argparse.Namespace) -> RepairEvidenceObject:
    return {
        "mode": OPENCODE_MODE,
        "command": args.command,
        "session": args.session,
        "log_digest": _log_digest(args.log),
    }


def _record(args: argparse.Namespace) -> RepairEvidenceObject:
    if args.mode == LOCAL_MODE:
        return _local_record()
    return _opencode_record(args)


def _validate(record: RepairEvidenceObject) -> list[str]:
    errors: list[str] = []
    check_repair_evidence(record, errors)
    return errors


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="record repair_evidence (issue #1008 AC6)"
    )
    parser.add_argument("--mode", choices=(LOCAL_MODE, OPENCODE_MODE), required=True)
    parser.add_argument("--command", help="the OpenCode repair command (opencode mode)")
    parser.add_argument("--session", help="the OpenCode session id (opencode mode)")
    parser.add_argument(
        "--log", help="the OpenCode session log file to digest (opencode mode)"
    )
    return parser


def _usage_error(message: str) -> int:
    print(message, file=sys.stderr)
    return 2


def _mode_error(args: argparse.Namespace) -> int | None:
    if args.mode == LOCAL_MODE and (args.command or args.session or args.log):
        return _usage_error(
            "local-deterministic-harness mode takes no orchestrator fields"
        )
    if args.mode != OPENCODE_MODE:
        return None
    return _missing_field_error(args)


def _missing_field_error(args: argparse.Namespace) -> int | None:
    missing = [
        name for name in ("command", "session", "log") if not getattr(args, name)
    ]
    if missing:
        return _usage_error(f"opencode mode requires --{' --'.join(missing)}")
    return None


def _emit(record: RepairEvidenceObject) -> int:
    errors = _validate(record)
    if not errors:
        print(json.dumps(record, sort_keys=True))
        return 0
    for error in errors:
        print(error, file=sys.stderr)
    return 1


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    error = _mode_error(args)
    if error is not None:
        return error
    return _emit_or_fail(args)


def _emit_or_fail(args: argparse.Namespace) -> int:
    try:
        record = _record(args)
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return _emit(record)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
