#!/usr/bin/env python3
"""Unit tests for the build-once promotion manifest primitive (#1007).

Covers AC1 (the manifest schema pins component, source SHA, artifact digest,
SBOM/attestation, schema compatibility, configuration schema, and dependency
revisions), AC3 (per-component artifact generalization - every AC3 component
resolves to its own artifact dir and produces a manifest whose digest equals
the staging-tested artifact digest), and AC5 (an unchanged component is not
selected merely because another component is promoted).

Run: python3 .github/scripts/test_promotion_manifest.py
"""

import importlib.util
import io
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).parents[2]
MODULE_PATH = REPO_ROOT / ".github/scripts/promotion_manifest.py"


def load_module():
    spec = importlib.util.spec_from_file_location("promotion_manifest", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["promotion_manifest"] = module
    spec.loader.exec_module(module)
    return module


CLI_PATH = REPO_ROOT / ".github/scripts/promotion-manifest-cli.py"


def load_cli():
    spec = importlib.util.spec_from_file_location("promotion_manifest_cli", CLI_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["promotion_manifest_cli"] = module
    spec.loader.exec_module(module)
    return module


pm = None
cli = None


class PromotionManifestUnitTest(unittest.TestCase):
    SCHEMA_FIELDS = (
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

    @classmethod
    def setUpClass(cls):
        global pm, cli
        pm = load_module()
        cli = load_cli()

    def valid_manifest(self):
        return {
            "schema_version": pm.PROMOTION_MANIFEST_SCHEMA_VERSION,
            "component": "web",
            "source_sha": "b94c30ab6a519f1cce9eb0a3f7885953f8ff54cf",
            "artifact_digest": "a" * 64,
            "artifact_size": 12345,
            "sbom_attestation": {"format": "cyclonedx-1.5", "digest_sha256": "b" * 64},
            "schema_compatibility": {
                "provider": "atlas",
                "migration_head": "20260811000002",
                "digest_sha256": "c" * 64,
            },
            "config_schema": {"version": 1, "commit_sha": "d" * 40},
            "dependencies": {"catalog": {"revision": "e" * 40}},
        }

    # ── AC1: the manifest schema pins every required field ─────────────────
    def test_manifest_schema_pins_every_required_field(self):
        for field in self.SCHEMA_FIELDS:
            with self.subTest(field=field):
                manifest = self.valid_manifest()
                del manifest[field]
                errors = pm.validate_manifest(manifest)
                self.assertTrue(
                    any(("missing" in e and field in e) for e in errors),
                    f"field {field!r} must be required by the schema; errors={errors}",
                )

    def test_manifest_schema_rejects_unknown_fields(self):
        manifest = self.valid_manifest()
        manifest["surprise"] = 1
        errors = pm.validate_manifest(manifest)
        self.assertTrue(any("unknown" in e for e in errors))

    def test_manifest_schema_rejects_bad_component_sha_format(self):
        manifest = self.valid_manifest()
        manifest["source_sha"] = "not-a-sha"
        self.assertTrue(any("source_sha" in e for e in pm.validate_manifest(manifest)))

    def test_manifest_schema_rejects_non_hex_artifact_digest(self):
        manifest = self.valid_manifest()
        manifest["artifact_digest"] = "z" * 64
        self.assertTrue(
            any("artifact_digest" in e for e in pm.validate_manifest(manifest))
        )

    def test_manifest_schema_pins_config_schema_version(self):
        manifest = self.valid_manifest()
        manifest["config_schema"] = {"version": "latest"}
        self.assertTrue(
            any("config_schema" in e for e in pm.validate_manifest(manifest))
        )

    def test_manifest_schema_rejects_incompatible_schema_compatibility(self):
        manifest = self.valid_manifest()
        manifest["schema_compatibility"]["provider"] = "unknown"
        self.assertTrue(
            any("schema_compatibility" in e for e in pm.validate_manifest(manifest))
        )

    # ── AC1 (closure): unknown keys are rejected INSIDE nested objects ─────
    def test_manifest_schema_rejects_unknown_sbom_attestation_key(self):
        manifest = self.valid_manifest()
        manifest["sbom_attestation"]["surprise"] = "x"
        errors = pm.validate_manifest(manifest)
        self.assertTrue(any("unknown" in e for e in errors))

    def test_manifest_schema_rejects_unknown_schema_compatibility_key(self):
        manifest = self.valid_manifest()
        manifest["schema_compatibility"]["surprise"] = "x"
        errors = pm.validate_manifest(manifest)
        self.assertTrue(any("unknown" in e for e in errors))

    def test_manifest_schema_rejects_unknown_config_schema_key(self):
        manifest = self.valid_manifest()
        manifest["config_schema"]["surprise"] = "x"
        errors = pm.validate_manifest(manifest)
        self.assertTrue(any("unknown" in e for e in errors))

    def test_manifest_schema_rejects_unknown_dependency_key(self):
        manifest = self.valid_manifest()
        manifest["dependencies"]["catalog"]["surprise"] = "x"
        errors = pm.validate_manifest(manifest)
        self.assertTrue(any("unknown" in e for e in errors))

    def test_manifest_schema_accepts_known_nested_keys(self):
        # A fully valid manifest must still pass with zero errors after the
        # nested allowlists are enforced (guards against over-restriction).
        self.assertEqual(pm.validate_manifest(self.valid_manifest()), [])

    # ── Verify: a manifest re-validated against its own generated inputs ────
    def test_verify_passes_for_matching_inputs(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={
                "component": "web",
                "source_sha": manifest["source_sha"],
                "artifact_digest": manifest["artifact_digest"],
                # Verify is fail-closed about pins: every manifest dependency
                # must be pinned in expected, so supply the manifest's catalog
                # pin here.
                "dependencies": {
                    "catalog": {
                        "revision": manifest["dependencies"]["catalog"]["revision"]
                    }
                },
            },
        )
        self.assertEqual(errors, [])

    def test_verify_rejects_component_mismatch(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={
                "component": "catalog",
                "source_sha": manifest["source_sha"],
                "artifact_digest": manifest["artifact_digest"],
            },
        )
        self.assertTrue(any("component" in e for e in errors))

    def test_verify_rejects_digest_mismatch(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={
                "component": "web",
                "source_sha": manifest["source_sha"],
                "artifact_digest": "f" * 64,
            },
        )
        self.assertTrue(any("artifact_digest" in e for e in errors))

    def test_verify_rejects_source_revision_drift(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={
                "component": "web",
                "source_sha": "0" * 40,
                "artifact_digest": manifest["artifact_digest"],
            },
        )
        self.assertTrue(any("source_sha" in e for e in errors))

    def test_verify_rejects_changed_dependency_revision(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={
                "component": "web",
                "source_sha": manifest["source_sha"],
                "artifact_digest": manifest["artifact_digest"],
                "dependencies": {"catalog": {"revision": "e" * 40}},
            },
        )
        self.assertEqual(errors, [])

        # A changed dependency pin (catalog now at *another* revision than the
        # manifest records) must be rejected.
        errors = pm.verify_manifest(
            manifest,
            expected={
                "component": "web",
                "source_sha": manifest["source_sha"],
                "artifact_digest": manifest["artifact_digest"],
                "dependencies": {"catalog": {"revision": "f" * 40}},
            },
        )
        self.assertTrue(any("dependencies.catalog.revision" in e for e in errors))

    # ── Verify fails closed: empty/partial expectations and exact pin sets ─
    def test_verify_rejects_empty_expected(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(manifest, expected={})
        self.assertTrue(any("expected must be non-empty" in e for e in errors))

    def test_verify_rejects_schema_compatibility_mismatch(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={
                "schema_compatibility": {
                    "provider": "supabase",
                    "migration_head": "other",
                    "digest_sha256": "9" * 64,
                }
            },
        )
        self.assertTrue(any("schema_compatibility" in e for e in errors))

    def test_verify_rejects_config_schema_mismatch(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={"config_schema": {"version": 2, "commit_sha": "9" * 40}},
        )
        self.assertTrue(any("config_schema" in e for e in errors))

    def test_verify_accepts_matching_schema_compatibility_and_config_schema(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={
                "schema_compatibility": manifest["schema_compatibility"],
                "config_schema": manifest["config_schema"],
                # The manifest pins catalog, so expected must pin it too.
                "dependencies": {
                    "catalog": {
                        "revision": manifest["dependencies"]["catalog"]["revision"]
                    }
                },
            },
        )
        self.assertEqual(errors, [])

    def test_verify_rejects_extra_dependency_pin_in_manifest(self):
        manifest = self.valid_manifest()
        # The manifest pins catalog (+ nothing else); assert supplying an
        # expected dict that omits the manifest's pin is rejected.
        errors = pm.verify_manifest(manifest, expected={"component": "web"})
        self.assertTrue(any("dependencies" in e for e in errors))

        # The manifest must also match the exact expected pin set: a manifest
        # that adds a dep the expected dict does not pin is rejected.
        manifest["dependencies"]["edge"] = {"revision": "1" * 40}
        errors = pm.verify_manifest(
            manifest,
            expected={"dependencies": {"catalog": {"revision": "e" * 40}}},
        )
        self.assertTrue(any("dependencies.edge" in e for e in errors))

    def test_verify_rejects_missing_expected_dep_pin(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={"dependencies": {"users": {"revision": "1" * 40}}},
        )
        self.assertTrue(any("dependencies.users" in e for e in errors))

    def test_verify_accepts_exact_dependency_pin_set(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={"dependencies": {"catalog": {"revision": "e" * 40}}},
        )
        self.assertEqual(errors, [])

    # ── CLI: usage errors must not raise tracebacks ────────────────────────
    def test_cli_trailing_dep_is_usage_error(self):
        # A --dep as the final argument is a missing-value usage error, not a
        # traceback: _read_gen_args must return None so the CLI emits usage.
        self.assertIsNone(cli._read_gen_args(["--dep"]))

        # Drive the full generate path: a trailing --dep must exit 1 with a
        # usage error on stderr, never raise IndexError.
        err = io.StringIO()
        exit_code = cli.main(["generate", "--dep"], out=io.StringIO(), err=err)
        self.assertEqual(exit_code, 1)
        self.assertIn("usage:", err.getvalue())

    # ── AC5: an unchanged component is not selected because another changed ─
    def test_unchanged_component_is_not_selected_when_sibling_changed(self):
        # Given a changed component 'web' promoted at revision R, and an
        # unchanged sibling 'users' whose manifest still points at the prior
        # source_revision, the promotion selector must NOT select 'users'
        # merely because 'web' was promoted.
        candidate_manifest = {
            "web": {"source_sha": "r" * 40, "artifact_digest": "1" * 64},
            "users": {"source_sha": "0" * 40, "artifact_digest": "0" * 64},
        }
        # 'users' was already promoted at its current source_sha ("0"*40) and
        # is unchanged; 'web' moved to a new source_sha. Only 'web' may be
        # selected.
        selected = pm.select_promotable(
            candidate_manifest,
            latest_promoted_source_shas={
                "catalog": "0" * 40,
                "users": "0" * 40,
            },
        )
        self.assertEqual(selected, ["web"])
        self.assertNotIn("users", selected)

    # --- AC3: per-component artifact generalization ----------------------
    def test_ac3_every_mapped_component_resolves_an_artifact_dir(self):
        # Agent, Edge, Catalog, Users, Web, Infra each resolve to their own
        # artifact directory; a manifest digests that dir.
        self.assertTrue(set(pm.AC3_COMPONENTS) <= set(pm.COMPONENT_ARTIFACT_DIRS))
        dirs = {c: pm.component_artifact_dir(c) for c in pm.AC3_COMPONENTS}
        self.assertEqual(
            len(set(dirs.values())),
            len(dirs),
            "each AC3 component resolves to a distinct artifact dir",
        )
        self.assertEqual(pm.component_artifact_dir("web"), "apps/web/.output")
        self.assertIn(".output", dirs["web"])

    def test_ac3_unknown_component_fails_closed(self):
        with self.assertRaises(ValueError):
            pm.component_artifact_dir("not-a-component")
        self.assertFalse(pm.known_component("not-a-component"))
        self.assertTrue(pm.known_component("web"))

    def test_ac3_all_components_produce_staging_tested_manifest(self):
        # For every AC3 component, a manifest generated over its artifact dir
        # records an artifact_digest equal to the digest computed from that
        # same dir (the "staging-tested digest"). This closes the AC3 loop at
        # the unit level: the digest a caller approves equals the digest the
        # artifact dir produced, never a rebuilt/different artifact.
        import os
        import tempfile

        for component in pm.AC3_COMPONENTS:
            with self.subTest(component=component):
                d = pm.component_artifact_dir(component)
                artifact = os.path.basename(d.rstrip("/")) + ".tar.gz"
                with tempfile.TemporaryDirectory() as tmp:
                    src = os.path.join(tmp, "src")
                    os.makedirs(os.path.join(src, d), exist_ok=True)
                    with open(os.path.join(src, d, "f"), "w") as handle:
                        handle.write(component)
                    p = os.path.join(tmp, artifact)
                    # Deterministic tar via tarfile (matches the deploy flow's
                    # fixed mtime/uid/gid normalization without relying on a
                    # platform tar implementation / GNU-only flags).
                    import tarfile

                    with tarfile.open(p, "w:gz", format=tarfile.USTAR_FORMAT) as tf:
                        info = tf.gettarinfo(os.path.join(src, d), arcname=d)
                        info.mtime = 0
                        info.uid = 0
                        info.gid = 0
                        info.uname = "root"
                        info.gname = "root"
                        with open(os.path.join(src, d, "f"), "rb") as fh:
                            tf.addfile(info, fh)
                    computed = pm.digest_file(p)
                    manifest = cli._gen_manifest(
                        {
                            "component": component,
                            "source_sha": "a" * 40,
                            "artifact": p,
                            "sbom_format": "cyclonedx-1.5",
                            "sbom_digest": "b" * 64,
                            "schema_provider": "atlas",
                            "schema_head": "20260811000002",
                            "schema_digest": "c" * 64,
                            "config_version": 1,
                            "deps": [],
                        }
                    )
                    self.assertEqual(manifest["artifact_digest"], computed)
                    self.assertEqual(manifest["component"], component)


if __name__ == "__main__":
    unittest.main(verbosity=2)
