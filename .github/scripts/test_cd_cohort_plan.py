#!/usr/bin/env python3
"""Behavior contract for the main-branch affected deployment cohort."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ROUTER = ROOT / ".github/scripts/cd-cohort-plan.py"


class CohortPlanTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.manifest = Path(self.temp.name) / "components.json"
        self.manifest.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "unknown_changes": "all",
                    "components": [
                        {"name": "db", "deploy_unit": "db"},
                        {"name": "catalog", "deploy_unit": "catalog"},
                        {"name": "users", "deploy_unit": "users"},
                        {"name": "agent", "deploy_unit": "agent"},
                        {"name": "edge", "deploy_unit": "edge"},
                        {"name": "web", "deploy_unit": "web"},
                        {"name": "infra", "deploy_unit": "infra"},
                        {"name": "migrator", "deploy_unit": "migrator"},
                        {"name": "contract", "deploy_unit": None},
                    ],
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def plan(self, components: list[str], *, fallback_all: bool = False) -> dict:
        change_plan = {
            "components": components,
            "direct_components": components,
            "changed_paths": ["fixture"],
            "fallback_all": fallback_all,
        }
        result = subprocess.run(
            [sys.executable, str(ROUTER), "--manifest", str(self.manifest)],
            input=json.dumps(change_plan),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_routes_only_affected_deploy_units_into_ordered_phases(self) -> None:
        plan = self.plan(["catalog", "edge", "web"])
        self.assertEqual(plan["deploy_units"], ["agent", "catalog", "edge", "web"])
        self.assertEqual(plan["foundation"], [])
        self.assertEqual(plan["migration"], [])
        self.assertEqual(plan["services"], ["agent", "catalog"])
        self.assertEqual(plan["edge"], ["edge"])
        self.assertEqual(plan["web"], ["web"])

    def test_container_and_worker_are_one_release_unit_pair(self) -> None:
        for changed in (["agent"], ["edge"]):
            with self.subTest(changed=changed):
                plan = self.plan(changed)
                self.assertIn("agent", plan["deploy_units"])
                self.assertIn("edge", plan["deploy_units"])

    def test_migrator_and_sealed_chain_are_promoted_sequentially(self) -> None:
        for changed in (["migrator"], ["db"]):
            with self.subTest(changed=changed):
                self.assertEqual(self.plan(changed)["migration"], ["migrator", "db"])

    def test_non_deployable_component_creates_no_heavy_work(self) -> None:
        plan = self.plan(["contract"])
        self.assertFalse(plan["has_deployments"])
        self.assertEqual(plan["deploy_units"], [])

    def test_fallback_all_selects_every_deployable_unit(self) -> None:
        plan = self.plan(["contract"], fallback_all=True)
        self.assertTrue(plan["fallback_all"])
        self.assertEqual(
            set(plan["deploy_units"]),
            {"agent", "catalog", "db", "edge", "infra", "migrator", "users", "web"},
        )
        self.assertEqual(
            plan["production_units"],
            ["infra", "db", "agent", "catalog", "users", "edge", "web"],
        )

    def test_unknown_component_fails_closed_to_full_deploy(self) -> None:
        plan = self.plan(["new-shared-package"])
        self.assertTrue(plan["fallback_all"])
        self.assertIn("new-shared-package", plan["fallback_reasons"])
        self.assertEqual(len(plan["deploy_units"]), 8)

    def test_unknown_deploy_unit_is_rejected_instead_of_guessing_a_phase(self) -> None:
        raw = json.loads(self.manifest.read_text(encoding="utf-8"))
        raw["components"].append({"name": "queue", "deploy_unit": "queue"})
        self.manifest.write_text(json.dumps(raw), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(ROUTER), "--manifest", str(self.manifest)],
            input=json.dumps({"components": ["queue"], "fallback_all": False}),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unknown deploy_unit", result.stderr)


if __name__ == "__main__":
    unittest.main()
