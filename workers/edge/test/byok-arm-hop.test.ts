import test from "node:test";
import assert from "node:assert/strict";
import { AgentSession } from "../src/agent/session/agent-session.ts";
import { armedCredential, armedRunId, armRequest } from "../src/agent/session/session-wakeup.ts";
import type { ByokCredential } from "../src/agent/byok/byok-credential.ts";
import { byokCredentialIn } from "../src/agent/byok/byok-headers.ts";

// W2-3 (#1289) — the ONE hop a BYOK credential makes after the request that
// carried it: `POST /arm` on the session's own Durable Object stub, which is
// how it reaches the alarm that will spend it.
//
// Two properties, and the second is the red line: the headers are the exact
// inverse of the parser (so the far side re-validates rather than trusts), and
// arming a session writes the run id to storage and NOTHING ELSE — the key
// lives in the incarnation's heap and dies with it.
//
// test-type: unit (no network, no database, no real Durable Object).

const FIXTURE_KEY = "byok-test-key-0000";
const RUN_ID = "11111111-2222-3333-4444-555555555555";

/** The storage `AgentSession` is given: a real Map, so "what was written" is
 * readable rather than asserted about a stand-in. */
class MapStorage {
  readonly values = new Map<string, unknown>();
  alarmAt: number | null = null;

  put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key));
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }

  list(options: { prefix: string }): Promise<Map<string, unknown>> {
    return Promise.resolve(new Map([...this.values].filter(([key]) => key.startsWith(options.prefix))));
  }

  setAlarm(when: number): Promise<void> {
    this.alarmAt = when;
    return Promise.resolve();
  }
}

function makeSession(storage: MapStorage): AgentSession {
  const ctx = { id: { toString: () => "do-1" }, storage } as unknown as DurableObjectState;
  return new AgentSession(ctx, {});
}

function credentialFor(values: Record<string, string>): ByokCredential {
  const parsed = byokCredentialIn(new Headers({ "X-BYOK-Key": FIXTURE_KEY, ...values }));
  assert.ok(parsed !== null, "the fixture headers must parse");
  return parsed;
}

const FAMILIES: [string, Record<string, string>][] = [
  ["anthropic", { "X-BYOK-Provider": "anthropic", "X-BYOK-Model": "claude-sonnet-4-5" }],
  ["gemini", { "X-BYOK-Provider": "gemini", "X-BYOK-Model": "gemini-2.5-flash" }],
  ["openai-compatible", {
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Model": "gpt-4o-mini",
    "X-BYOK-Base-Url": "https://api.openai.com/v1",
  }],
];

// ── the arm request is the parser's exact inverse ──────────────────────────

for (const [family, values] of FAMILIES) {
  void test(`a ${family} credential survives the arm hop unchanged`, () => {
    const sent = credentialFor(values);
    const received = armedCredential(armRequest(RUN_ID, sent));
    assert.ok(received !== null, "the far side must read back what was sent");
    assert.deepEqual(received.toJSON(), sent.toJSON());
    assert.equal(received.baseUrl, sent.baseUrl);
    assert.equal(received.secret, sent.secret);
  });
}

void test("an arm request for a plain turn carries no credential at all", async () => {
  const request = armRequest(RUN_ID);
  assert.equal(armedCredential(request), null);
  assert.equal(await armedRunId(request), RUN_ID);
});

// ── the red line: nothing durable ever sees the key ────────────────────────

void test("arming a session with a credential writes the run id to storage and nothing else", async () => {
  const storage = new MapStorage();
  const armed = armRequest(RUN_ID, credentialFor({ "X-BYOK-Provider": "anthropic" }));
  assert.equal((await makeSession(storage).fetch(armed)).status, 204);
  assert.deepEqual([...storage.values.keys()], [`pending:${RUN_ID}`]);
  assert.equal(JSON.stringify([...storage.values]).includes(FIXTURE_KEY), false);
});
