#!/usr/bin/env python3

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify-release-artifact.py")
SHA = "a" * 40


class VerifyReleaseArtifactTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.payload = self.root / "artifact.tar.gz"
        self.payload.write_bytes(b"sealed payload")
        digest = hashlib.sha256(self.payload.read_bytes()).hexdigest()
        self.manifest = self.root / "artifact-manifest.json"
        self.manifest.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "unit": "web",
                    "source_sha": SHA,
                    "artifact_sha256": digest,
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def verify(self, unit: str = "web") -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(self.root), unit, SHA],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_accepts_the_exact_unit_source_and_payload_digest(self) -> None:
        self.assertEqual(self.verify().returncode, 0)

    def test_rejects_a_changed_payload(self) -> None:
        self.payload.write_bytes(b"rebuilt payload")
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("digest mismatch", result.stderr)

    def test_rejects_cross_unit_promotion(self) -> None:
        result = self.verify("users")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unit mismatch", result.stderr)


if __name__ == "__main__":
    unittest.main()
