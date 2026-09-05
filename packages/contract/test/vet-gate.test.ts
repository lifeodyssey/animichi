/**
 * Contract pipeline compat gate (issue #1005 AC5, enforcement).
 *
 * Two guarantees live here so the enforcement cannot silently disappear:
 *
 *  1. The vet CLI (`scripts/vet-openapi.ts`) behaves as the gate expects:
 *     unapproved breaking changes exit 1, additive changes exit 0, and the
 *     future-major deprecation/sunset rule holds even for additive runs.
 *
 *  2. The package's own `test` script invokes that CLI against an explicit
 *     merge-base baseline (`scripts/vet-openapi-baseline.ts`, #1358 — the gate
 *     used to live in a CI-only shell script, so only a pull request could run
 *     it), and never passes `--allow-breaking`.
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
const VET_SCRIPT = join(PACKAGE_ROOT, "scripts", "vet-openapi.ts");
const MANIFEST_PATH = join(PACKAGE_ROOT, "package.json");
const BASELINE_GATE = join(PACKAGE_ROOT, "scripts", "vet-openapi-baseline.ts");
const N_MINUS_ONE_FIXTURE = join(PACKAGE_ROOT, "test", "fixtures", "users-contract-n-1.json");
const CURRENT_USERS_DOC = join(PACKAGE_ROOT, "users-openapi.json");

interface CliResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function runVet(baseline: string, candidate: string, flag?: string): CliResult {
  const args = flag === undefined ? [] : [flag];
  const result = spawnSync(process.execPath, ["--import", "tsx", VET_SCRIPT, baseline, candidate, ...args], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
  }) as CliResult;
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function runBaselineGate(baseRef: string): CliResult {
  return spawnSync(process.execPath, ["--import", "tsx", BASELINE_GATE], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: { ...process.env, CONTRACT_BASE_REF: baseRef },
  }) as CliResult;
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
      get: { responses: { "200": { description: "OK" } } },
    };
    const baselinePath = writeFixture(tempDir, "baseline.json", baseline);
    const candidatePath = writeFixture(tempDir, "candidate.json", additive);
    const result = runVet(baselinePath, candidatePath);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("rejected:");
    expect(result.stdout).toContain("/v1/users/saved-routes/export");
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
  it("rejects the phantom removals, and passes only with the approval flag", () => {
    const result = runVet(N_MINUS_ONE_FIXTURE, CURRENT_USERS_DOC);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GET /v1/users/checkins was removed");
    expect(result.stderr).toContain("POST /v1/users/shares was removed");
    expect(runVet(N_MINUS_ONE_FIXTURE, CURRENT_USERS_DOC, "--allow-breaking").status).toBe(0);
  });

  it("the explicit approval prints each waived breaking change as approved-breaking", () => {
    const result = runVet(N_MINUS_ONE_FIXTURE, CURRENT_USERS_DOC, "--allow-breaking");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("approved-breaking: GET /v1/users/checkins was removed");
    expect(result.stdout).toContain("approved-breaking: POST /v1/users/shares was removed");
  });
});

describe("the compat gate is the contract package's own test script", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { scripts: Record<string, string> };
  const gate: string = readFileSync(BASELINE_GATE, "utf8");

  it("runs the merge-base gate from `pnpm --filter @animichi/contract test`", () => {
    expect(manifest.scripts.test).toContain("pnpm run vet:baseline");
    expect(manifest.scripts["vet:baseline"]).toContain("scripts/vet-openapi-baseline.ts");
  });

  it("invokes the vet CLI rather than a second copy of its decisions", () => {
    expect(gate).toContain('join(PACKAGE_ROOT, "scripts", "vet-openapi.ts")');
    expect(gate).toContain('const args = ["--import", "tsx", VET_SCRIPT, baseline, candidate];');
  });

  it("gates all three documents and never passes the approval flag", () => {
    expect(gate).toContain('["openapi.json", "users-openapi.json", "agent-openapi.json"]');
    const invocations = gate.split("\n").filter((line) => line.includes("VET_SCRIPT"));
    expect(invocations.length).toBeGreaterThan(0);
    for (const line of invocations) expect(line).not.toContain("--allow-breaking");
  });

  it("takes the baseline from the merge base's own copy, never from a source head", () => {
    expect(gate).toContain('git("merge-base", "HEAD", BASE_REF)');
    expect(gate).toContain('process.env.CONTRACT_BASE_REF ?? "origin/main"');
    expect(gate).toContain("git(\"show\", `${base}:packages/contract/${document}`)");
  });

  it("treats a document absent at the merge base as empty, an unreadable tree as fatal", () => {
    expect(gate).toContain('git("ls-tree", base, "--", `packages/contract/${document}`)');
    expect(gate).toContain(String.raw`const EMPTY_BASELINE = '{\n  "paths": {}\n}\n';`);
    for (const call of gate.split("\n").filter((line) => line.includes("git(")))
      expect(call).not.toContain("cat-file");
  });

  it("approves the committed documents, and fails closed on an unresolvable base", () => {
    const approved = runBaselineGate("HEAD");
    expect(approved.stderr).not.toContain("rejected:");
    expect(approved.status).toBe(0);
    const missingBase = runBaselineGate("refs/heads/no-such-base");
    expect(missingBase.status).toBe(1);
    expect(missingBase.stderr).toContain("vet-openapi-baseline:");
  });
});
