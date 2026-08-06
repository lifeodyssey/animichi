#!/usr/bin/env python3
"""Dry-run daily squash of a git ref by Asia/Shanghai day. NEVER pushes.

Builds a local-only `dry-run/daily-squash-<ts>` branch where each
Asia/Shanghai calendar day's tip tree becomes one parent-chained synthetic
commit, then asserts the final tree is identical to the original ref's tip
tree (`git diff` empty), prints a summary (day count, new commit count,
densest days), and exits non-zero on any mismatch.

This script has no push code path by design: it only reads the ref, runs
`git commit-tree`/`git update-ref` on local-only `dry-run/*` refs, and deletes
nothing on `main`. Use it purely to preview squashed history before any real
rewrite is planned.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo

Sha = str


def git(repo: str, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", repo, *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def shanghai_tz() -> tzinfo:
    try:
        return ZoneInfo("Asia/Shanghai")
    except Exception:
        return timezone(timedelta(hours=8))


def ref_exists(repo: str, ref: str) -> bool:
    r = subprocess.run(
        ["git", "-C", repo, "rev-parse", "--verify", "--quiet", ref],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def default_ref(repo: str) -> str:
    if ref_exists(repo, "refs/remotes/origin/main"):
        return "origin/main"
    return "main"


def walk_commits(repo: str, ref: str) -> list[tuple[Sha, int]]:
    lines = git(repo, "rev-list", "--reverse", "--format=%H %ct", ref).splitlines()
    commits = []
    for line in lines:
        parts = line.split()
        if len(parts) == 2 and not line.startswith("commit "):
            commits.append((parts[0], int(parts[1])))
    return commits


def day_key(ts: int, tz: tzinfo) -> str:
    return datetime.fromtimestamp(ts, tz).strftime("%Y-%m-%d")


def bucket_by_day(commits: list[tuple[Sha, int]], tz: tzinfo) -> OrderedDict[str, list[Sha]]:
    buckets: OrderedDict[str, list[Sha]] = OrderedDict()
    for sha, ts in commits:
        buckets.setdefault(day_key(ts, tz), []).append(sha)
    return buckets


def tip_tree(repo: str, sha: Sha) -> str:
    return git(repo, "rev-parse", f"{sha}^{{tree}}")


def author_of(repo: str, sha: Sha) -> tuple[str, str, int]:
    raw = git(repo, "show", "-s", "--format=%an%x00%ae%x00%ct", sha)
    name, email, ts = raw.split("\x00")
    return name, email, int(ts)


def commit_env(name: str, email: str, ts: int) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "GIT_AUTHOR_NAME": name,
            "GIT_AUTHOR_EMAIL": email,
            "GIT_AUTHOR_DATE": str(ts),
            "GIT_COMMITTER_NAME": name,
            "GIT_COMMITTER_EMAIL": email,
            "GIT_COMMITTER_DATE": str(ts),
        }
    )
    return env


def synthetic_commit(repo: str, tree: Sha, parent: Sha | None, msg: str, env: dict[str, str]) -> Sha:
    args = ["git", "-C", repo, "commit-tree", tree, "-m", msg]
    if parent:
        args += ["-p", parent]
    return subprocess.run(args, check=True, capture_output=True, text=True, env=env).stdout.strip()


def build_synthetic_history(
    repo: str, buckets: OrderedDict[str, list[Sha]]
) -> tuple[Sha, dict[str, int]]:
    head: Sha | None = None
    counts: dict[str, int] = {}
    for day, shas in buckets.items():
        tree = tip_tree(repo, shas[-1])
        name, email, ts = author_of(repo, shas[-1])
        msg = f"daily squash {day} ({len(shas)} commits)"
        head = synthetic_commit(repo, tree, head, msg, commit_env(name, email, ts))
        counts[day] = len(shas)
    if head is None:
        raise RuntimeError("empty bucket map — no synthetic head")
    return head, counts


def trees_identical(repo: str, old: str, new: str) -> bool:
    # --quiet --exit-code: 0 identical, 1 differ, 2 error (not "always 0")
    diff = subprocess.run(
        ["git", "-C", repo, "diff", "--quiet", "--exit-code", old, new],
        capture_output=True,
        text=True,
    )
    if diff.returncode in (0, 1):
        return diff.returncode == 0
    raise RuntimeError(f"git diff failed ({diff.returncode}): {diff.stderr.strip()}")


def densest(counts: dict[str, int], top: int = 5) -> list[tuple[str, int]]:
    return sorted(counts.items(), key=lambda item: item[1], reverse=True)[:top]


def make_branch(repo: str, sha: Sha, branch: str) -> None:
    git(repo, "update-ref", f"refs/heads/{branch}", sha)


def make_dry_run_branch(repo: str, head: Sha) -> str:
    branch = f"dry-run/daily-squash-{time.time_ns()}-{os.getpid()}"
    make_branch(repo, head, branch)
    return branch


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Dry-run daily squash of a ref by Asia/Shanghai day. Builds a "
            "local-only dry-run/* branch and NEVER pushes."
        )
    )
    parser.add_argument("--repo", default=os.getcwd(), help="git repo path (default: cwd)")
    parser.add_argument("--ref", default=None, help="ref to squash (default: origin/main, else main)")
    return parser.parse_args()


def print_summary(ref: str, counts: dict[str, int]) -> None:
    print(f"ref: {ref}")
    print(f"days: {len(counts)}")
    print(f"new commits: {len(counts)}")
    print("densest days (original commit count):")
    for day, n in densest(counts):
        print(f"  {day}: {n} commits")


def verify_and_report(repo: str, ref: str, branch: str, head: Sha) -> int:
    if trees_identical(repo, ref, branch):
        print(f"OK: diff {ref} {branch} empty — trees identical")
        print(f"new history: refs/heads/{branch} -> {head}")
        return 0
    print(f"ERROR: trees differ between {ref} and {branch}")
    return 2


def main() -> int:
    args = parse_args()
    ref = args.ref or default_ref(args.repo)
    commits = walk_commits(args.repo, ref)
    if not commits:
        print(f"no commits on {ref}")
        return 1
    buckets = bucket_by_day(commits, shanghai_tz())
    head, counts = build_synthetic_history(args.repo, buckets)
    branch = make_dry_run_branch(args.repo, head)
    print_summary(ref, counts)
    return verify_and_report(args.repo, ref, branch, head)


if __name__ == "__main__":
    raise SystemExit(main())
