/**
 * OpenAPI compatibility gate CLI (issue #1005 AC5).
 *
 * Compares a candidate OpenAPI document against a published baseline and fails
 * when the change is breaking and unapproved. Additive changes pass; a future
 * major path (e.g. `/v2/…` superseding `/v1/…`) requires the superseded
 * operation to carry explicit `deprecated: true` + `x-sunset` metadata.
 *
 * Usage:
 *   node --import tsx scripts/vet-openapi.ts <baseline.json> <candidate.json>
 *     [--allow-breaking]
 *
 * Exit codes: 0 = approved, 1 = violations, 2 = usage error.
 */

import { readFileSync } from "node:fs";
import { vetOpenApiDiff } from "../src/openapi-vet.js";
import type { ApiDocument } from "../src/operation-set.js";

const [, , baselinePath, candidatePath, flag] = process.argv;

if (baselinePath === undefined || candidatePath === undefined) {
  process.stderr.write("usage: vet-openapi <baseline.json> <candidate.json> [--allow-breaking]\n");
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as ApiDocument;
const candidate = JSON.parse(readFileSync(candidatePath, "utf8")) as ApiDocument;
const result = vetOpenApiDiff(baseline, candidate, { allowBreaking: flag === "--allow-breaking" });

for (const change of result.additive) {
  process.stdout.write(`additive: ${change.message}\n`);
}
for (const message of result.violations) {
  process.stderr.write(`rejected: ${message}\n`);
}
process.exit(result.approved ? 0 : 1);
