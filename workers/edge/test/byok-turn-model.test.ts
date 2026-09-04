import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@earendil-works/pi-ai";
import { EgressDeniedError } from "../src/agent/egress/egress-decision.ts";
import type { ByokCredential } from "../src/agent/byok/byok-credential.ts";
import { byokCredentialIn } from "../src/agent/byok/byok-headers.ts";
import { byokTurnModel } from "../src/agent/byok/byok-turn-model.ts";
import { ScriptedEgressFetch } from "./doubles/scripted-egress-fetch.ts";

// W2-3 (#1289) — the per-turn BYOK model, on the PRODUCTION path.
//
// Every case here drives a REAL pi provider adapter (`openai-completions` /
// `anthropic-messages`) through `byokTurnModel`, and only the socket is
// scripted. That is what makes this the measurement spec §四 S5's Appendix D
// left to W2: pi-ai's `google-generative-ai` adapter REFUSES an injected fetch,
// so the question "does the anthropic one accept it" could not be answered by
// reading the guard — it had to be answered by a round trip.

const FIXTURE_KEY = "byok-test-key-0000";

const PROMPT: Context = { messages: [{ role: "user", content: "hi", timestamp: 0 }] };

function credentialFor(values: Record<string, string>): ByokCredential {
  const credential = byokCredentialIn(new Headers({ "X-BYOK-Key": FIXTURE_KEY, ...values }));
  assert.ok(credential !== null, "the fixture headers must parse");
  return credential;
}

/** One real pi round trip against a scripted socket; answers what it saw. */
async function roundTrip(values: Record<string, string>, socket: ScriptedEgressFetch) {
  const credential = credentialFor(values);
  const turn = byokTurnModel(credential, { inner: socket.fetch });
  const options = { maxRetries: 0, fetch: turn.fetch };
  const message = await turn.registry.completeSimple(turn.model, PROMPT, options);
  return { socket, stopReason: message.stopReason };
}

const OPENAI_HEADERS = {
  "X-BYOK-Provider": "openai-compatible",
  "X-BYOK-Model": "gpt-4o-mini",
  "X-BYOK-Base-Url": "https://api.openai.com/v1",
};
const ANTHROPIC_HEADERS = { "X-BYOK-Provider": "anthropic" };
const GEMINI_HEADERS = { "X-BYOK-Provider": "gemini" };

// ── the allowlisted host is actually reached, per family ───────────────────

void test("an openai-compatible credential reaches its allowlisted host through the guard", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  const seen = await roundTrip(OPENAI_HEADERS, socket);
  assert.equal(seen.socket.calls.length > 0, true);
  assert.equal(new URL(seen.socket.urls[0] ?? "https://none.test").host, "api.openai.com");
});

void test("the anthropic adapter accepts the injected fetch, so the guard sees its traffic", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  const seen = await roundTrip(ANTHROPIC_HEADERS, socket);
  assert.equal(seen.socket.calls.length > 0, true);
  assert.equal(new URL(seen.socket.urls[0] ?? "https://none.test").host, "api.anthropic.com");
});

void test("a gemini credential is driven through Google's OpenAI-compatible path", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  const seen = await roundTrip(GEMINI_HEADERS, socket);
  const first = new URL(seen.socket.urls[0] ?? "https://none.test");
  assert.equal(first.host, "generativelanguage.googleapis.com");
  assert.equal(first.pathname.startsWith("/v1beta/openai/"), true);
});

// ── the guard is on every hop, not only the first ──────────────────────────

void test("a redirect at an allowlisted host towards the metadata address is refused at hop 1", async () => {
  const socket = new ScriptedEgressFetch([{ status: 302, location: "https://169.254.169.254/v1" }]);
  const turn = byokTurnModel(credentialFor(OPENAI_HEADERS), { inner: socket.fetch });
  const refusal = await turn.fetch?.("https://api.openai.com/v1/chat/completions", { method: "POST" })
    .then(() => null, (error: unknown) => error);
  assert.ok(refusal instanceof EgressDeniedError);
  assert.equal(refusal.reason, "metadata_address");
  assert.equal(socket.calls.length, 1, "the redirect target must never be sent");
});

void test("every hop the guard does send asks the runtime not to follow redirects itself", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  await roundTrip(OPENAI_HEADERS, socket);
  assert.deepEqual([...new Set(socket.calls.map((call) => call.redirect))], ["manual"]);
});

// ── the caller's key is the only credential in scope ───────────────────────

void test("the turn's provider carries the caller's key and no server-side one", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  await roundTrip(OPENAI_HEADERS, socket);
  assert.equal(socket.calls[0]?.authorization, `Bearer ${FIXTURE_KEY}`);
});

void test("a scripted rejection ends the round trip as an error rather than an answer", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  const seen = await roundTrip(OPENAI_HEADERS, socket);
  assert.equal(seen.stopReason, "error");
});
