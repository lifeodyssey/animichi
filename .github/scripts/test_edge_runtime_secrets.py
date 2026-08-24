#!/usr/bin/env python3
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RENDER = ROOT / ".github/scripts/edge-runtime-secrets.py"
SYNC = ROOT / ".github/scripts/sync-edge-runtime-secrets.sh"
CORE = (
    "DEEPSEEK_API_KEY", "MIMO_API_KEY", "ZEN_GO_API_KEY",
    "SUPABASE_DB_URL", "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN",
)
ANON = ("TURNSTILE_SECRET", "ANON_ID_SECRET")


def secret_env() -> dict[str, str]:
    values = {name: f"secret-{index}" for index, name in enumerate(CORE + ANON)}
    return {**os.environ, **values}


class RuntimeSecretFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def config(self, staging: str = "true", production: str = "false") -> Path:
        path = self.root / "wrangler.toml"
        path.write_text(
            f'[env.staging.vars]\nANON_ACCESS_ENABLED = "{staging}"\n'
            f'[env.production.vars]\nANON_ACCESS_ENABLED = "{production}"\n'
        )
        return path


class EdgeRuntimeRenderTest(RuntimeSecretFixture):
    def run_render(self, command: str, environment: str, env: dict[str, str]):
        return subprocess.run(
            ["python3", str(RENDER), command, environment, str(self.config())],
            text=True, capture_output=True, env=env, check=False,
        )

    def test_staging_render_contains_exact_anon_allowlist(self) -> None:
        result = self.run_render("render", "staging", secret_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(json.loads(result.stdout)), set(CORE + ANON))

    def test_production_omits_anon_secrets_when_disabled(self) -> None:
        result = self.run_render("render", "production", secret_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(json.loads(result.stdout)), set(CORE))

    def test_preflight_reports_all_missing_names_without_values(self) -> None:
        env = secret_env()
        env.pop(CORE[1])
        env.pop(CORE[4])
        result = self.run_render("preflight", "staging", env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(CORE[1], result.stderr)
        self.assertIn(CORE[4], result.stderr)
        self.assertNotIn("secret-0", result.stdout + result.stderr)


class EdgeRuntimeTransportTest(RuntimeSecretFixture):
    def test_apply_sends_values_only_to_wrangler_stdin(self) -> None:
        bindir = self.root / "bin"
        bindir.mkdir()
        fake = bindir / "pnpm"
        fake.write_text('#!/bin/sh\nprintf "%s\\n" "$*" > "$ARGS_LOG"\ncat > "$STDIN_LOG"\n')
        fake.chmod(0o755)
        env = secret_env() | {
            "PATH": f"{bindir}:{os.environ['PATH']}", "GITHUB_WORKSPACE": str(ROOT),
            "ARGS_LOG": str(self.root / "args"), "STDIN_LOG": str(self.root / "stdin"),
        }
        result = subprocess.run(
            ["bash", str(SYNC), "apply", "staging", str(self.config())],
            text=True, capture_output=True, env=env, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        args = (self.root / "args").read_text()
        self.assertIn("wrangler secret bulk", args)
        output = args + result.stdout + result.stderr
        secret_values = [value for value in secret_env().values() if value.startswith("secret-")]
        self.assertFalse(any(value in output for value in secret_values))
        self.assertEqual(set(json.loads((self.root / "stdin").read_text())), set(CORE + ANON))


if __name__ == "__main__":
    unittest.main()
