#!/usr/bin/env python3
"""Unit tests for the AC4 deployed-version-metadata read + approval gate (#1013).

Covers AC4: the deployment reads the deployed component platform version
metadata and fails when the deployed digest/config schema differs from the
approved promotion manifest. The platform read is MOCKED (the reader is
injected), so both the match and the mismatch branches are proven without a
live platform; components with no platform metadata yet fail closed with a
documented TODO.

Run: python3 .github/scripts/test_promote_deployed.py
"""

import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).parents[2]
MODULE_PATH = REPO_ROOT / ".github/scripts/promote_deployed.py"


def load_module():
    spec = importlib.util.spec_from_file_location("promote_deployed", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["promote_deployed"] = module
    spec.loader.exec_module(module)
    return module


pd = None


class PromoteDeployedUnitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global pd
        pd = load_module()

    def valid_manifest(self, digest="a" * 64):
        return {
            "artifact_digest": digest,
            "config_schema": {"version": 1, "commit_sha": "b" * 40},
        }

    # -- AC4: match passes, mismatch fails --------------------------------
    def test_deployed_matches_approved_manifest(self):
        self.assertEqual(
            pd.check_deployed(
                self.valid_manifest(),
                {
                    "digest": "a" * 64,
                    "config_schema": {"version": 1, "commit_sha": "b" * 40},
                },
            ),
            [],
        )

    def test_deployed_digest_mismatch_fails_closed(self):
        errors = pd.check_deployed(self.valid_manifest(), {"digest": "f" * 64})
        self.assertTrue(any("digest" in e for e in errors))

    def test_deployed_config_schema_mismatch_fails_closed(self):
        errors = pd.check_deployed(
            self.valid_manifest(),
            {
                "digest": "a" * 64,
                "config_schema": {"version": 2, "commit_sha": "b" * 40},
            },
        )
        self.assertTrue(any("config_schema" in e for e in errors))

    def test_deployed_digest_missing_fails_closed(self):
        errors = pd.check_deployed(self.valid_manifest(), {})
        self.assertTrue(any("digest" in e for e in errors))

    def test_deployed_digest_with_sha256_scheme_normalized(self):
        errors = pd.check_deployed(
            self.valid_manifest(),
            {"digest": "sha256:" + "a" * 64},
        )
        self.assertEqual(errors, [])

    # -- AC4: the platform read is mockable and dispatchable -----------------
    def test_read_deployed_uses_injected_mock_reader(self):
        def fake_reader(component):
            return {"digest": "c" * 64, "config_schema": {"version": 1}}

        deployed = pd.read_deployed_version("catalog", fake_reader)
        self.assertEqual(deployed["digest"], "c" * 64)

    # -- AC4: components with no platform metadata fail closed, never green -
    def test_unwired_component_reader_fails_closed(self):
        with self.assertRaises(pd.UnsupportedError):
            pd.unsupported_reader("catalog")
        # Every AC3 component has a documented platform metadata mechanism.
        for component in ("web", "edge", "catalog", "users", "agent", "infra"):
            self.assertIn(component, pd.PLATFORM_READ_MECHANISM)

    def test_resolve_reader_returns_fail_closed_default(self):
        # Until a real platform adapter is wired, resolve_reader returns a
        # fail-closed reader - no component silently reports a green read.
        with self.assertRaises(pd.UnsupportedError):
            pd.resolve_reader("web")("web")

    # -- AC4 CLI: read-deployed + check drive the same gate -----------------
    def _write_json(self, tmp, name, text):
        path = os.path.join(tmp, name)
        with open(path, "w") as handle:
            handle.write(text)
        return path

    def test_cli_check_passes_on_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = self._write_json(
                tmp, "manifest.json", json.dumps(self.valid_manifest())
            )
            deployed = self._write_json(
                tmp,
                "deployed.json",
                json.dumps(
                    {
                        "digest": "a" * 64,
                        "config_schema": self.valid_manifest()["config_schema"],
                    }
                ),
            )
            out = io.StringIO()
            err = io.StringIO()
            code = pd.main(["check", manifest, deployed], out=out, err=err)
            self.assertEqual(code, 0)
            self.assertIn("matches approved manifest", out.getvalue())

    def test_cli_check_fails_on_digest_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = self._write_json(
                tmp, "manifest.json", json.dumps(self.valid_manifest())
            )
            deployed = self._write_json(
                tmp,
                "deployed.json",
                json.dumps(
                    {
                        "digest": "f" * 64,
                        "config_schema": self.valid_manifest()["config_schema"],
                    }
                ),
            )
            out = io.StringIO()
            err = io.StringIO()
            code = pd.main(["check", manifest, deployed], out=out, err=err)
            self.assertEqual(code, 1)
            self.assertIn("deployed digest", err.getvalue())

    def test_cli_read_deployed_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            deployed = self._write_json(
                tmp,
                "deployed.json",
                json.dumps({"digest": "a" * 64, "config_schema": {"version": 1}}),
            )
            out = io.StringIO()
            err = io.StringIO()
            code = pd.main(
                ["read-deployed", "catalog", "--reader", "json", deployed],
                out=out,
                err=err,
            )
            self.assertEqual(code, 0)
            self.assertIn("digest", out.getvalue())

    def test_cli_check_normalizes_sha256_scheme(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = self._write_json(
                tmp, "manifest.json", json.dumps(self.valid_manifest())
            )
            deployed = self._write_json(
                tmp,
                "deployed.json",
                json.dumps({"digest": "sha256:" + "a" * 64}),
            )
            out = io.StringIO()
            err = io.StringIO()
            code = pd.main(["check", manifest, deployed], out=out, err=err)
            self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
