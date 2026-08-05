import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CONTAINER_ENV_KEYS, CONTAINER_REQUIRED_KEYS, buildContainerEnvVars } from "./container-env.ts";

// Issue #498: APP_ENV used to be seeded with a hardcoded "production" default
// in buildContainerEnvVars, so every container reported APP_ENV=production
// regardless of the actual Cloudflare environment — staging traces were
// indistinguishable from production traces in Logfire. The fix moved APP_ENV
// into CONTAINER_REQUIRED_KEYS (fail-closed: missing it throws rather than
// silently defaulting to the most privileged environment) while keeping it
// listed in CONTAINER_ENV_KEYS too, matching the standard forwarding-allowlist
// shape (compare ANON_DAILY_COST_BUDGET_USD).

function requiredContainerEnv(): Record<string, string> {
  return { DEEPSEEK_API_KEY: "k", MIMO_API_KEY: "k", SUPABASE_DB_URL: "postgres://x", APP_ENV: "development" };
}

void test("APP_ENV is listed in CONTAINER_ENV_KEYS (standard forwarding allowlist shape)", () => {
  assert.equal(CONTAINER_ENV_KEYS.includes("APP_ENV"), true);
});

void test("APP_ENV is listed in CONTAINER_REQUIRED_KEYS (fail-closed, issue #498)", () => {
  assert.equal(CONTAINER_REQUIRED_KEYS.includes("APP_ENV"), true);
});

// #656 retired the standalone Gemini vision provider (photo-search now rides
// the main agent's multimodal input, apps/agent/src/animichi/agents/photo_vision.py)
// and removed GEMINI_API_KEY from every config surface it touched. A guard
// pins the removal itself, not just the code that stopped reading it — this
// repo has hit "the guard doesn't run / doesn't exist" four times in one week
// (see docs/ops/secrets.md's "Referenced by nothing" section for the pattern).
void test("GEMINI_API_KEY stays out of the container forwarding allowlist (#656)", () => {
  assert.equal(CONTAINER_ENV_KEYS.includes("GEMINI_API_KEY"), false);
});

void test("buildContainerEnvVars forwards the provided APP_ENV value unchanged", () => {
  for (const appEnv of ["development", "staging", "production"]) {
    const environmentVars = buildContainerEnvVars({ ...requiredContainerEnv(), APP_ENV: appEnv });
    assert.equal(environmentVars.APP_ENV, appEnv);
  }
});

void test("buildContainerEnvVars throws (fail-closed) when APP_ENV is missing, instead of seeding a hardcoded default", () => {
  const { APP_ENV: _unused, ...environmentWithoutAppEnv } = requiredContainerEnv();
  void _unused;
  assert.throws(() => buildContainerEnvVars(environmentWithoutAppEnv), /Missing required container env: APP_ENV/);
});

void test("buildContainerEnvVars throws when APP_ENV is an empty string, not just when absent", () => {
  assert.throws(
    () => buildContainerEnvVars({ ...requiredContainerEnv(), APP_ENV: "" }),
    /Missing required container env: APP_ENV/,
  );
});

// Mutation guard: no hardcoded "production" seed survives — buildContainerEnvVars
// must never invent a value for a key it wasn't given.
void test("mutation guard: buildContainerEnvVars never seeds APP_ENV on its own", () => {
  assert.throws(() => buildContainerEnvVars({ DEEPSEEK_API_KEY: "k", MIMO_API_KEY: "k", SUPABASE_DB_URL: "postgres://x" }));
});

// wrangler.toml three-touchpoint check (feedback_env_var_three_touchpoints):
// each of the three environment blocks must set its own APP_ENV value, and
// they must not all collapse to the same (formerly hardcoded) "production".
const WRANGLER_TOML_PATH = fileURLToPath(new URL("../../wrangler.toml", import.meta.url));
const wranglerToml = readFileSync(WRANGLER_TOML_PATH, "utf8");

// Full regex-metacharacter escape (CodeQL js/incomplete-sanitization: the
// prior version only escaped `.`/`[`/`]` and, critically, never escaped a
// literal backslash — a real gap in general, even though every caller here
// passes a hardcoded literal with no backslash in it). Escapes the backslash
// itself first, then every other regex metacharacter, each globally.
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appEnvInBlock(header: string): string {
  const block = sectionBlock(header);
  const match = /^APP_ENV\s*=\s*"([^"]+)"/m.exec(block);
  assert.notEqual(match, null, `"${header}" must set APP_ENV`);
  return match[1];
}

function sectionBlock(header: string): string {
  // Anchored to a line START: prose comments reference "([vars] below)"
  // inline, which a bare .indexOf(header) would match first.
  const headerLineRegex = new RegExp(`^${escapeRegExp(header)}$`, "m");
  const headerMatch = headerLineRegex.exec(wranglerToml);
  assert.notEqual(headerMatch, null, `wrangler.toml must contain a "${header}" section header line`);
  const headerIndex = headerMatch.index;
  const nextHeaderIndex = wranglerToml.indexOf("\n[", headerIndex + header.length);
  return wranglerToml.slice(headerIndex, nextHeaderIndex === -1 ? undefined : nextHeaderIndex);
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
