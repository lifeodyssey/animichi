import test from "node:test";
import assert from "node:assert/strict";
import { EgressDeniedError } from "../src/agent/egress/egress-decision.ts";
import { EgressPolicy } from "../src/agent/egress/egress-policy.ts";
import { GuardedFetch } from "../src/agent/egress/guarded-fetch.ts";
import { ProviderAllowlist } from "../src/agent/egress/provider-allowlist.ts";
import { ScriptedEgressFetch } from "./doubles/scripted-egress-fetch.ts";

// W0-S5 (#1248): a redirect is a second destination, so it gets a second
// decision. The pre-flight check on the first URL is not the guard — following
// a `302 Location: http://169.254.169.254/` would hand the whole SSRF boundary
// back to whoever controls the provider host's answer.
//
// test-type: unit (scripted fetch double, no network, no clock).

const KEY = "sk-spike-000000000000";
const OPENAI = "https://api.openai.com/v1/chat/completions";

function guardedOver(inner: ScriptedEgressFetch, maxHops = 3): GuardedFetch {
  return new GuardedFetch({ provider: "openai", key: KEY, inner: inner.fetch, maxHops });
}

async function reasonOf(call: Promise<Response>): Promise<string> {
  const error = await call.then(() => null, (thrown: unknown) => thrown);
  assert.ok(error instanceof EgressDeniedError, "expected an EgressDeniedError");
  return error.reason;
}

void test("a plain response passes through and follows nothing", async () => {
  const inner = new ScriptedEgressFetch([{ status: 200 }]);
  const guarded = guardedOver(inner);
  const response = await guarded.fetch(OPENAI, { method: "POST", body: "{}" });
  assert.equal(response.status, 200);
  assert.equal(guarded.hops, 0);
  assert.deepEqual(inner.urls, [OPENAI]);
});

void test("the runtime is never allowed to follow a redirect on its own", async () => {
  const inner = new ScriptedEgressFetch([{ status: 200 }]);
  await guardedOver(inner).fetch(OPENAI, { method: "POST", body: "{}" });
  assert.equal(inner.calls[0]?.redirect, "manual");
});

void test("the request body survives to the provider", async () => {
  const inner = new ScriptedEgressFetch([{ status: 200 }]);
  await guardedOver(inner).fetch(OPENAI, { method: "POST", body: '{"model":"gpt-4o-mini"}' });
  assert.equal(inner.calls[0]?.body, '{"model":"gpt-4o-mini"}');
});

void test("a redirect inside the allowlist is re-validated and then followed", async () => {
  const inner = new ScriptedEgressFetch([
    { status: 302, location: "https://api.openai.com/v1/moved" },
    { status: 200 },
  ]);
  const guarded = guardedOver(inner);
  const response = await guarded.fetch(OPENAI, { method: "POST", body: "{}" });
  assert.equal(response.status, 200);
  assert.equal(guarded.hops, 1);
  assert.deepEqual(inner.urls, [OPENAI, "https://api.openai.com/v1/moved"]);
});

void test("a 302 continues as a bodiless GET", async () => {
  const inner = new ScriptedEgressFetch([
    { status: 302, location: "https://api.openai.com/v1/moved" },
    { status: 200 },
  ]);
  await guardedOver(inner).fetch(OPENAI, { method: "POST", body: "{}" });
  assert.deepEqual(inner.calls.map((call) => call.method), ["POST", "GET"]);
  assert.deepEqual(inner.calls.map((call) => call.body), ["{}", ""]);
});

void test("a 307 keeps the method and replays the body", async () => {
  const inner = new ScriptedEgressFetch([
    { status: 307, location: "https://api.openai.com/v1/moved" },
    { status: 200 },
  ]);
  await guardedOver(inner).fetch(OPENAI, { method: "POST", body: '{"a":1}' });
  assert.deepEqual(inner.calls.map((call) => call.method), ["POST", "POST"]);
  assert.deepEqual(inner.calls.map((call) => call.body), ['{"a":1}', '{"a":1}']);
});

const HOSTILE_REDIRECTS: readonly [string, string][] = [
  ["http://169.254.169.254/latest/meta-data", "scheme_not_https"],
  ["https://169.254.169.254/", "metadata_address"],
  ["https://10.0.0.1/", "private_address"],
  ["https://[::1]/", "loopback_address"],
  ["https://catalog.internal/v1", "own_infrastructure"],
  ["https://evil.test/v1", "host_not_allowlisted"],
  ["//10.0.0.1/v1", "private_address"],
];

for (const [location, reason] of HOSTILE_REDIRECTS) {
  void test(`a redirect to ${location} is refused as ${reason}`, async () => {
    const inner = new ScriptedEgressFetch([{ status: 302, location }, { status: 200 }]);
    const guarded = guardedOver(inner);
    assert.equal(await reasonOf(guarded.fetch(OPENAI, { method: "POST", body: "{}" })), reason);
    assert.deepEqual(inner.urls, [OPENAI], "the redirect target must never be fetched");
  });
}

void test("a 3xx with no Location is refused rather than returned as a response", async () => {
  const inner = new ScriptedEgressFetch([{ status: 302 }]);
  assert.equal(
    await reasonOf(guardedOver(inner).fetch(OPENAI, { method: "POST", body: "{}" })),
    "redirect_without_location",
  );
});

void test("a redirect cycle stops at the hop bound", async () => {
  const cycle = { status: 302, location: "https://api.openai.com/v1/loop" };
  const inner = new ScriptedEgressFetch([cycle, cycle, cycle, cycle, cycle, cycle]);
  const guarded = guardedOver(inner, 2);
  assert.equal(
    await reasonOf(guarded.fetch(OPENAI, { method: "POST", body: "{}" })),
    "redirect_hop_limit",
  );
  assert.equal(inner.calls.length, 3);
});

void test("the first URL is decided too, so a denied destination never reaches the network", async () => {
  const inner = new ScriptedEgressFetch([{ status: 200 }]);
  const guarded = guardedOver(inner);
  assert.equal(await reasonOf(guarded.fetch("https://169.254.169.254/")), "metadata_address");
  assert.deepEqual(inner.calls, []);
});

void test("an empty key stops the call before any provider is contacted", async () => {
  const inner = new ScriptedEgressFetch([{ status: 200 }]);
  const guarded = new GuardedFetch({ provider: "openai", key: "  ", inner: inner.fetch });
  assert.equal(await reasonOf(guarded.fetch(OPENAI, { method: "POST", body: "{}" })), "empty_key");
  assert.deepEqual(inner.calls, []);
});

const AUTHORIZED = { method: "POST", body: "{}", headers: { authorization: `Bearer ${KEY}` } };

void test("a same-origin redirect keeps the caller's credential", async () => {
  const inner = new ScriptedEgressFetch([
    { status: 302, location: "https://api.openai.com/v1/moved" },
    { status: 200 },
  ]);
  await guardedOver(inner).fetch(OPENAI, AUTHORIZED);
  assert.deepEqual(
    inner.calls.map((call) => call.authorization),
    [`Bearer ${KEY}`, `Bearer ${KEY}`],
  );
});

void test("a redirect that changes origin does not take the key along", async () => {
  const twoHosts = new EgressPolicy(
    new ProviderAllowlist({
      openai: ["api.openai.com", "second.openai-mirror.test"],
      anthropic: [],
      google: [],
    }),
  );
  const inner = new ScriptedEgressFetch([
    { status: 302, location: "https://second.openai-mirror.test/v1" },
    { status: 200 },
  ]);
  const guarded = new GuardedFetch({
    provider: "openai",
    key: KEY,
    policy: twoHosts,
    inner: inner.fetch,
  });
  await guarded.fetch(OPENAI, AUTHORIZED);
  assert.deepEqual(inner.calls.map((call) => call.authorization), [`Bearer ${KEY}`, ""]);
});
