"""Merge the per-page GraphQL PR-comment arrays; fail closed on unreadable data.

``pr-review-check.sh collect`` runs ``gh api graphql --paginate`` for top-level
PR comments and pipes the per-page normalized JSON arrays (one line per page)
into this module, which concatenates them in page order into the single
``comments.json`` array the gate consumes (issue #1008).

Fail-closed (issue #1008 §1): a page that is not a JSON array of comment
objects, a finding-shaped comment whose author type cannot be read, or a
finding-shaped comment with no identity (``id`` or ``url``) is a hard block —
never a quiet empty list that manufactures a green. Field types are validated
before normalization: a malformed numeric/null ``author_type`` or ``id`` is a
hard block, never a stringified value that turns into an ignorable author
(issue #1008 finding 5). Real GitHub GraphQL always returns strings for these
fields, so the strictness never rejects production data. The finding-shape
regex is shared with ``pr_findings`` so the collector and the gate judge the
same comments.
"""

from __future__ import annotations

import json
import sys
from typing import Final, TypedDict, cast

from pr_findings import FINDING_RE

MALFORMED_MSG: Final[str] = "BLOCKED: unreadable GraphQL comments response."

STRING_FIELDS: Final[tuple[str, ...]] = (
    "author_association",
    "login",
    "body",
    "author_type",
    "id",
    "url",
)


class CommentObject(TypedDict, total=False):
    author_association: str
    login: str
    body: str
    author_type: str
    id: str
    url: str


def _page(line: str) -> list[CommentObject]:
    page = json.loads(line)
    if not isinstance(page, list):
        raise TypeError("comments page must be a JSON array")
    for item in page:
        _check_comment(item)
    return [cast(CommentObject, item) for item in page]


def _check_comment(item: object) -> None:
    if not isinstance(item, dict):
        raise TypeError("comments page entries must be objects")
    comment = cast(CommentObject, item)
    _check_field_types(comment)
    body = comment.get("body") or ""
    author_type = comment.get("author_type") or ""
    identity = comment.get("id") or comment.get("url") or ""
    if FINDING_RE.search(body) and (not author_type or not identity):
        raise ValueError(
            "finding-shaped comment has no readable author type or identity"
        )


def _check_field_types(comment: CommentObject) -> None:
    for field in STRING_FIELDS:
        _check_field_type(comment, field)


def _check_field_type(comment: CommentObject, field: str) -> None:
    value = comment.get(field)
    if value is not None and not isinstance(value, str):
        raise TypeError(
            f"comment field {field} must be a string, got {type(value).__name__}"
        )


def combine(lines: list[str]) -> list[CommentObject]:
    comments: list[CommentObject] = []
    for line in lines:
        _append_page(comments, line)
    return comments


def _append_page(comments: list[CommentObject], line: str) -> None:
    if not line.strip():
        return
    comments.extend(_page(line.strip()))


def main(argv: list[str]) -> int:
    try:
        comments = combine(sys.stdin.read().splitlines())
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        print(MALFORMED_MSG, file=sys.stderr)
        print(f"cause: {error}", file=sys.stderr)
        return 2
    print(json.dumps(comments))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
