"""Fail-closed commit message policy for the local commit-msg hook."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NoReturn

ALLOWED_TYPES = frozenset(
    {
        "feat",
        "fix",
        "refactor",
        "perf",
        "test",
        "docs",
        "ci",
        "build",
        "ops",
        "chore",
        "revert",
    }
)
ALLOWED_SCOPES = frozenset(
    {
        "agent",
        "web",
        "chat",
        "catalog",
        "users",
        "auth",
        "edge",
        "contract",
        "db",
        "infra",
        "delivery",
        "eval",
        "e2e",
        "repo",
        "deps",
    }
)
GENERIC_OUTCOMES = frozenset(
    {
        "wip",
        "work in progress",
        "checkpoint",
        "fix",
        "fixes",
        "fixed",
        "fix it",
        "update",
        "updates",
        "updated",
        "update code",
        "update files",
        "changes",
        "misc",
        "misc changes",
        "review",
        "polish",
        "format",
        "formatting",
        "lint",
        "ci",
        "tests",
        "comments",
    }
)
SUBJECT_PATTERN = re.compile(
    r"^(?P<type>[a-z]+)(?:\((?P<scope>[a-z0-9-]+)\))?: (?P<outcome>\S(?:.*\S)?)$"
)
COAUTHOR_PATTERN = re.compile(r"co-authored-by\s*:\s*(?P<identity>.+)", re.IGNORECASE)
AI_IDENTITY_PATTERN = re.compile(
    r"\b(?:claude|anthropic|codex|openai)\b", re.IGNORECASE
)
ISSUE_REFERENCE_PATTERN = re.compile(r"#\d+")
LOWERCASE_VERB_PATTERN = re.compile(r"^[a-z]")
GIT_MAINTENANCE_PATTERN = re.compile(r'^(?:Merge .+|Revert ".+")$')
CLAUDE_CODE_FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
MAX_SUBJECT_LENGTH = 72


def reject(reason: str) -> NoReturn:
    print(f"commit message rejected: {reason}", file=sys.stderr)
    raise SystemExit(1)


def validate_subject_length(subject: str) -> None:
    if len(subject) > MAX_SUBJECT_LENGTH:
        reject(f"subject must be at most {MAX_SUBJECT_LENGTH} characters")


def parse_subject(subject: str) -> re.Match[str]:
    match = SUBJECT_PATTERN.fullmatch(subject)
    if match is None:
        reject("expected <type>(optional-approved-scope): concise outcome")
    return match


def validate_taxonomy(match: re.Match[str]) -> None:
    commit_type = match.group("type")
    scope = match.group("scope")
    if commit_type not in ALLOWED_TYPES:
        reject(f"{commit_type!r} is not an allowed type")
    if scope is not None and scope not in ALLOWED_SCOPES:
        reject(f"{scope!r} is not an approved scope")


def validate_outcome(outcome: str) -> None:
    normalized = outcome.casefold().strip(" \t.!?:;_-")
    if normalized in GENERIC_OUTCOMES:
        reject(f"{outcome!r} is a generic outcome; describe what changed")
    if LOWERCASE_VERB_PATTERN.match(outcome) is None:
        reject("outcome must start with a lowercase verb")


def validate_structured_subject(subject: str) -> None:
    if ISSUE_REFERENCE_PATTERN.search(subject):
        reject("issue or PR references belong in the message body, not the subject")
    match = parse_subject(subject)
    validate_taxonomy(match)
    validate_outcome(match.group("outcome"))


def validate_attribution(lines: list[str]) -> None:
    for line in lines:
        stripped = line.strip()
        trailer = COAUTHOR_PATTERN.fullmatch(stripped)
        if trailer is not None and AI_IDENTITY_PATTERN.search(
            trailer.group("identity")
        ):
            reject("AI co-author trailer is not allowed")
        if stripped == CLAUDE_CODE_FOOTER:
            reject("Claude Code generation footer is not allowed")


def validate_message(message: str, *, allow_git_maintenance: bool = False) -> None:
    lines = message.splitlines()
    if not lines:
        reject("message is empty")
    subject = lines[0]
    validate_subject_length(subject)
    validate_attribution(lines[1:])
    if allow_git_maintenance and GIT_MAINTENANCE_PATTERN.fullmatch(subject):
        return
    validate_structured_subject(subject)


def read_message(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        reject(f"cannot read {path}: {error}")


def validate_arguments(arguments: list[str]) -> None:
    if len(arguments) == 2 and arguments[1] != "--subject":
        validate_message(read_message(Path(arguments[1])), allow_git_maintenance=True)
        return
    if len(arguments) == 3 and arguments[1] == "--subject":
        validate_message(arguments[2])
        return
    reject("usage: commit-message.py <message-file> | --subject <subject>")


def main(arguments: list[str]) -> None:
    validate_arguments(arguments)


if __name__ == "__main__":
    main(sys.argv)
