import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTAINER_ENV_KEYS, CONTAINER_REQUIRED_KEYS, DENIED_EGRESS_HOSTS, buildContainerEnvVars } from "./containerEnv.ts";

// Pins RuntimeContainer.deniedHosts (#284 Task 7 — egress hostname denylist).
// See docs/ops/cloudflare-hardening.md §6 and containerEnv.ts's header comment
// for the full correction: `deniedHosts` is `string[]`, but the vendored
// `@cloudflare/containers` implementation is a plain string-prefix/suffix glob
// matcher on the URL hostname (`simpleGlobMatch`/`matchesHostList` in
// `node_modules/@cloudflare/containers/dist/lib/container.js`) — NOT a CIDR
// parser. An earlier revision of this test asserted a hand-rolled `ipInCidr()`
// helper against hand-rolled CIDR strings, which validated nothing about the
// real matcher and hid a complete no-op (the CIDR strings never matched any
// hostname). A later revision ported the algorithm by hand instead, which is
// correct but still carries drift risk: a semantic change in a future package
// version (e.g. real CIDR support finally added) could slip past a canary that
// only checks a few source-text lines.
//
// This revision removes that risk entirely: instead of a hand-written port,
// it extracts and evaluates the REAL `simpleGlobMatch`/`matchesHostList`
// functions straight out of the vendored source file at test time, so every
// assertion below runs against the actual shipped behavior, not a copy of it.
// If a future package upgrade changes the algorithm (including adding real
// CIDR parsing), these same tests keep running against the new real behavior
// and will fail loudly if `DENIED_EGRESS_HOSTS`'s glob-based entries no longer
// mean what this file assumes — there is no port to fall out of sync.

const VENDORED_CONTAINER_JS_PATH = fileURLToPath(
  new URL("../node_modules/@cloudflare/containers/dist/lib/container.js", import.meta.url),
);

function extractRealMatcher(): { matchesHostList: (hostname: string, patterns: string[]) => boolean } {
  const source = readFileSync(VENDORED_CONTAINER_JS_PATH, "utf8");
  const start = source.indexOf("function simpleGlobMatch");
  const end = source.indexOf("function normalizeHostname");
  assert.notEqual(start, -1, "vendored source no longer contains simpleGlobMatch — re-verify the port site");
  assert.notEqual(end, -1, "vendored source no longer contains normalizeHostname — re-verify the extraction bounds");
  const globHelpersSource = source.slice(start, end);
  // Deliberate: evaluating the real vendored algorithm (read from disk, not
  // untrusted network input) so the tests below run against actual shipped
  // behavior rather than a hand-written copy of it — see the file header.
  const factory = new Function(`${globHelpersSource}\nreturn { matchesHostList };`);
  return factory() as { matchesHostList: (hostname: string, patterns: string[]) => boolean };
}

const { matchesHostList } = extractRealMatcher();

void test("canary: extraction of the real vendored matcher succeeds and behaves as expected on trivial cases", () => {
  // A behavioral canary, not a source-text pin: if the vendored algorithm's
  // *semantics* change (not just its formatting), these trivial assertions —
  // exact match, glob match, non-match — must still hold, because they are
  // definitional to what "deniedHosts" means at all. If the package ever adds
  // real CIDR parsing, the literal-CIDR-string assertion below would flip
  // (a CIDR-aware matcher WOULD match "169.254.1.1" against "169.254.0.0/16"),
  // and this canary would fail loudly instead of silently staying green.
  assert.equal(matchesHostList("exact.example.com", ["exact.example.com"]), true);
  assert.equal(matchesHostList("other.example.com", ["exact.example.com"]), false);
  assert.equal(matchesHostList("169.254.1.1", ["169.254.*"]), true);
  assert.equal(
    matchesHostList("169.254.1.1", ["169.254.0.0/16"]),
    false,
    "a literal CIDR string must NOT match a bare IP under the current (non-CIDR) matcher — " +
      "if this ever flips to true, the vendored package has added real CIDR support and " +
      "DENIED_EGRESS_HOSTS's glob-based design should be revisited",
  );
});

void test("DENIED_EGRESS_HOSTS covers every spec Task 7 AC error-path address, via the real vendored matcher", () => {
  const specAddresses = ["169.254.169.254", "100.100.100.200", "10.0.0.1"];
  for (const address of specAddresses) {
    assert.equal(
      matchesHostList(address, DENIED_EGRESS_HOSTS),
      true,
      `${address} must be matched by DENIED_EGRESS_HOSTS`,
    );
  }
});

void test("DENIED_EGRESS_HOSTS matches the well-known non-IMDS metadata endpoints", () => {
  for (const address of ["192.0.0.192", "metadata.google.internal"]) {
    assert.equal(matchesHostList(address, DENIED_EGRESS_HOSTS), true, `${address} must be matched`);
  }
});

void test("DENIED_EGRESS_HOSTS does NOT match public addresses (spec Task 7 AC happy path)", () => {
  for (const address of ["1.1.1.1", "api.mimo.example.com", "8.8.8.8"]) {
    assert.equal(matchesHostList(address, DENIED_EGRESS_HOSTS), false, `${address} must not be matched`);
  }
});

void test("DENIED_EGRESS_HOSTS covers the full RFC1918 172.16/12 and CGNAT 100.64/10 octet ranges", () => {
  for (let octet = 16; octet <= 31; octet++) {
    assert.equal(matchesHostList(`172.${octet}.1.1`, DENIED_EGRESS_HOSTS), true, `172.${octet}.*`);
  }
  assert.equal(matchesHostList("172.32.1.1", DENIED_EGRESS_HOSTS), false, "172.32.0.0/12 boundary is public");
  assert.equal(matchesHostList("172.15.1.1", DENIED_EGRESS_HOSTS), false, "172.15.0.0/12 boundary is public");

  for (let octet = 64; octet <= 127; octet++) {
    assert.equal(matchesHostList(`100.${octet}.1.1`, DENIED_EGRESS_HOSTS), true, `100.${octet}.*`);
  }
  assert.equal(matchesHostList("100.63.1.1", DENIED_EGRESS_HOSTS), false, "100.64.0.0/10 lower boundary is public");
  assert.equal(matchesHostList("100.128.1.1", DENIED_EGRESS_HOSTS), false, "100.64.0.0/10 upper boundary is public");
});

// #284 Task 7, PR #478 review (third round): `url.hostname` renders IPv6 in
// bracketed, colon-compressed form — no dotted-quad glob above matches any of
// these. These are the concrete, individually-verified best-effort entries
// (see containerEnv.ts's header comment); this is NOT general IPv6 coverage —
// see limit 4 in docs/ops/cloudflare-hardening.md §6.
void test("DENIED_EGRESS_HOSTS covers the named IPv6 literal cases (best-effort, not general IPv6 coverage)", () => {
  const ipv6Cases = [
    "[::1]", // loopback
    "[fd00:ec2::254]", // AWS IMDSv2 ULA
    "[::ffff:a9fe:a9fe]", // IPv4-mapped 169.254.169.254
    "[::ffff:6464:64c8]", // IPv4-mapped 100.100.100.200
    "[::ffff:c000:c0]", // IPv4-mapped 192.0.0.192
    "[fe80::1]", // IPv6 link-local, arbitrary suffix
    "[fd00:aaaa:bbbb::1]", // IPv6 ULA under the fd00:: convention prefix, arbitrary suffix
  ];
  for (const hostname of ipv6Cases) {
    assert.equal(matchesHostList(hostname, DENIED_EGRESS_HOSTS), true, `${hostname} must be matched`);
  }
});

void test("DENIED_EGRESS_HOSTS does NOT match an unrelated public IPv6 literal", () => {
  assert.equal(matchesHostList("[2606:4700:4700::1111]", DENIED_EGRESS_HOSTS), false);
});

// #284 Task 7, PR #478 review: prefix globs over-match subdomains by design —
// fail-closed, documented, not a bug.
void test("DENIED_EGRESS_HOSTS deliberately over-matches subdomains of denied prefixes (fail-closed)", () => {
  assert.equal(matchesHostList("10.0.0.1.evil.com", DENIED_EGRESS_HOSTS), true);
});

// Mutation guard: emptying the list must fail the coverage test above, so the
// denylist cannot silently regress to a no-op again.
void test("mutation guard: an empty denylist fails to match the AC error-path addresses", () => {
  assert.equal(matchesHostList("169.254.169.254", []), false);
});

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

void test("buildContainerEnvVars forwards the provided APP_ENV value unchanged", () => {
  for (const appEnv of ["development", "staging", "production"]) {
    const envVars = buildContainerEnvVars({ ...requiredContainerEnv(), APP_ENV: appEnv });
    assert.equal(envVars.APP_ENV, appEnv);
  }
});

void test("buildContainerEnvVars throws (fail-closed) when APP_ENV is missing, instead of seeding a hardcoded default", () => {
  const { APP_ENV: _unused, ...envWithoutAppEnv } = requiredContainerEnv();
  void _unused;
  assert.throws(() => buildContainerEnvVars(envWithoutAppEnv), /Missing required container env: APP_ENV/);
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
const WRANGLER_TOML_PATH = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
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
  // Anchored to a line START, not a bare substring search: the file's own
  // prose comments reference bracketed section names like "([vars] below)"
  // inline, which a plain .indexOf(header) would match first and produce a
  // bogus (wrong) block slice.
  const headerLineRegex = new RegExp(`^${escapeRegExp(header)}$`, "m");
  const headerMatch = headerLineRegex.exec(wranglerToml);
  assert.notEqual(headerMatch, null, `wrangler.toml must contain a "${header}" section header line`);
  const headerIndex = (headerMatch as RegExpExecArray).index;
  const nextHeaderIndex = wranglerToml.indexOf("\n[", headerIndex + header.length);
  const block = wranglerToml.slice(headerIndex, nextHeaderIndex === -1 ? undefined : nextHeaderIndex);
  const match = /^APP_ENV\s*=\s*"([^"]+)"/m.exec(block);
  assert.notEqual(match, null, `"${header}" must set APP_ENV`);
  return (match as RegExpExecArray)[1];
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
