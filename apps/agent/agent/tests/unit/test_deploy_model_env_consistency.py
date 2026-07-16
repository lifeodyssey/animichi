"""Cross-language deployment invariants for container-required settings."""

from __future__ import annotations

import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[5]
_ENTRYPOINT = _REPO_ROOT / "worker" / "entry.ts"
_DEPLOY_WORKFLOW = _REPO_ROOT / ".github" / "workflows" / "deploy.yml"


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


def _wrangler_secret_names(step: str) -> set[str]:
    secrets = re.search(
        r"(?m)^[ \t]+secrets:\s*\|\s*$\n"
        r"(?P<body>(?:^[ \t]+[A-Z][A-Z0-9_]*[ \t]*$\n?)+)",
        step,
    )
    assert secrets is not None, "missing Wrangler secrets block"
    return set(re.findall(r"(?m)^[ \t]+([A-Z][A-Z0-9_]*)[ \t]*$", secrets["body"]))


def test_container_required_keys_are_forwarded_and_deployed() -> None:
    entrypoint = _ENTRYPOINT.read_text(encoding="utf-8")
    required = _typescript_string_list(entrypoint, "CONTAINER_REQUIRED_KEYS")
    forwarded = _typescript_string_list(entrypoint, "CONTAINER_ENV_KEYS")
    deploy = _DEPLOY_WORKFLOW.read_text(encoding="utf-8")
    root_step = _named_workflow_step(deploy, "Deploy via Wrangler")
    provisioned = _wrangler_secret_names(root_step)

    assert required
    assert required <= forwarded
    assert required <= provisioned
