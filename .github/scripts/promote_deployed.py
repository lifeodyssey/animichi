#!/usr/bin/env python3
"""Deployed version-metadata read + approval gate (#1013 AC4).

AC4 (integration): deployment reads the deployed component's platform version
metadata after staging and fails when the deployed digest or config schema
differs from the approved promotion manifest.

Two responsibilities:
  1. read_deployed_version(component, reader) - obtain the platform's reported
     deployed {digest, config_schema} for a component through a caller-supplied
     READER. The reader is a callable that talks to the platform (Cloudflare
     wrangler deployments list, container image digest, Pulumi outputs, or the
     web RUNTIME_CONFIG seam); this module imports nothing platform-specific so
     the read is unit-testable by mocking the reader (the #1007 e2e simulates
     this read already).
  2. check_deployed(manifest, deployed) - fail closed when the deployed digest
     or config schema differs from the approved manifest.

Components with NO platform version metadata yet must not fake a green read:
their reader raises UnsupportedError with a documented pointer to the mechanism
that will expose it. The workflow treats this as fail-closed (it must be wired
on only once a real read exists), never as a silent pass.

The dispatch is a tiny registry so a caller (workflow / local gate / test) can
inject a mock reader and prove both the match and mismatch branches.

CLI (used by the local gate + tests):
  read-deployed <component> <reader-json>   - read via a reader described by
    a JSON blob that a real platform adapter maps to a {digest, config_schema};
    test path.
  check <manifest.json> <deployed.json>     - exit 0 on match, 1 on mismatch.
"""

import json
import sys

# A deployed version is {digest, config_schema} where config_schema mirrors the
# manifest's config_schema object ({version, commit_sha?}).
REQUIRED_DEPLOYED_KEYS = ("digest",)


class UnsupportedError(RuntimeError):
    """Raised when a component has no platform version-metadata read yet."""


def _normalize_digest(value):
    # Docker image digests commonly carry a leading "sha256:" scheme; a digest
    # reported by a platform with that prefix is normalized (not rejected) so
    # the AC4 comparison stays honest rather than trip on formatting.
    if isinstance(value, str) and value.startswith("sha256:"):
        return value[len("sha256:") :]
    return value


def _require_deployed(errors, deployed):
    if not isinstance(deployed, dict):
        errors.append("error: deployed version must be an object")
        return
    digest = _normalize_digest(deployed.get("digest"))
    deployed["digest"] = digest
    if not isinstance(digest, str) or len(digest) != 64:
        errors.append(
            f"error: deployed.digest must be a 64-hex SHA-256, got {digest!r}"
        )


def check_deployed(manifest, deployed):
    """Return a list of error strings comparing deployed metadata to the manifest.

    Fails closed on a digest mismatch OR a config-schema mismatch. Passes when
    the deployed digest equals the manifest artifact_digest and, when the
    deployed read reports a config_schema, it equals the manifest's.
    """
    errors = []
    if not isinstance(manifest, dict):
        errors.append("error: manifest must be an object")
        return errors
    _require_deployed(errors, deployed)
    if errors:
        return errors
    approved_digest = manifest.get("artifact_digest")
    if deployed["digest"] != approved_digest:
        errors.append(
            "error: deployed digest {!r} != approved manifest digest {!r}".format(
                deployed["digest"], approved_digest
            )
        )
    deployed_config = deployed.get("config_schema")
    if deployed_config is not None:
        approved_config = manifest.get("config_schema")
        if deployed_config != approved_config:
            errors.append(
                f"error: deployed config_schema {deployed_config!r} != approved manifest config_schema {approved_config!r}"
            )
    return errors


def read_deployed_version(component, reader):
    """Return the deployed version dict via a platform reader callable.

    The reader is injected: the workflow/local-gate supplies a platform-backed
    adapter, tests supply a mock. reader(component) -> {digest, config_schema}.
    A component whose platform exposes no version metadata yet must raise
    UnsupportedError (fail closed, never a fake green read).
    """
    return reader(component)


# Per-component platform metadata mechanism, documented for the fail-closed
# path. AC4 says: read where the platform exposes it; where none exists yet,
# fail closed with a TODO pointing at the mechanism.
PLATFORM_READ_MECHANISM = {
    "web": (
        "RUNTIME_CONFIG / Cloudflare provider-deployment: read the deployed "
        "worker's RUNTIME_CONFIG config_schema (schemaVersion+commit) and the "
        "deployment digest from wrangler deployments list / the ASSETS bundle."
    ),
    "root": (
        "Container image digest + /healthz git_commit (apps/agent/... "
        "build_info bake). wrangler deployments list reports the image SHA-256."
    ),
    "agent": (
        "Same container as root (apps/agent/Dockerfile); /healthz git_commit or "
        "wrangler deployments list container image digest."
    ),
    "edge": ("wrangler deployments list (edge Worker, workers/edge/wrangler.toml)."),
    "catalog": ("wrangler deployments list (workers/catalog/wrangler.toml)."),
    "users": ("wrangler deployments list (workers/users/wrangler.toml)."),
    "infra": (
        "Pulumi outputs / stack export digest (infra/AGENTS.md rollback backup)."
    ),
}


def unsupported_reader(component):
    """Default reader for components without a wired platform read (fail closed)."""
    raise UnsupportedError(
        "no platform version-metadata read wired for component {!r}; "
        "AC4 mechanism: {}".format(
            component,
            PLATFORM_READ_MECHANISM.get(
                component,
                "unknown component; add a PLATFORM_READ_MECHANISM entry or a reader",
            ),
        )
    )


def resolve_reader(component):
    """Return a platform reader for a component.

    Returns unsupported_reader (fail closed) until a real platform adapter is
    wired; tests inject their own mock instead. This keeps AC4 honest: no
    component silently reports a green read.
    """
    return unsupported_reader


def _cli_read_deployed(argv, out, err):
    # local/self-check path: `read-deployed <component> --reader json <file>`
    # reads the platform-reported {digest, config_schema} from a JSON file
    # emitted by the caller platform adapter, so the read + comparison can be
    # exercised without a live platform. A real platform adapter swaps the
    # `--reader json` branch for a platform call; the comparison is platform-agnostic.
    if len(argv) != 4 or argv[1] != "--reader" or argv[2] != "json":
        _err(err, "usage: read-deployed <component> --reader json <file>")
        return 1
    path = argv[3]
    try:
        with open(path, encoding="utf-8") as handle:
            deployed = json.load(handle)
    except (OSError, ValueError) as exc:
        _err(err, f"error: read-deployed failed: {exc}")
        return 1
    problems = []
    _require_deployed(problems, deployed)
    for problem in problems:
        _err(err, problem)
    if problems:
        return 1
    _err(out, json.dumps(deployed, sort_keys=True))
    return 0


def _cli_check(argv, out, err):
    if len(argv) != 2:
        _err(err, "usage: check <manifest.json> <deployed.json>")
        return 1
    try:
        with open(argv[0], encoding="utf-8") as handle:
            manifest = json.load(handle)
        with open(argv[1], encoding="utf-8") as handle:
            deployed = json.load(handle)
    except (OSError, ValueError) as exc:
        _err(err, f"error: check failed: {exc}")
        return 1
    problems = check_deployed(manifest, deployed)
    for problem in problems:
        _err(err, problem)
    if problems:
        return 1
    _err(out, "deployed version matches approved manifest")
    return 0


def _err(stream, msg):
    stream.write(msg + "\n")


DISPATCH = {
    "read-deployed": _cli_read_deployed,
    "check": _cli_check,
}


def main(argv=None, out=None, err=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    out = out if out is not None else sys.stdout
    err = err if err is not None else sys.stderr
    if not argv:
        _err(err, "usage: promote_deployed.py read-deployed|check ...")
        return 1
    command = DISPATCH.get(argv[0])
    if command is None:
        _err(err, f"unknown command: {argv[0]}")
        return 1
    return command(argv[1:], out, err)


if __name__ == "__main__":
    sys.exit(main())
