#!/usr/bin/env python3
"""Build-once promotion manifest core (#1007).

A small, dependency-free schema + verifier + selector for the artifact
promotion manifest that lets a component build once and promote the same
digest from staging to production.

Schema (all fields pinned, unknown fields rejected):
  schema_version       int  - schema revision (PROMOTION_MANIFEST_SCHEMA_VERSION)
  component            str  - deployable component key
  source_sha           str  - 40-hex git source revision the artifact was built from
  artifact_digest      str  - 64-hex SHA-256 of the built artifact
  artifact_size        int  - byte size of the built artifact
  sbom_attestation     obj  - SBOM/attestation identity (format + digest)
  schema_compatibility obj  - DB schema compatibility (provider, head, digest)
  config_schema        obj  - runtime configuration schema (version + commit)
  dependencies         obj  - map: component -> pinned dependency revision

Thread-safe, import-only (no side effects on import). The CLI lives in
promotion-manifest-cli.py.
"""

import hashlib
import re

PROMOTION_MANIFEST_SCHEMA_VERSION = 1

FULL_SHA_LEN = 40
SHA256_LEN = 64
FULL_SHA_RE = re.compile(rf"\A[0-9a-f]{{{FULL_SHA_LEN}}}\Z")
SHA256_RE = re.compile(rf"\A[0-9a-f]{{{SHA256_LEN}}}\Z")
SCHEMA_PROVIDERS = ("atlas", "supabase")
SBOM_FORMATS = ("cyclonedx-1.5", "spdx-2.3")

REQUIRED_FIELDS = (
    "schema_version",
    "component",
    "source_sha",
    "artifact_digest",
    "artifact_size",
    "sbom_attestation",
    "schema_compatibility",
    "config_schema",
    "dependencies",
)
SUPPORTED_KEYS = set(REQUIRED_FIELDS)

# Closed schema at every nesting level: each nested object has its own exact
# allowlist, so an unknown key inside sbom_attestation, schema_compatibility,
# config_schema, or a dependency object is rejected (not silently ignored).
SBOM_ATTESTATION_KEYS = ("format", "digest_sha256")
SCHEMA_COMPATIBILITY_KEYS = ("provider", "migration_head", "digest_sha256")
CONFIG_SCHEMA_KEYS = ("version", "commit_sha")
DEPENDENCY_KEYS = ("revision",)


def _add(errors, msg):
    errors.append(f"error: {msg}")


def digest_file(path):
    """Stream the SHA-256 hex digest of a file."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _expect_hex(errors, field, value, regex, length):
    if not isinstance(value, str) or not regex.match(value):
        _add(errors, f"{field} must be a hex string of length {length}")


def _expect_child_keys(errors, prefix, value, allowed):
    """Reject any key in a nested object outside its exact allowlist."""
    if not isinstance(value, dict):
        return
    unknown = sorted(set(value) - set(allowed))
    if unknown:
        _add(errors, f"{prefix} unknown field(s): {', '.join(unknown)}")


def _expect_sbv(errors, sbom):
    _expect_child_keys(errors, "sbom_attestation", sbom, SBOM_ATTESTATION_KEYS)
    if sbom.get("format") not in SBOM_FORMATS:
        _add(errors, f"sbom_attestation.format must be one of {SBOM_FORMATS}")
    _expect_hex(
        errors,
        "sbom_attestation.digest_sha256",
        sbom.get("digest_sha256"),
        SHA256_RE,
        SHA256_LEN,
    )


def _expect_schema(errors, schema):
    _expect_child_keys(
        errors, "schema_compatibility", schema, SCHEMA_COMPATIBILITY_KEYS
    )
    if schema.get("provider") not in SCHEMA_PROVIDERS:
        _add(errors, f"schema_compatibility.provider must be one of {SCHEMA_PROVIDERS}")
    if (
        not isinstance(schema.get("migration_head"), str)
        or not schema["migration_head"]
    ):
        _add(errors, "schema_compatibility.migration_head must be a non-empty string")
    _expect_hex(
        errors,
        "schema_compatibility.digest_sha256",
        schema.get("digest_sha256"),
        SHA256_RE,
        SHA256_LEN,
    )


def _expect_config(errors, config):
    _expect_child_keys(errors, "config_schema", config, CONFIG_SCHEMA_KEYS)
    if not isinstance(config.get("version"), int) or config["version"] < 1:
        _add(errors, "config_schema.version must be a positive integer")
    if "commit_sha" in config:
        _expect_hex(
            errors,
            "config_schema.commit_sha",
            config["commit_sha"],
            FULL_SHA_RE,
            FULL_SHA_LEN,
        )


def _expect_deps(errors, deps):
    if not isinstance(deps, dict):
        _add(errors, "dependencies must be an object")
        return
    for name, dep in deps.items():
        if isinstance(dep, dict):
            _expect_child_keys(errors, f"dependencies.{name}", dep, DEPENDENCY_KEYS)
        revision = dep.get("revision") if isinstance(dep, dict) else None
        _expect_hex(
            errors, f"dependencies.{name}.revision", revision, FULL_SHA_RE, FULL_SHA_LEN
        )


def _expect_core(errors, manifest):
    if manifest.get("schema_version") != PROMOTION_MANIFEST_SCHEMA_VERSION:
        _add(errors, f"schema_version must be {PROMOTION_MANIFEST_SCHEMA_VERSION}")
    if not isinstance(manifest.get("component"), str):
        _add(errors, "component must be a string")
    _expect_hex(
        errors, "source_sha", manifest.get("source_sha"), FULL_SHA_RE, FULL_SHA_LEN
    )
    _expect_hex(
        errors,
        "artifact_digest",
        manifest.get("artifact_digest"),
        SHA256_RE,
        SHA256_LEN,
    )
    size = manifest.get("artifact_size")
    if not isinstance(size, int) or size < 0:
        _add(errors, "artifact_size must be a non-negative integer")


def _expect_nested(errors, manifest):
    for key, expect in (
        ("sbom_attestation", _expect_sbv),
        ("schema_compatibility", _expect_schema),
        ("config_schema", _expect_config),
    ):
        value = manifest.get(key)
        if isinstance(value, dict):
            expect(errors, value)
        else:
            _add(errors, f"{key} must be an object")


def _expect_keys(errors, manifest):
    unknown = sorted(set(manifest) - SUPPORTED_KEYS)
    if unknown:
        _add(errors, f"unknown field(s): {', '.join(unknown)}")
    for field in REQUIRED_FIELDS:
        if field not in manifest:
            _add(errors, f"missing required field: {field}")


def validate_manifest(manifest):
    """Return a list of error strings; empty when the manifest is valid."""
    errors = []
    if not isinstance(manifest, dict):
        _add(errors, "manifest must be a JSON object")
        return errors
    _expect_keys(errors, manifest)
    _expect_core(errors, manifest)
    _expect_nested(errors, manifest)
    _expect_deps(errors, manifest.get("dependencies", {}))
    return errors


def _expect_dep_pins(errors, manifest, expected):
    manifest_deps = manifest.get("dependencies", {})
    if not isinstance(manifest_deps, dict):
        return
    expected_deps = expected.get("dependencies", {})
    if not isinstance(expected_deps, dict):
        return
    # Exact pin-set match over the union of the two dep name sets: a manifest
    # dependency that is not pinned in expected, and an expected pin whose
    # name is absent from the manifest, are both rejected — never silently
    # accepted.
    for name in set(manifest_deps) | set(expected_deps):
        real = manifest_deps.get(name)
        real = real if isinstance(real, dict) else {}
        want_dep = expected_deps.get(name)
        want = want_dep.get("revision") if isinstance(want_dep, dict) else None
        current = real.get("revision")
        if current != want:
            _add(
                errors,
                f"dependencies.{name}.revision mismatch: manifest {current!r} != expected {want!r}",
            )


def verify_manifest(manifest, expected):
    """Verify a manifest against the inputs that must be true at promotion.

    Fails closed: an empty expected dict verifies nothing and is rejected, the
    (optional) schema_compatibility / config_schema expectations are compared
    by whole-object equality, and scalar/missing/digest expectations must
    match exactly.
    """
    errors = list(validate_manifest(manifest))
    if errors or not isinstance(expected, dict):
        return errors
    if not expected:
        _add(errors, "expected must be non-empty")
        return errors
    for field in ("component", "source_sha", "artifact_digest"):
        want = expected.get(field)
        if want is not None and manifest.get(field) != want:
            _add(
                errors,
                f"{field} mismatch: manifest {manifest.get(field)!r} != expected {want!r}",
            )
    for field in ("schema_compatibility", "config_schema"):
        if field in expected and expected[field] != manifest.get(field):
            _add(
                errors,
                f"{field} mismatch: manifest {manifest.get(field)!r} != expected {expected[field]!r}",
            )
    _expect_dep_pins(errors, manifest, expected)
    return errors


def select_promotable(candidate_manifest, latest_promoted_source_shas):
    """Return components whose manifest source_sha advanced past the last promotion.

    AC5: an unchanged component (source_sha equals its own last promoted
    revision) is never selected merely because a sibling component changed.
    """
    selected = []
    for component, manifest in candidate_manifest.items():
        source_sha = manifest.get("source_sha")
        last = latest_promoted_source_shas.get(component)
        if last is not None and source_sha == last:
            continue
        selected.append(component)
    return selected


# AC3: per-component artifact generalization (final promotion ticket #1013).
# The #1007 foundation hardcoded PROMO_ARTIFACT_DIR to apps/web/.output in the
# deploy workflow, so only web could produce a build-once manifest. #1013
# generalizes this: every deployable component maps to the artifact directory
# (or build output) its promotion manifest digests. The deploy workflow resolves
# per-component dirs through this table, so an unmapped component fails
# explicitly instead of silently tarballing the wrong directory.
#
# IMPORTANT (spec review): each map value is the EXACT path the corresponding
# pipeline actually builds/emits - greppable in .github/workflows. Every value
# either names a directory the build step creates, or a real repo/build-context
# directory. No value is an invented path. $RUNNER_TEMP appears because the
# worker dry-run bundle build steps write there and the build-once promotion
# manifest step runs in the same job (reusable-deploy-component.yml); the deploy
# step expands $RUNNER_TEMP against the runner value.
#
# Artifact semantics per component (established in the existing pipelines):
#   web - TanStack/Nitro Cloudflare bundle at apps/web/.output (wrangler main
#         .output/server/index.mjs + ASSETS); created by `pnpm --filter web
#         build`. The one env-neutral bundle (#1013 slice 1).
#   catalog - wrangler dry-run bundle, this exact dir (pipeline-catalog.yml:104):
#         `wrangler deploy --dry-run --outdir "$RUNNER_TEMP/catalog-bundle"`.
#   users   - wrangler dry-run bundle (pipeline-users.yml:84):
#         `--outdir "$RUNNER_TEMP/users-bundle"`.
#   edge    - wrangler dry-run bundle, production config (pipeline-edge.yml:83):
#         `wrangler deploy -c workers/edge/wrangler.toml --dry-run -e production
#         --outdir "$RUNNER_TEMP/edge-bundle"`.
#   agent/root - container image: `docker build -f apps/agent/Dockerfile`
#         (pipeline-agent.yml:130). The image has no filesystem bundle; the map
#         points at the real build-context dir apps/agent (exists in the repo)
#         as the artifact source, and the authoritative digest for a container
#         promotion is the image digest (docker inspect). Until a packaged agent
#         bundle exists, an agent promotion must fail closed at the step that
#         loads the artifact, never silently digest a wrong dir.
#   infra - Pulumi IaC; its artifact is the immutable Pulumi stack state / plan
#         digest (no local bundle, state lives in R2). The mapping holds a
#         documented placeholder (infra/AGENTS.md) resolved by the infra step,
#         which fails closed until a Pulumi-state digest read is wired.
COMPONENT_ARTIFACT_DIRS = {
    "web": "apps/web/.output",
    "catalog": "$RUNNER_TEMP/catalog-bundle",
    "users": "$RUNNER_TEMP/users-bundle",
    "edge": "$RUNNER_TEMP/edge-bundle",
    "root": "apps/agent",
    "agent": "apps/agent",
    "infra": "infra/.pulumi-state",
}
# Components whose mapped dir is an actual produced build bundle that a
# promotion can tar + digest as the artifact. infra (Pulumi state) and the
# container components (agent/root) have NO local file bundle today: tar/digest
# over their mapped placeholder/source dir would record a WRONG digest
# (or fail raw on infra/.pulumi-state). The deploy step must FAIL CLOSED for
# these before tar (never digest a directory that is not the component artifact).
# Component keys whose bundle supports digests:
BUNDLE_PRODUCIBLE = frozenset(["web", "catalog", "users", "edge"])
# The AC3 manifest surface: Agent, Edge, Catalog, Users, Web, Infra. The deploy
# workflow keys these by the production-eligibility component name (root is the
# Agent container worker); the AC3 contract asserts a manifest for each of
# "agent" | "edge" | "catalog" | "users" | "web" | "infra".
AC3_COMPONENTS = ("agent", "edge", "catalog", "users", "web", "infra")


def component_artifact_dir(component):
    """Return the artifact directory a component manifest digests.

    AC3: every mapped component resolves to its own artifact dir; an unknown
    component raises ValueError so a caller fails closed rather than digests a
    mismatched/empty directory.
    """
    try:
        return COMPONENT_ARTIFACT_DIRS[component]
    except KeyError:
        names = ", ".join(sorted(COMPONENT_ARTIFACT_DIRS))
        msg = (
            "unknown component "
            + repr(component)
            + ": no artifact dir mapped; known components: "
            + names
        )
        raise ValueError(msg) from None


def component_bundle_producible(component):
    """Whether a component produces a local file bundle its manifest can digest.

    AC3 artifact-dir guard (#1013 fix round): only components whose mapped
    directory is an actual produced build bundle belong in BUNDLE_PRODUCIBLE.
    infra (Pulumi state) and the container components (agent/root) have no
    local file bundle; the deploy step must fail closed for them before tar/
    digest rather than record a wrong digest over a placeholder/source dir.
    """
    return component in BUNDLE_PRODUCIBLE


def known_component(component):
    """Whether a component has a mapped promotion artifact dir (AC3)."""
    return component in COMPONENT_ARTIFACT_DIRS
