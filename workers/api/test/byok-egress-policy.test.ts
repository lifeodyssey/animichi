import test from "node:test";
import assert from "node:assert/strict";
import { EgressPolicy } from "../src/agent/egress/egress-policy.ts";
import { BYOK_PROVIDERS, ProviderAllowlist } from "../src/agent/egress/provider-allowlist.ts";

// W0-S5 (#1248): the BYOK red lines that are about the request's *shape* —
// provider family, key presence, scheme, port, userinfo, own infrastructure.
// The address ranges have their own file (byok-egress-addresses.test.ts).
//
// test-type: unit (pure decision, no network, no clock, no bindings).

const KEY = "sk-spike-000000000000";
const policy = new EgressPolicy();

function decisionFor(provider: unknown, baseUrl: string, key = KEY) {
  return policy.decide({ provider, baseUrl, key });
}

function reasonFor(provider: unknown, baseUrl: string, key = KEY): string {
  const decision = decisionFor(provider, baseUrl, key);
  return decision.allowed ? "allowed" : decision.reason;
}

const ALLOWED_BASE_URLS: readonly [string, string][] = [
  ["openai", "https://api.openai.com/v1"],
  ["anthropic", "https://api.anthropic.com"],
  ["google", "https://generativelanguage.googleapis.com/v1beta/openai"],
];

for (const [provider, baseUrl] of ALLOWED_BASE_URLS) {
  void test(`${provider}'s own host is allowed`, () => {
    assert.equal(reasonFor(provider, baseUrl), "allowed");
  });
}

void test("each provider is confined to its own family's hosts", () => {
  assert.equal(reasonFor("openai", "https://api.anthropic.com/v1"), "host_not_allowlisted");
  assert.equal(reasonFor("anthropic", "https://api.openai.com/v1"), "host_not_allowlisted");
});

void test("the allowlist is exact, so a suffix lookalike is refused", () => {
  assert.equal(reasonFor("openai", "https://api.openai.com.evil.test/v1"), "host_not_allowlisted");
  assert.equal(reasonFor("openai", "https://evil-api.openai.com/v1"), "host_not_allowlisted");
});

void test("a trailing root label is the same host, not a way past the allowlist", () => {
  assert.equal(reasonFor("openai", "https://api.openai.com./v1"), "allowed");
});

void test("an unknown provider is refused rather than defaulted to a family", () => {
  assert.equal(reasonFor("openrouter", "https://api.openai.com/v1"), "unknown_provider");
  assert.equal(reasonFor(undefined, "https://api.openai.com/v1"), "unknown_provider");
});

void test("an absent or whitespace key is refused — there is no server-key fallback", () => {
  assert.equal(reasonFor("openai", "https://api.openai.com/v1", ""), "empty_key");
  assert.equal(reasonFor("openai", "https://api.openai.com/v1", "   \t\n"), "empty_key");
});

void test("the key is checked before the host, so no client is ever built without one", () => {
  assert.equal(reasonFor("openai", "https://169.254.169.254/", ""), "empty_key");
  assert.equal(reasonFor("nonsense", "not a url", ""), "empty_key");
});

void test("plaintext http is refused even for an allowlisted host", () => {
  assert.equal(reasonFor("openai", "http://api.openai.com/v1"), "scheme_not_https");
  assert.equal(reasonFor("openai", "file:///etc/passwd"), "scheme_not_https");
});

void test("only port 443 is allowed, and the default port is 443", () => {
  assert.equal(reasonFor("openai", "https://api.openai.com:443/v1"), "allowed");
  assert.equal(reasonFor("openai", "https://api.openai.com:8080/v1"), "port_not_443");
  assert.equal(reasonFor("openai", "https://api.openai.com:8443/v1"), "port_not_443");
});

void test("userinfo cannot be used to dress an attacker host as a provider", () => {
  assert.equal(reasonFor("openai", "https://api.openai.com@evil.test/v1"), "userinfo_present");
});

void test("an unparseable base URL is refused", () => {
  assert.equal(reasonFor("openai", "https://"), "invalid_url");
  assert.equal(reasonFor("openai", "api.openai.com/v1"), "invalid_url");
});

const OWN_INFRASTRUCTURE = [
  "https://animichi.com/v1",
  "https://api.animichi.com/v1",
  "https://animichi-spike-pi.example.workers.dev/v1",
  "https://catalog.internal/v1",
  "https://project.stack-auth.com/v1",
];

for (const baseUrl of OWN_INFRASTRUCTURE) {
  void test(`own infrastructure is refused: ${baseUrl}`, () => {
    assert.equal(reasonFor("openai", baseUrl), "own_infrastructure");
  });
}

void test("the own-infrastructure match is dot-anchored, not a bare suffix", () => {
  assert.equal(reasonFor("openai", "https://notanimichi.com/v1"), "host_not_allowlisted");
});

void test("the allowlist is load-bearing: a policy given other hosts decides differently", () => {
  const elsewhere = new EgressPolicy(
    new ProviderAllowlist({ openai: ["api.example.test"], anthropic: [], google: [] }),
  );
  const decision = elsewhere.decide({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    key: KEY,
  });
  assert.equal(decision.allowed, false);
});

// The DNS half of the red line. workerd has no resolver, so the guard cannot
// classify what a name RESOLVES to the way `egress_guard.py` does; what stands
// in for it is that the host must be one of the enumerated provider hosts, so
// a caller cannot nominate a name whose answer they control. These two are real
// public names that resolve into loopback (127.0.0.1, checked 2026-09-03) —
// they are refused, and the reason says which condition did it.
const RESOLVES_INSIDE = ["https://localtest.me/v1", "https://127.0.0.1.nip.io/v1"];

for (const baseUrl of RESOLVES_INSIDE) {
  void test(`a public name resolving into loopback is refused: ${baseUrl}`, () => {
    assert.equal(reasonFor("openai", baseUrl), "host_not_allowlisted");
  });
}

void test("a rebinding flip has nothing to steer, because the host is not caller-chosen", () => {
  const decision = decisionFor("openai", "https://api.openai.com/v1");
  assert.equal(decision.allowed && decision.host, "api.openai.com");
});

void test("exactly three provider families exist", () => {
  assert.deepEqual([...BYOK_PROVIDERS], ["openai", "anthropic", "google"]);
});
