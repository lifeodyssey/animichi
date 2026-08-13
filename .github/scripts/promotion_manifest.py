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


def _expect_sbv(errors, sbom):
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
    for name, dep in expected.get("dependencies", {}).items():
        want = dep.get("revision") if isinstance(dep, dict) else None
        current = None
        real = manifest.get("dependencies", {}).get(name)
        if isinstance(real, dict):
            current = real.get("revision")
        if want is not None and current != want:
            _add(
                errors,
                f"dependencies.{name}.revision mismatch: manifest {current!r} != expected {want!r}",
            )


def verify_manifest(manifest, expected):
    """Verify a manifest against the inputs that must be true at promotion."""
    errors = list(validate_manifest(manifest))
    if errors or not isinstance(expected, dict):
        return errors
    for field in ("component", "source_sha", "artifact_digest"):
        want = expected.get(field)
        if want is not None and manifest.get(field) != want:
            _add(
                errors,
                f"{field} mismatch: manifest {manifest.get(field)!r} != expected {want!r}",
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
