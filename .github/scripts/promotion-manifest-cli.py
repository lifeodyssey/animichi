#!/usr/bin/env python3
"""Clone-free CLI for the build-once promotion manifest core (#1007).

Subcommands (exit 0 on success, 1 on failure):
  digest <file>                                  - print the artifact SHA-256
  generate --component <c> --source-sha <s> --artifact <file> \
        --sbom-format <f> --sbom-digest <d64> --schema-provider <p> \
        --schema-head <h> --schema-digest <d64> --config-version <n> \
        [--config-commit <sha40>] [--dep <comp>=<sha40>]...
        Build a manifest JSON (digest computed from <file>) to stdout.
  validate <manifest.json>                       - reject invalid manifests
  verify <manifest.json> --expected <pairs.json> - reject mismatch/corrupt
  artifact-dir <component>                       - per-component artifact dir
"""

import json
import os
import sys

from promotion_manifest import (
    PROMOTION_MANIFEST_SCHEMA_VERSION,
    digest_file,
    validate_manifest,
    verify_manifest,
)

VALUE_OPTS = {
    "--component": "component",
    "--source-sha": "source_sha",
    "--artifact": "artifact",
    "--sbom-format": "sbom_format",
    "--sbom-digest": "sbom_digest",
    "--schema-provider": "schema_provider",
    "--schema-head": "schema_head",
    "--schema-digest": "schema_digest",
    "--config-version": "config_version",
    "--config-commit": "config_commit",
}
REQUIRED_GEN = {
    "component",
    "source_sha",
    "artifact",
    "sbom_format",
    "sbom_digest",
    "schema_provider",
    "schema_head",
    "schema_digest",
    "config_version",
}


def _err(stream, msg):
    stream.write(msg + "\n")


def _load_json(path):
    with open(path, encoding="utf-8") as handle:
        return dict(json.load(handle))


def _map_opt(opts, key):
    return opts.get(key)


def _read_gen_args(argv):
    opts = {"deps": []}
    index = 0
    while index < len(argv):
        token = argv[index]
        if token == "--dep":
            if index + 1 >= len(argv):
                return None
            name, _, rev = argv[index + 1].partition("=")
            opts["deps"].append((name, rev))
            index += 2
            continue
        key = VALUE_OPTS.get(token)
        if key is None or index + 1 >= len(argv):
            return None
        opts[key] = argv[index + 1]
        index += 2
    return opts


def _gen_manifest(opts):
    deps = {name: {"revision": rev} for name, rev in opts["deps"]}
    return {
        "schema_version": PROMOTION_MANIFEST_SCHEMA_VERSION,
        "component": opts["component"],
        "source_sha": opts["source_sha"],
        "artifact_digest": digest_file(opts["artifact"]),
        "artifact_size": os.path.getsize(opts["artifact"]),
        "sbom_attestation": {
            "format": opts["sbom_format"],
            "digest_sha256": opts["sbom_digest"],
        },
        "schema_compatibility": {
            "provider": opts["schema_provider"],
            "migration_head": opts["schema_head"],
            "digest_sha256": opts["schema_digest"],
        },
        "config_schema": {
            "version": int(opts["config_version"]),
            **(
                {"commit_sha": opts["config_commit"]}
                if opts.get("config_commit")
                else {}
            ),
        },
        "dependencies": deps,
    }


def _cmd_digest(argv, out, err):
    if len(argv) != 1:
        _err(err, "usage: digest <file>")
        return 1
    out.write(digest_file(argv[0]) + "\n")
    return 0


def _cmd_generate(argv, out, err):
    opts = _read_gen_args(argv)
    if opts is None or not REQUIRED_GEN.issubset(set(opts)):
        _err(
            err,
            "usage: generate --component <c> --source-sha <s> --artifact <file> --sbom-format <f> --sbom-digest <d64> --schema-provider <p> --schema-head <h> --schema-digest <d64> --config-version <n> [--dep <c>=<sha40>]...",
        )
        return 1
    try:
        manifest = _gen_manifest(opts)
    except (OSError, ValueError) as exc:
        _err(err, f"generate failed: {exc}")
        return 1
    problems = validate_manifest(manifest)
    for problem in problems:
        _err(err, problem)
    if problems:
        return 1
    json.dump(manifest, out, indent=2, sort_keys=True)
    out.write("\n")
    return 0


def _cmd_validate(argv, out, err):
    if len(argv) != 1:
        _err(err, "usage: validate <manifest.json>")
        return 1
    problems = validate_manifest(_load_json(argv[0]))
    for problem in problems:
        _err(err, problem)
    if problems:
        return 1
    _err(out, "manifest is valid")
    return 0


def _cmd_verify(argv, out, err):
    if len(argv) != 3 or argv[1] != "--expected":
        _err(err, "usage: verify <manifest.json> --expected <pairs.json>")
        return 1
    problems = verify_manifest(_load_json(argv[0]), _load_json(argv[2]))
    for problem in problems:
        _err(err, problem)
    if problems:
        return 1
    _err(out, "manifest verifies")
    return 0


def _cmd_artifact_dir(argv, out, err):
    # AC3 (final promotion ticket #1013): resolve a component's promotion
    # artifact directory from the closed component table. An unmapped
    # component exits 1 (fail closed) instead of printing a bare path.
    #   usage: artifact-dir <component>
    if len(argv) != 1:
        _err(err, "usage: artifact-dir <component>")
        return 1
    from promotion_manifest import (
        component_artifact_dir,
    )

    try:
        out.write(component_artifact_dir(argv[0]) + "\n")
    except ValueError as exc:
        _err(err, str(exc))
        return 1
    return 0


def _cmd_bundle_producible(argv, out, err):
    # AC3 artifact-dir guard (#1013 fix round): exit 0 only for components
    # whose mapped dir is an actual produced build bundle a promotion may tar +
    # digest. infra (Pulumi state) and the container components (agent/root)
    # exit 1 so the deploy step fails closed before tar instead of recording a
    # wrong digest over a placeholder/source dir.
    #   usage: bundle-producible <component>
    if len(argv) != 1:
        _err(err, "usage: bundle-producible <component>")
        return 1
    from promotion_manifest import (
        BUNDLE_PRODUCIBLE,
    )

    if argv[0] in BUNDLE_PRODUCIBLE:
        out.write("true\n")
        return 0
    _err(err, f"{argv[0]} is not bundle-producible (no local file bundle)")
    return 1


DISPATCH = {
    "digest": _cmd_digest,
    "generate": _cmd_generate,
    "validate": _cmd_validate,
    "verify": _cmd_verify,
    "artifact-dir": _cmd_artifact_dir,
    "bundle-producible": _cmd_bundle_producible,
}


def main(argv=None, out=None, err=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    out = out if out is not None else sys.stdout
    err = err if err is not None else sys.stderr
    if not argv:
        _err(
            err,
            "usage: promotion-manifest-cli.py digest|generate|validate|verify|artifact-dir|bundle-producible ...",
        )
        return 1
    command = DISPATCH.get(argv[0])
    if command is None:
        _err(err, f"unknown command: {argv[0]}")
        return 1
    return command(argv[1:], out, err)


if __name__ == "__main__":
    sys.exit(main())
