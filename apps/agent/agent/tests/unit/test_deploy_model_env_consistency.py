"""Cross-language deployment invariants for container-required settings."""

from __future__ import annotations

import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[5]
# CONTAINER_ENV_KEYS/CONTAINER_REQUIRED_KEYS moved out of entry.ts into their
# own module (issue #282 review) so they're importable under plain
# `node --test` without pulling in entry.ts's @cloudflare/containers import
# chain — see worker/containerEnv.ts's module docstring.
_ENTRYPOINT = _REPO_ROOT / "worker" / "containerEnv.ts"
_CI_WORKFLOW = _REPO_ROOT / ".github" / "workflows" / "ci.yml"
_DEPLOY_WORKFLOW = _REPO_ROOT / ".github" / "workflows" / "deploy.yml"
_REUSABLE_DEPLOY_WORKFLOW = (
    _REPO_ROOT / ".github" / "workflows" / "_deploy-component.yml"
)
_DOCKERFILE = _REPO_ROOT / "Dockerfile"


def _typescript_string_list(source: str, const_name: str) -> set[str]:
    assignment = re.search(
        rf"const\s+{re.escape(const_name)}\s*=\s*\[(?P<body>.*?)\]\s*;",
        source,
        re.DOTALL,
    )
    assert assignment is not None, f"missing TypeScript constant: {const_name}"
    return set(re.findall(r'["\']([A-Z][A-Z0-9_]*)["\']', assignment["body"]))


def _named_workflow_step(source: str, name: str) -> str:
    step = re.search(
        rf"(?ms)^(?P<indent>[ ]*)-\s+name:\s*{re.escape(name)}\s*$"
        rf"(?P<body>.*?)(?=^(?P=indent)-\s+|\Z)",
        source,
    )
    assert step is not None, f"missing workflow step: {name}"
    return step["body"]


def _named_workflow_job(source: str, job_id: str) -> str:
    job = re.search(
        rf"(?ms)^  {re.escape(job_id)}:\s*$\n(?P<body>.*?)(?=^  [a-zA-Z0-9_-]+:\s*$|\Z)",
        source,
    )
    assert job is not None, f"missing workflow job: {job_id}"
    return job["body"]


def _wrangler_secret_names(step: str) -> set[str]:
    secrets = re.search(
        r"(?m)^[ \t]+(?:worker_)?secrets:\s*\|\s*$\n"
        r"(?P<body>(?:^[ \t]+[A-Z][A-Z0-9_]*[ \t]*$\n?)+)",
        step,
    )
    assert secrets is not None, "missing Wrangler secrets block"
    return set(re.findall(r"(?m)^[ \t]+([A-Z][A-Z0-9_]*)[ \t]*$", secrets["body"]))


def _mapped_secret_names(source: str) -> set[str]:
    mappings = re.findall(
        r"(?m)^\s+([A-Z][A-Z0-9_]*):\s+\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*}}\s*$",
        source,
    )
    return {name for name, secret in mappings if name == secret}


def test_container_required_keys_are_forwarded_and_deployed() -> None:
    entrypoint = _ENTRYPOINT.read_text(encoding="utf-8")
    required = _typescript_string_list(entrypoint, "CONTAINER_REQUIRED_KEYS")
    forwarded = _typescript_string_list(entrypoint, "CONTAINER_ENV_KEYS")
    deploy = _DEPLOY_WORKFLOW.read_text(encoding="utf-8")
    root_step = _named_workflow_step(deploy, "Deploy via Wrangler")
    provisioned = _wrangler_secret_names(root_step)

    # APP_ENV (issue #498) is a deliberate exception to the
    # "every required key is a Wrangler *secret*" invariant below: it is a
    # plain, non-secret `wrangler.toml` `[vars]`/`[env.*.vars]` value, not
    # something `wrangler secret put` provisions. Cloudflare exposes both
    # kinds identically on the container's `env` binding at runtime, so
    # buildContainerEnvVars's fail-closed check on it is still meaningful —
    # it just isn't wired through this workflow's `secrets: |` block, because
    # nothing needs to push it there.
    NON_SECRET_REQUIRED_KEYS = {"APP_ENV"}

    assert required
    assert required <= forwarded
    assert required - NON_SECRET_REQUIRED_KEYS <= provisioned


def test_ci_root_deploys_match_manual_root_secrets() -> None:
    deploy = _DEPLOY_WORKFLOW.read_text(encoding="utf-8")
    root_step = _named_workflow_step(deploy, "Deploy via Wrangler")
    manual_secrets = _wrangler_secret_names(root_step)
    ci = _CI_WORKFLOW.read_text(encoding="utf-8")
    staging = _named_workflow_job(ci, "deploy-root-staging")
    production = _named_workflow_job(ci, "deploy-root-prod")
    reusable = _REUSABLE_DEPLOY_WORKFLOW.read_text(encoding="utf-8")

    assert _wrangler_secret_names(staging) == manual_secrets
    assert _wrangler_secret_names(production) == manual_secrets
    assert manual_secrets <= _mapped_secret_names(staging)
    assert manual_secrets <= _mapped_secret_names(production)
    assert manual_secrets <= _mapped_secret_names(reusable)


def test_dockerfile_does_not_hardcode_a_privileged_app_env() -> None:
    """Issue #498's 4th touchpoint: a direct `docker run` (bypassing the
    Worker's CONTAINER_REQUIRED_KEYS fail-closed check entirely) must not
    silently default to a privileged environment. Settings.app_env's own
    Field default ("development") is what applies when APP_ENV is unset.
    """
    dockerfile = _DOCKERFILE.read_text(encoding="utf-8")
    assert "APP_ENV=" not in dockerfile
