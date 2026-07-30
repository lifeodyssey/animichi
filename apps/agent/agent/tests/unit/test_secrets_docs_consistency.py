"""docs/ops/secrets.md must track every secret actually in use (PR #500 dual review, P1-A).

A one-time inventory snapshot rots the moment a secret is added, renamed, or re-scoped, and
nothing else notices — `LOGFIRE_TOKEN_PROD`/`LOGFIRE_TOKEN_STAGING` described a repo state
that was already gone by the same afternoon the doc was written. `gh secret list` cannot be
the enforcement mechanism in CI: the default `GITHUB_TOKEN` has no permission to list repo
secrets, and minting a standing repo-admin PAT just to keep a doc honest is a net-negative
trade (a permanent credential for a documentation nice-to-have). This asserts the same thing
with zero credentials, by grepping source instead of asking GitHub — mirroring the shape of
`test_anonymous_docs_consistency.py`, which does the same job for ARCHITECTURE.md against
worker/auth.ts.

Set A (things that must be documented): every name used as `${{ secrets.X }}` anywhere under
`.github/workflows/**`, plus every credential-shaped name in `worker/containerEnv.ts`'s
`CONTAINER_ENV_KEYS` (`_API_KEY`/`_TOKEN`/`_SECRET` suffix, plus the one exception
`SUPABASE_DB_URL`). The non-credential majority of `CONTAINER_ENV_KEYS` (`LOG_LEVEL`,
`CACHE_TTL_SECONDS`, ...) is plain runtime config with no GitHub secret behind it and is out
of scope here by the doc's own stated division of labor with `deployment.md`.

`GITHUB_TOKEN` is excluded: it is the GitHub Actions built-in token, never provisioned via
`gh secret set`, and structurally present in every workflow — documenting it here would be
noise, not signal.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[5]
WORKFLOWS_DIR = ROOT / ".github" / "workflows"
CONTAINER_ENV_FILE = ROOT / "worker" / "containerEnv.ts"
SECRETS_DOC = ROOT / "docs" / "ops" / "secrets.md"

SECRET_REF_RE = re.compile(r"\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}")
CREDENTIAL_SUFFIXES = ("_API_KEY", "_TOKEN", "_SECRET")
CREDENTIAL_EXCEPTIONS = {"SUPABASE_DB_URL"}
BUILTIN_TOKENS = {"GITHUB_TOKEN"}


def _workflow_secret_names() -> set[str]:
    names: set[str] = set()
    for path in WORKFLOWS_DIR.glob("*.yml"):
        names |= set(SECRET_REF_RE.findall(path.read_text(encoding="utf-8")))
    return names - BUILTIN_TOKENS


def _container_env_keys() -> list[str]:
    source = CONTAINER_ENV_FILE.read_text(encoding="utf-8")
    match = re.search(r"CONTAINER_ENV_KEYS\s*=\s*\[(.*?)\];", source, re.DOTALL)
    assert match, "CONTAINER_ENV_KEYS array not found in worker/containerEnv.ts"
    return re.findall(r'"([A-Z0-9_]+)"', match.group(1))


def _credential_shaped_container_keys() -> set[str]:
    return {
        key
        for key in _container_env_keys()
        if key in CREDENTIAL_EXCEPTIONS or key.endswith(CREDENTIAL_SUFFIXES)
    }


def _required_names() -> set[str]:
    return _workflow_secret_names() | _credential_shaped_container_keys()


def _section(text: str, heading: str) -> str:
    pattern = rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)"
    match = re.search(pattern, text, re.DOTALL | re.MULTILINE)
    assert match, f"heading '## {heading}' not found in {SECRETS_DOC}"
    return match.group(1)


def _first_column_names(markdown_table: str) -> set[str]:
    names: set[str] = set()
    for line in markdown_table.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = line.split("|")
        if len(cells) < 2 or "---" in cells[1]:
            continue
        names |= set(re.findall(r"`([A-Z0-9_]+)`", cells[1]))
    return names


@pytest.fixture(scope="module")
def secrets_doc_text() -> str:
    return SECRETS_DOC.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def live_names(secrets_doc_text: str) -> set[str]:
    return _first_column_names(_section(secrets_doc_text, "Live secrets"))


@pytest.fixture(scope="module")
def dead_names(secrets_doc_text: str) -> set[str]:
    return _first_column_names(_section(secrets_doc_text, "Referenced by nothing"))


def test_every_workflow_secret_and_credential_container_key_is_documented(
    live_names: set[str], dead_names: set[str]
) -> None:
    documented = live_names | dead_names
    missing = _required_names() - documented
    assert not missing, f"docs/ops/secrets.md is missing: {sorted(missing)}"


def test_live_table_entries_are_still_actually_referenced(live_names: set[str]) -> None:
    stale = live_names - _required_names()
    assert not stale, (
        "docs/ops/secrets.md 'Live' table claims a consumer that no longer exists "
        f"for: {sorted(stale)} — move these rows to 'Referenced by nothing'"
    )


def test_dead_table_entries_are_not_actually_wired_by_a_workflow(
    dead_names: set[str],
) -> None:
    # Deliberately narrower than `_required_names()`: `ZETA_API_KEY` and
    # `OPENAI_COMPAT_API_KEY` are credential-shaped `CONTAINER_ENV_KEYS` entries (so
    # `_required_names()` includes them, and test 1 requires them documented somewhere),
    # but that is exactly *why* they belong in "Referenced by nothing" — the allowlist
    # expects a value no workflow ever forwards. The real "did this get wired up" signal
    # is a workflow actually setting `${{ secrets.X }}`, not mere CONTAINER_ENV_KEYS
    # membership.
    resurrected = dead_names & _workflow_secret_names()
    assert not resurrected, (
        "docs/ops/secrets.md 'Referenced by nothing' table lists names a workflow now "
        f"actually forwards: {sorted(resurrected)} — move these rows to 'Live'"
    )


# A repo-relative path is one with a directory separator. Bare filenames
# (`ci.yml`, `settings.py`) are prose shorthand, not navigation targets, and
# several are ambiguous by design — this repo has four `wrangler.toml`.
_DOC_PATH = re.compile(r"`([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+\.(?:py|ts|toml))`")


def test_every_repo_relative_path_in_the_doc_still_exists(
    secrets_doc_text: str,
) -> None:
    """The doc's file paths must resolve, not just its secret names.

    The existing tests keep the *names* honest; nothing kept the *pointers*
    honest, and the monorepo move broke them silently. That matters more here
    than in ordinary docs because several of these paths sit inside remediation
    instructions ("remove its references from `config/settings.py`"). A reader
    who cannot find the file concludes the reference is already gone and skips
    the step, leaving code reading a secret that was just deleted.
    """
    missing = sorted(
        {p for p in _DOC_PATH.findall(secrets_doc_text) if not (ROOT / p).exists()}
    )
    assert not missing, (
        f"docs/ops/secrets.md points at paths that do not exist: {missing} — "
        "update them to their current location rather than deleting the reference"
    )
