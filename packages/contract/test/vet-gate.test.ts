/**
 * Contract pipeline compat gate (issue #1005 AC5, enforcement).
 *
 * Two guarantees live here so the enforcement cannot silently disappear:
 *
 *  1. The vet CLI (`scripts/vet-openapi.ts`) behaves as the workflow expects:
 *     unapproved breaking changes exit 1, additive changes exit 0, and the
 *     future-major deprecation/sunset rule is enforced even for additive /
 *     approved runs.
 *
 *  2. `pipeline-contract.yml` actually invokes that CLI in the `Contract /
 *     build` stage against a merge-base baseline, and the normal gate never
 *     passes `--allow-breaking` (approved breaking changes are explicit).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiDocument } from "../src/operation-set.js";
import usersOpenApi from "../users-openapi.json";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const VET_SCRIPT = join(PACKAGE_ROOT, "scripts", "vet-openapi.ts");
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "pipeline-contract.yml");
const N_MINUS_ONE_FIXTURE = join(PACKAGE_ROOT, "test", "fixtures", "users-contract-n-1.json");
const CURRENT_USERS_DOC = join(PACKAGE_ROOT, "users-openapi.json");

interface CliResult {
  readonly status: number | null;
  readonly stderr: string;
}

function runVet(baseline: string, candidate: string, flag?: string): CliResult {
  const args = flag === undefined ? [] : [flag];
  const result = spawnSync(process.execPath, ["--import", "tsx", VET_SCRIPT, baseline, candidate, ...args], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
  }) as CliResult;
  return { status: result.status, stderr: result.stderr };
}

function writeFixture(dir: string, name: string, document: ApiDocument): string {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return path;
}

describe("vet-openapi CLI", () => {
  const baseline = usersOpenApi as ApiDocument;
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
  });

  it("approves an unchanged document (exit 0)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "vet-gate-"));
    const candidate = writeFixture(tempDir, "candidate.json", JSON.parse(JSON.stringify(baseline)) as ApiDocument);
    const result = runVet(candidate, candidate);
    expect(result.status).toBe(0);
  });

  it("rejects a request schema removal (exit 1, mutation probe)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "vet-gate-"));
    const mutated = JSON.parse(JSON.stringify(baseline)) as ApiDocument;
    const post = mutated.paths["/v1/users/saved-routes"].post;
    const requestContent = post.requestBody?.content?.["application/json"];
    expect(requestContent).toBeDefined();
    requestContent.schema = undefined;
    const baselinePath = writeFixture(tempDir, "baseline.json", baseline);
    const candidatePath = writeFixture(tempDir, "candidate.json", mutated);
    const result = runVet(baselinePath, candidatePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("request schema was removed");
  });

  it("approves an additive change without an approval flag (exit 0)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "vet-gate-"));
    const additive = JSON.parse(JSON.stringify(baseline)) as ApiDocument;
    additive.paths["/v1/users/saved-routes/export"] = {
      responses: { "200": { description: "OK" } },
    };
    const baselinePath = writeFixture(tempDir, "baseline.json", baseline);
    const candidatePath = writeFixture(tempDir, "candidate.json", additive);
    const result = runVet(baselinePath, candidatePath);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("rejected:");
  });

  it("rejects a future major path unless the superseded operation is deprecated (exit 1)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "vet-gate-"));
    const v2 = JSON.parse(JSON.stringify(baseline)) as ApiDocument;
    v2.paths["/v2/users/saved-routes"] = {
      post: { responses: { "200": { description: "OK" } } },
    };
    const baselinePath = writeFixture(tempDir, "baseline.json", baseline);
    const candidatePath = writeFixture(tempDir, "candidate.json", v2);
    const result = runVet(baselinePath, candidatePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("future major path");
  });
});

describe("vet-openapi CLI approval semantics", () => {
  const baseline = usersOpenApi as ApiDocument;
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
  });

  it("the explicit approval flag is available but never default", () => {
    tempDir = mkdtempSync(join(tmpdir(), "vet-gate-"));
    const mutated = JSON.parse(JSON.stringify(baseline)) as ApiDocument;
    const post = mutated.paths["/v1/users/saved-routes"].post;
    const requestContent = post.requestBody?.content?.["application/json"];
    expect(requestContent).toBeDefined();
    requestContent.schema = undefined;
    const baselinePath = writeFixture(tempDir, "baseline.json", baseline);
    const candidatePath = writeFixture(tempDir, "candidate.json", mutated);
    expect(runVet(baselinePath, candidatePath).status).toBe(1);
    expect(runVet(baselinePath, candidatePath, "--allow-breaking").status).toBe(0);
  });
});

describe("phantom hard-cut classification (baseline bootstrap, #1005 AC3)", () => {
  it("the CLI rejects the phantom removals against the previous artifact", () => {
    const result = runVet(N_MINUS_ONE_FIXTURE, CURRENT_USERS_DOC);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GET /v1/users/checkins was removed");
    expect(result.stderr).toContain("POST /v1/users/shares was removed");
  });

  it("the same cut passes only with the explicit approval flag", () => {
    expect(runVet(N_MINUS_ONE_FIXTURE, CURRENT_USERS_DOC).status).toBe(1);
    expect(runVet(N_MINUS_ONE_FIXTURE, CURRENT_USERS_DOC, "--allow-breaking").status).toBe(0);
  });
});

describe("pipeline-contract.yml compat gate wiring", () => {
  const workflow: string = readFileSync(WORKFLOW_PATH, "utf8") as string;
  const vetInvocationLines = workflow.split("\n").filter((line) => line.includes("vet-openapi.ts"));

  it("invokes the vet CLI in the Contract build stage", () => {
    expect(vetInvocationLines.length).toBeGreaterThan(0);
  });

  it("resolves a deterministic merge-base baseline against the PR's base branch", () => {
    expect(workflow).toContain("git merge-base HEAD");
    expect(workflow).toContain("github.event.pull_request.base.sha");
    expect(workflow).toContain("github.event.merge_group.base_sha");
  });

  it("gates every published OpenAPI document", () => {
    const invocation = vetInvocationLines.join("\n");
    for (const doc of ["openapi.json", "users-openapi.json", "agent-openapi.json"]) {
      expect(workflow).toContain(doc);
    }
    expect(invocation).toContain('"$doc"');
  });

  it("never passes the approval flag in the normal gate", () => {
    for (const line of vetInvocationLines) {
      expect(line).not.toContain("--allow-breaking");
    }
  });

  it("bootstrap lands against the committed post-cut baseline, not the phantom-laden merge-base", () => {
    expect(workflow).toContain('"/v1/users/(checkins|shares)');
    expect(workflow).toContain('git show "HEAD:packages/contract/$doc" > "$RUNNER_TEMP/baseline-$doc"');
  });
});
