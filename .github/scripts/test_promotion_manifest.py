#!/usr/bin/env python3
"""Unit tests for the build-once promotion manifest primitive (#1007).

Covers AC1 (the manifest schema pins component, source SHA, artifact digest,
SBOM/attestation, schema compatibility, configuration schema, and dependency
revisions) and AC5 (an unchanged component is not selected merely because
another component is promoted).

Run: python3 .github/scripts/test_promotion_manifest.py
"""

import importlib.util
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


pm = None


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
        global pm
        pm = load_module()

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

    # ── Verify: a manifest re-validated against its own generated inputs ────
    def test_verify_passes_for_matching_inputs(self):
        manifest = self.valid_manifest()
        errors = pm.verify_manifest(
            manifest,
            expected={
                "component": "web",
                "source_sha": manifest["source_sha"],
                "artifact_digest": manifest["artifact_digest"],
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
