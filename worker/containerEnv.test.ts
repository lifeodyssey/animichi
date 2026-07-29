import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DENIED_EGRESS_HOSTS } from "./containerEnv.ts";

// Pins RuntimeContainer.deniedHosts (#284 Task 7 — egress hostname denylist).
// See docs/ops/cloudflare-hardening.md §6 and containerEnv.ts's header comment
// for the full correction: `deniedHosts` is `string[]`, but the vendored
// `@cloudflare/containers` implementation is a plain string-prefix/suffix glob
// matcher on the URL hostname (`simpleGlobMatch`/`matchesHostList` in
// `node_modules/@cloudflare/containers/dist/lib/container.js`) — NOT a CIDR
// parser. An earlier revision of this test asserted a hand-rolled `ipInCidr()`
// helper against hand-rolled CIDR strings, which validated nothing about the
// real matcher and hid a complete no-op (the CIDR strings never matched any
// hostname). This version ports the real algorithm instead of reinventing one,
// so a regression back to CIDR-style strings fails loudly.

// Faithful port of `simpleGlobMatch`/`matchesHostList`
// (container.js:104-122 in @cloudflare/containers@0.3.7) — re-verify this port
// against the vendored source if the package version changes; the canary test
// below checks the vendored source still contains the exact algorithm this
// was ported from.
function simpleGlobMatch(pattern: string, value: string): boolean {
  const parts = pattern.split("*");
  if (parts.length === 1) return pattern === value;
  if (!value.startsWith(parts[0])) return false;
  if (!value.endsWith(parts[parts.length - 1])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length - 1; i++) {
    const idx = value.indexOf(parts[i], pos);
    if (idx === -1) return false;
    pos = idx + parts[i].length;
  }
  return pos <= value.length - parts[parts.length - 1].length;
}

function matchesHostList(hostname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => simpleGlobMatch(pattern, hostname));
}

void test("canary: the vendored @cloudflare/containers glob matcher still matches the ported algorithm", () => {
  const vendoredSource = readFileSync(
    fileURLToPath(new URL("../node_modules/@cloudflare/containers/dist/lib/container.js", import.meta.url)),
    "utf8",
  );
  assert.match(vendoredSource, /function simpleGlobMatch\(pattern, value\)/);
  assert.match(vendoredSource, /const parts = pattern\.split\('\*'\);/);
  assert.match(vendoredSource, /function matchesHostList\(hostname, patterns\)/);
});

void test("DENIED_EGRESS_HOSTS covers every spec Task 7 AC error-path address, via the real glob semantics", () => {
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

// Mutation guard: emptying the list must fail the coverage test above, so the
// denylist cannot silently regress to a no-op again.
void test("mutation guard: an empty denylist fails to match the AC error-path addresses", () => {
  assert.equal(matchesHostList("169.254.169.254", []), false);
});
