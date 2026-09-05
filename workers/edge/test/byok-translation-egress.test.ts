import test from "node:test";
import assert from "node:assert/strict";
import { translationModel, turnToolbox } from "../src/agent/session/session-turn.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import {
  MIMO_HOST,
  guardedMimoTurnModel,
  mimoTurnModel,
  type TurnModel,
} from "../src/agent/session/turn-model.ts";
import { EgressDeniedError } from "../src/agent/egress/egress-decision.ts";
import type { ByokCredential } from "../src/agent/byok/byok-credential.ts";
import { byokCredentialIn } from "../src/agent/byok/byok-headers.ts";
import { byokTurnModel } from "../src/agent/byok/byok-turn-model.ts";
import type { JsonValue } from "@earendil-works/pi-ai";
import { ScriptedEgressFetch } from "./doubles/scripted-egress-fetch.ts";

// W2-3 (#1289) x W2-1 (#1287): D18 — `translate_anime_title` translates on the
// SERVER key during a caller-keyed turn.
//
// `public_api.py:922` forces exactly this on the Python tier, because the tool
// otherwise inherits the run's own model, which on a BYOK turn is the caller's
// credential. The caller pays for the turn they asked for; the platform pays
// for a translation they did not. `title-translation.ts`'s own header states
// the rule, and this suite is what wires it shut.
//
// The catalog is scripted to know nothing about the title, which is what makes
// the chain fall past `title_cn` to the model (`title-translation.ts`).
//
// test-type: unit (scripted socket and scripted catalog; no network).

const CALLER_KEY = "byok-test-key-0000";
const SERVER_KEY = "server-test-key-0000";
const TRANSLATE_TOOL = "translate_anime_title";
const SERVER_KEYED_ENV = { MIMO_API_KEY: SERVER_KEY };

/** A catalog that resolves nothing, so the translation reaches the model. */
function unknowingCatalog(): { fetch: (request: Request) => Promise<Response> } {
  return {
    fetch: (request) => {
      assert.equal(new URL(request.url).pathname, "/catalog/resolve");
      return Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" }));
    },
  };
}

function credential(): ByokCredential {
  const parsed = byokCredentialIn(new Headers({
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": CALLER_KEY,
    "X-BYOK-Model": "gpt-4o-mini",
    "X-BYOK-Base-Url": "https://api.openai.com/v1",
  }));
  assert.ok(parsed !== null, "the fixture headers must parse");
  return parsed;
}

/** Run `translate_anime_title` on a toolbox built from one turn's model. */
async function translateOn(env: Record<string, unknown>, model: TurnModel) {
  const session = new TurnCatalogSession({ runId: "run-1", locale: "ja" });
  const toolbox = turnToolbox({ ...env, CATALOG: unknowingCatalog() }, session, model);
  const tool = toolbox.tools().find((registered) => registered.name === TRANSLATE_TOOL);
  assert.ok(tool !== undefined, "the turn must register the translation tool");
  const result = await tool.execute("call-1", { title: "Hyouka", target_language: "zh" }, undefined);
  return translationOf(result.details);
}

/** The tool hands its `TranslationResult` back as `details`; the port types
 * that as JSON, so the one narrowing lives here rather than at each assertion. */
function translationOf(details: JsonValue): { source: string } {
  assert.ok(typeof details === "object" && details !== null && !Array.isArray(details));
  const source = details.source;
  assert.ok(typeof source === "string", "a translation always says where it came from");
  return { source };
}

// ── D18: the caller's key is not what translates ───────────────────────────

void test("a caller-keyed turn translates on the server's model, never on the caller's", () => {
  const callers = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  const caller = byokTurnModel(credential(), { inner: callers.fetch });
  const chosen = translationModel(SERVER_KEYED_ENV, caller);
  assert.ok(chosen !== null, "a configured server key is what D18 falls back to");
  assert.equal(chosen.model.provider, "mimo", "never the caller's own provider");
  assert.notEqual(chosen.fetch, undefined, "and it is still a guarded hop");
  assert.deepEqual(callers.calls, [], "the caller's key must not pay for a translation they did not ask for");
});

void test("a plain turn's translation is its own model, reused rather than re-created", () => {
  const server = guardedMimoTurnModel(SERVER_KEY);
  assert.equal(translationModel(SERVER_KEYED_ENV, server), server);
});

void test("the translation's tool-less call on a caller-keyed turn leaves on the SERVER key through the guarded fetch", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  const server = guardedMimoTurnModel(SERVER_KEY, socket.fetch);
  await translateOn({}, server);
  assert.deepEqual([...new Set(socket.urls.map((url) => new URL(url).host))], [MIMO_HOST]);
  assert.deepEqual([...new Set(socket.calls.map((call) => call.authorization))], [`Bearer ${SERVER_KEY}`]);
  assert.equal(socket.calls.some((call) => call.authorization.includes(CALLER_KEY)), false);
  assert.deepEqual([...new Set(socket.calls.map((call) => call.redirect))], ["manual"]);
});

void test("that hop is pinned to one host — a redirect off it is refused at hop 1", async () => {
  const socket = new ScriptedEgressFetch([{ status: 302, location: "https://api.openai.com/v1" }]);
  const server = guardedMimoTurnModel(SERVER_KEY, socket.fetch);
  const refused = await server.fetch?.(`https://${MIMO_HOST}/v1/chat/completions`, { method: "POST" })
    .then(() => null, (error: unknown) => error);
  assert.ok(refused instanceof EgressDeniedError);
  assert.equal(refused.reason, "host_not_allowlisted");
  assert.equal(socket.calls.length, 1, "the redirect target must never be sent");
});

// ── the controls ───────────────────────────────────────────────────────────

void test("a plain turn still translates on its own model, one registry and one connection", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  const server = guardedMimoTurnModel(SERVER_KEY, socket.fetch);
  await translateOn({}, server);
  assert.equal(socket.calls.length > 0, true);
});

void test("a caller-keyed turn with no server key to fall back on answers untranslated", async () => {
  const callers = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  const translated = await translateOn({}, byokTurnModel(credential(), { inner: callers.fetch }));
  assert.equal(translated.source, "untranslated");
  assert.deepEqual(callers.calls, [], "no server key is not a reason to spend the caller's");
});

void test("the server-key model is never marked caller-keyed, so no run may be driven on it", () => {
  assert.equal(guardedMimoTurnModel(SERVER_KEY).callerKeyed, false);
  assert.equal(mimoTurnModel(SERVER_KEY).callerKeyed, false);
});
