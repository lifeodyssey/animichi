/**
 * The published-contract compat gate (issue #1005 AC5), as a package script.
 *
 * It used to live in `.github/scripts/pr-verification-gate.sh` — a CI-only
 * file — so the only way to run the gate that decides whether a contract
 * change is breaking was to open a pull request. It belongs to the package it
 * gates: `pnpm --filter @animichi/contract test` runs it, and CI runs the same
 * script (#1358).
 *
 * The baseline is the MERGE BASE's copy of each published document, and three
 * facts have to stay apart because only the first is safe to approve: the
 * merge base HAS NO such document (brand new — every operation in it is
 * additive, so an empty baseline approves it without weakening the gate); it
 * has one and it reads (the real baseline); or the repository CANNOT ANSWER —
 * a missing tree or blob, a shallow clone, a corrupt object — where an empty
 * baseline would approve a deletion nobody reviewed.
 *
 * `git ls-tree` is what separates the first two from the third, and it is the
 * only check that does: it walks trees and never reads the blob, so it exits 0
 * with empty output for a path the merge base does not carry, exits 0 listing
 * the entry when the walk reaches it, and fails outright when any tree on the
 * way is unreadable. `git cat-file -e <merge-base>:<path>` cannot be used: it
 * also fails when the blob alone is missing, which would read as "absent".
 *
 * The approval flag is never passed here — an approved breaking change is an
 * explicit `pnpm run vet:openapi … --allow-breaking` a human runs and argues.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const VET_SCRIPT = join(PACKAGE_ROOT, "scripts", "vet-openapi.ts");
const DOCUMENTS = ["openapi.json", "users-openapi.json", "agent-openapi.json"];
const BASE_REF = process.env.CONTRACT_BASE_REF ?? "origin/main";
const EMPTY_BASELINE = '{\n  "paths": {}\n}\n';

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

/** The commit the candidate documents are judged against. */
function mergeBase(): string {
  const resolved = git("merge-base", "HEAD", BASE_REF).trim();
  if (resolved === "") throw new Error(`no merge base between HEAD and ${BASE_REF}`);
  return resolved;
}

function baselineDocument(base: string, document: string): string {
  const listed = git("ls-tree", base, "--", `packages/contract/${document}`);
  if (listed.trim() === "") return EMPTY_BASELINE;
  return git("show", `${base}:packages/contract/${document}`);
}

function writeBaseline(directory: string, base: string, document: string): string {
  const path = join(directory, document);
  writeFileSync(path, baselineDocument(base, document), "utf8");
  return path;
}

function vetDocument(baseline: string, document: string): boolean {
  const candidate = join(PACKAGE_ROOT, document);
  const args = ["--import", "tsx", VET_SCRIPT, baseline, candidate];
  return spawnSync(process.execPath, args, { cwd: PACKAGE_ROOT, stdio: "inherit" }).status === 0;
}

function vetEveryDocument(directory: string, base: string): boolean {
  return DOCUMENTS.map((document) =>
    vetDocument(writeBaseline(directory, base, document), document),
  ).every(Boolean);
}

function run(): boolean {
  const directory = mkdtempSync(join(tmpdir(), "contract-baseline-"));
  try {
    return vetEveryDocument(directory, mergeBase());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function fail(error: unknown): never {
  process.stderr.write(`vet-openapi-baseline: ${String(error)}\n`);
  process.exit(1);
}

try {
  process.exit(run() ? 0 : 1);
} catch (error) {
  fail(error);
}
