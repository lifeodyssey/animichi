/**
 * OpenAPI compatibility gate CLI (issue #1005 AC5).
 *
 * Compares a candidate OpenAPI document against a published baseline and fails
 * when the change is breaking and unapproved. Additive changes pass; a future
 * major path (e.g. `/v2/…` superseding `/v1/…`) requires the superseded
 * operation to carry explicit `deprecated: true` + `x-sunset` metadata.
 *
 * A breaking change is approved only by the committed record
 * (`approved-breaking-changes/`) naming it exactly for the document the run
 * names: the entry's method, path and kind must be the change's own, and its
 * removal must be realised in the candidate document — an `endpoint-removed`
 * path answers no method, a `method-removed` method+path is absent. An entry
 * whose operation is still advertised fails the run, so an
 * approval cannot precede the removal it names, while a landed approval stays
 * valid once its change has left the diff. The
 * `--allow-breaking` flag is the manual human override: it waives every breaking
 * change in the run, never reads the record, and is never passed by the
 * published-contract gate.
 *
 * Usage:
 *   node --import tsx scripts/vet-openapi.ts <baseline.json> <candidate.json>
 *     --document <name> [--allow-breaking]
 *
 * Exit codes: 0 = approved, 1 = violations, 2 = usage error. An approved run
 * prints each waived breaking change as `approved-breaking:` on stdout together
 * with the record entry — or the manual flag — that waived it, so approvals are
 * auditable in CI logs.
 */

import { readFileSync } from "node:fs";
import { readApprovedBreakingChanges } from "../src/approved-breaking-changes.js";
import { approvalProvenance } from "../src/openapi-approvals.js";
import type { ApiChange } from "../src/openapi-changes.js";
import { vetOpenApiDiff, type VetResult } from "../src/openapi-vet.js";
import type { ApiDocument } from "../src/operation-set.js";

const USAGE = "usage: vet-openapi <baseline.json> <candidate.json> --document <name> [--allow-breaking]\n";
const MANUAL_WAIVER = "waived by --allow-breaking";

interface CliOptions {
  readonly baselinePath: string;
  readonly candidatePath: string;
  readonly document: string;
  readonly allowBreaking: boolean;
}

interface ApprovedLine {
  readonly change: ApiChange;
  readonly note: string;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function parseArguments(argv: readonly string[]): CliOptions | null {
  const [baselinePath, candidatePath] = argv;
  const document = flagValue(argv, "--document");
  if (baselinePath === undefined || candidatePath === undefined || document === undefined) return null;
  return { baselinePath, candidatePath, document, allowBreaking: argv.includes("--allow-breaking") };
}

function readDocument(path: string): ApiDocument {
  return JSON.parse(readFileSync(path, "utf8")) as ApiDocument;
}

/** Every breaking change this run waived, with what waived it. */
function approvedLines(result: VetResult, allowBreaking: boolean): readonly string[] {
  if (!result.approved) return [];
  const lines: ApprovedLine[] = allowBreaking
    ? result.breaking.map((change) => ({ change, note: MANUAL_WAIVER }))
    : result.recorded.map(({ change, entry }) => ({ change, note: approvalProvenance(entry) }));
  return lines.map(({ change, note }) => `approved-breaking: ${change.message} (${note})`);
}

const options = parseArguments(process.argv.slice(2));
if (options === null) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const result = vetOpenApiDiff(readDocument(options.baselinePath), readDocument(options.candidatePath), {
  allowBreaking: options.allowBreaking,
  record: { document: options.document, approvals: readApprovedBreakingChanges() },
});

for (const line of approvedLines(result, options.allowBreaking)) {
  process.stdout.write(`${line}\n`);
}
for (const change of result.additive) {
  process.stdout.write(`additive: ${change.message}\n`);
}
for (const message of result.violations) {
  process.stderr.write(`rejected: ${message}\n`);
}
process.exit(result.approved ? 0 : 1);
