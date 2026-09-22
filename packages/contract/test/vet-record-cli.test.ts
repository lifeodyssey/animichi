/**
 * The vet CLI's document scope and its approval record (#1596).
 *
 * The published-contract gate runs this CLI once per published document, and
 * the committed record only speaks for the document a run names: an entry
 * approves its change there and nowhere else. These cases drive the CLI the way
 * the gate does and pin the fail-closed directions — an unnamed document is a
 * usage error, a removal no entry names is rejected, a change whose kind
 * differs from the entry's is rejected too, and a landing approval stays valid
 * once its removal has left the diff while an entry whose operation is still
 * advertised is rejected.
 *
 * test-type: integration.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiDocument, WireOperation } from "../src/operation-set.js";
import agentOpenApi from "../agent-openapi.json";
import {
  AGENT_DOCUMENT,
  ROOT_ADVERTISED,
  ROOT_AS_POST,
  ROOT_RETIRED,
  USERS_DOCUMENT,
  WITH_NEW_ROUTE,
} from "./openapi-approvals-builders.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VET_SCRIPT = join(PACKAGE_ROOT, "scripts", "vet-openapi.ts");

const OK: WireOperation = { responses: { "200": { description: "OK" } } };
const LANDED_AGENT = agentOpenApi as ApiDocument;
/** The committed agent document with the retired root advertised again. */
const ROOT_RESTORED: ApiDocument = { paths: { ...LANDED_AGENT.paths, "/": { get: OK } } };

interface CliResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function writeDocument(directory: string, name: string, document: ApiDocument): string {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return path;
}

function runVet(baseline: string, candidate: string, flags: readonly string[]): CliResult {
  const args = ["--import", "tsx", VET_SCRIPT, baseline, candidate, ...flags];
  return spawnSync(process.execPath, args, { cwd: PACKAGE_ROOT, encoding: "utf8" });
}

function writeBaselineAndCandidate(
  directory: string, baseline: ApiDocument, candidate: ApiDocument,
): { baseline: string; candidate: string } {
  return {
    baseline: writeDocument(directory, "baseline.json", baseline),
    candidate: writeDocument(directory, "candidate.json", candidate),
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "vet-record-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("the vet CLI reads the record of the document it vets", () => {
  it("refuses a run that does not name the document (exit 2)", () => {
    const paths = writeBaselineAndCandidate(tempDir, ROOT_ADVERTISED, ROOT_RETIRED);
    const result = runVet(paths.baseline, paths.candidate, []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });

  it("approves an additive change (exit 0)", () => {
    const paths = writeBaselineAndCandidate(tempDir, ROOT_RETIRED, WITH_NEW_ROUTE);
    const result = runVet(paths.baseline, paths.candidate, ["--document", USERS_DOCUMENT]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("additive: GET /v1/added was added");
  });

  it("rejects a removal no entry names (exit 1)", () => {
    const paths = writeBaselineAndCandidate(tempDir, ROOT_ADVERTISED, ROOT_RETIRED);
    const result = runVet(paths.baseline, paths.candidate, ["--document", USERS_DOCUMENT]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("rejected: GET / was removed");
  });

  it("does not apply another document's approvals", () => {
    const paths = writeBaselineAndCandidate(tempDir, ROOT_ADVERTISED, ROOT_RETIRED);
    const result = runVet(paths.baseline, paths.candidate, ["--document", USERS_DOCUMENT]);
    expect(result.stdout).not.toContain("approved-breaking:");
  });
});

describe("the vet CLI's recorded approvals land only once realised", () => {
  it("approves a landed removal whose entry is still in the record (exit 0)", () => {
    const paths = writeBaselineAndCandidate(tempDir, LANDED_AGENT, LANDED_AGENT);
    const result = runVet(paths.baseline, paths.candidate, ["--document", AGENT_DOCUMENT]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("rejected:");
  });

  it("rejects an entry whose operation is still advertised (exit 1)", () => {
    const paths = writeBaselineAndCandidate(tempDir, LANDED_AGENT, ROOT_RESTORED);
    const result = runVet(paths.baseline, paths.candidate, ["--document", AGENT_DOCUMENT]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unrealised approval");
  });

  it("rejects a change whose kind differs from the entry's", () => {
    const paths = writeBaselineAndCandidate(tempDir, ROOT_ADVERTISED, ROOT_AS_POST);
    const result = runVet(paths.baseline, paths.candidate, ["--document", AGENT_DOCUMENT]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("rejected: GET / was removed");
  });
});
