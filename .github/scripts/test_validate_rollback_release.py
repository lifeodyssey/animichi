"""Behavior tests for the trusted rollback release validator."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / ".github/scripts/validate-rollback-release.py"
SOURCE = "a" * 40
DIGEST = hashlib.sha256(b"sealed").hexdigest()


class RollbackReleaseValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.write_inputs()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_inputs(self) -> None:
        run = {
            "id": 42,
            "event": "push",
            "status": "completed",
            "conclusion": "success",
            "head_branch": "main",
            "head_sha": SOURCE,
            "path": ".github/workflows/cd.yml",
            "repository": {"full_name": "lifeodyssey/animichi"},
        }
        artifact = {
            "name": f"release-{SOURCE}-web",
            "expired": False,
            "size_in_bytes": 100,
        }
        manifest = {
            "schema_version": 1,
            "unit": "web",
            "source_sha": SOURCE,
            "artifact_sha256": DIGEST,
        }
        (self.root / "run.json").write_text(json.dumps(run))
        (self.root / "artifacts.json").write_text(json.dumps({"artifacts": [artifact]}))
        (self.root / "manifest.json").write_text(json.dumps(manifest))

    def validate(self, *extra: str) -> subprocess.CompletedProcess[str]:
        args = [
            sys.executable,
            str(VALIDATOR),
            "--run",
            str(self.root / "run.json"),
            "--artifacts",
            str(self.root / "artifacts.json"),
            "--manifest",
            str(self.root / "manifest.json"),
            "--repository",
            "lifeodyssey/animichi",
            "--run-id",
            "42",
            "--unit",
            "web",
            "--source-sha",
            SOURCE,
            "--artifact-sha256",
            DIGEST,
            *extra,
        ]
        return subprocess.run(args, text=True, capture_output=True, check=False)

    def mutate(self, file: str, key: str, value: object) -> None:
        path = self.root / file
        document = json.loads(path.read_text())
        document[key] = value
        path.write_text(json.dumps(document))

    def test_accepts_an_explicit_successful_main_cd_artifact(self) -> None:
        result = self.validate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"web@{SOURCE}", result.stdout)

    def test_rejects_untrusted_or_failed_workflow_runs(self) -> None:
        for key, value in (
            ("event", "workflow_dispatch"),
            ("conclusion", "failure"),
            ("head_branch", "feature"),
            ("path", ".github/workflows/other.yml"),
        ):
            with self.subTest(key=key):
                self.write_inputs()
                self.mutate("run.json", key, value)
                self.assertNotEqual(self.validate().returncode, 0)

    def test_rejects_expired_or_missing_release_artifacts(self) -> None:
        artifacts = self.root / "artifacts.json"
        for payload in (
            {"artifacts": []},
            {
                "artifacts": [
                    {
                        "name": f"release-{SOURCE}-web",
                        "expired": True,
                        "size_in_bytes": 100,
                    }
                ]
            },
        ):
            with self.subTest(payload=payload):
                artifacts.write_text(json.dumps(payload))
                result = self.validate()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("artifact", result.stderr)

    def test_rejects_every_identity_mismatch(self) -> None:
        for extra in (
            ("--run-id", "43"),
            ("--source-sha", "b" * 40),
            ("--artifact-sha256", "c" * 64),
            ("--unit", "edge"),
        ):
            with self.subTest(extra=extra):
                self.assertNotEqual(self.validate(*extra).returncode, 0)


if __name__ == "__main__":
    unittest.main()
