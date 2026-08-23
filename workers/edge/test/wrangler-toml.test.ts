import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// Pins the repository's wrangler.toml env blocks — the config surface the
// edge worker actually deploys from. Two contracts live here:
//
// 1. APP_ENV three-touchpoint check (feedback_env_var_three_touchpoints):
//    each of the three environment blocks must set its own APP_ENV value,
//    and they must not all collapse to the same (formerly hardcoded)
//    "production" (issue #498).
//
// 2. S0-v2 GOAL C / C9 nail test: the showcase gate's deployed VALUES are
//    pinned per environment. production MUST be "true" (the landing-only
//    contract), staging and the root/dev [vars] MUST be "false" (full
//    functionality). The deployment chain (reusable-post-deploy-test.yml)
//    parses this same file, so a drift here also changes what the post-deploy
//    smoke asserts.
//
// test-type: unit (all cases parse a checked-in file; no network, no clock).

const WRANGLER_TOML_PATH = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
const wranglerToml = readFileSync(WRANGLER_TOML_PATH, "utf8");
const observableWorkerConfigs = [
  ["edge", "../wrangler.toml"],
  ["catalog", "../../catalog/wrangler.toml"],
  ["users", "../../users/wrangler.toml"],
  ["jobs", "../../jobs/wrangler.toml"],
  ["migrator", "../../migrator/wrangler.toml"],
  ["doorbell", "../../doorbell/wrangler.toml"],
] as const;

// Full regex-metacharacter escape (CodeQL js/incomplete-sanitization: the
// prior version only escaped `.`/`[`/`]` and, critically, never escaped a
// literal backslash — a real gap in general, even though every caller here
// passes a hardcoded literal with no backslash in it). Escapes the backslash
// itself first, then every other regex metacharacter, each globally.
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The wrangler.toml section that starts at the `header` line, ending at the
 * next section header. Anchored to a line START, not a bare substring search:
 * the file's own prose comments reference bracketed section names like
 * "([vars] below)" inline, which a plain .indexOf(header) would match first
 * and produce a bogus (wrong) block slice. */
function blockForHeader(header: string, source: string = wranglerToml): string {
  const headerLineRegex = new RegExp(`^${escapeRegExp(header)}$`, "m");
  const headerMatch = headerLineRegex.exec(source);
  assert.ok(headerMatch, `wrangler.toml must contain a "${header}" section header line`);
  const headerIndex = headerMatch.index;
  const nextHeaderIndex = source.indexOf("\n[", headerIndex + header.length);
  return source.slice(headerIndex, nextHeaderIndex === -1 ? undefined : nextHeaderIndex);
}

function valueInBlock(header: string, key: string): string {
  const block = blockForHeader(header);
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, "m").exec(block);
  assert.ok(match, `"${header}" must set ${key}`);
  const value = match[1];
  assert.ok(value, `"${header}" must set ${key}`);
  return value;
}

function appEnvInBlock(header: string): string {
  return valueInBlock(header, "APP_ENV");
}

function booleanInBlock(header: string, key: string, source: string): boolean {
  const block = blockForHeader(header, source);
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(true|false)`, "m").exec(block);
  assert.ok(match, `"${header}" must set ${key}`);
  return match[1] === "true";
}

function numberInBlock(header: string, key: string, source: string): number {
  const block = blockForHeader(header, source);
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(\\d+(?:\\.\\d+)?)`, "m").exec(block);
  assert.ok(match, `"${header}" must set ${key}`);
  return Number(match[1]);
}

function assertRootObservability(source: string): void {
  assert.equal(booleanInBlock("[observability]", "enabled", source), true);
  assert.equal(numberInBlock("[observability]", "head_sampling_rate", source), 1);
}

function assertLogObservability(source: string): void {
  assert.equal(booleanInBlock("[observability.logs]", "enabled", source), true);
  assert.equal(numberInBlock("[observability.logs]", "head_sampling_rate", source), 1);
  assert.equal(booleanInBlock("[observability.logs]", "persist", source), true);
  assert.equal(booleanInBlock("[observability.logs]", "invocation_logs", source), true);
}

function assertTraceObservability(source: string): void {
  assert.equal(booleanInBlock("[observability.traces]", "enabled", source), true);
  assert.equal(numberInBlock("[observability.traces]", "head_sampling_rate", source), 1);
  assert.equal(booleanInBlock("[observability.traces]", "persist", source), true);
}

function assertObservability(source: string): void {
  assertRootObservability(source);
  assertLogObservability(source);
  assertTraceObservability(source);
}

for (const [worker, relativePath] of observableWorkerConfigs) {
  void test(`${worker} persists Cloudflare logs and traces`, () => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
    assertObservability(source);
  });
}

void test("wrangler.toml [vars] (default, wrangler dev) sets APP_ENV to development", () => {
  assert.equal(appEnvInBlock("[vars]"), "development");
});

void test("wrangler.toml [env.production.vars] sets APP_ENV to production", () => {
  assert.equal(appEnvInBlock("[env.production.vars]"), "production");
});

void test("wrangler.toml [env.staging.vars] sets APP_ENV to staging (the whole point of issue #498)", () => {
  assert.equal(appEnvInBlock("[env.staging.vars]"), "staging");
});

void test("wrangler.toml EDGE_SHOWCASE_MODE is true in production and false in staging/dev", () => {
  assert.equal(valueInBlock("[env.production.vars]", "EDGE_SHOWCASE_MODE"), "true");
  assert.equal(valueInBlock("[env.staging.vars]", "EDGE_SHOWCASE_MODE"), "false");
  assert.equal(valueInBlock("[vars]", "EDGE_SHOWCASE_MODE"), "false");
});

void test("staging falls back from zen/go to the direct MiMo endpoint", () => {
  assert.equal(
    valueInBlock("[env.staging.vars]", "FALLBACK_AGENT_MODEL"),
    "openai:mimo-v2.5@https://api.xiaomimimo.com/v1",
  );
});

void test("escapeRegExp escapes a literal backslash, not just the bracket/dot metacharacters (CodeQL js/incomplete-sanitization)", () => {
  // A prior version only escaped `.`/`[`/`]` and never the backslash itself.
  // Concretely: the 4-character literal x\bx (x, backslash, b, x) — under the
  // old escaper the backslash passed through untouched, so "\b" survived
  // into the regex source and was reinterpreted as the \b word-boundary
  // metacharacter instead of a literal backslash followed by "b". The
  // resulting (broken) regex didn't even match its own source literal.
  // None of this file's real callers pass a backslash today, but the escaper
  // itself must be correct on its own terms.
  const literalWithBackslash = "x\\bx";
  const escaped = escapeRegExp(literalWithBackslash);
  const regex = new RegExp(`^${escaped}$`);
  assert.equal(regex.test(literalWithBackslash), true);
  assert.equal(regex.test("xx"), false);
});

void test("wrangler.toml's three APP_ENV values are pairwise distinct, not all defaulted to one value", () => {
  const values = new Set([
    appEnvInBlock("[vars]"),
    appEnvInBlock("[env.production.vars]"),
    appEnvInBlock("[env.staging.vars]"),
  ]);
  assert.equal(values.size, 3, "development/production/staging must each be distinct");
});
