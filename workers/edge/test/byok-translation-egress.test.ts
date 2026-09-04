import test from "node:test";
import assert from "node:assert/strict";
import { turnToolbox } from "../src/agent/session/session-turn.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import { mimoTurnModel } from "../src/agent/session/turn-model.ts";
import type { ByokCredential } from "../src/agent/byok/byok-credential.ts";
import { byokCredentialIn } from "../src/agent/byok/byok-headers.ts";
import { byokTurnModel } from "../src/agent/byok/byok-turn-model.ts";
import { ScriptedEgressFetch } from "./doubles/scripted-egress-fetch.ts";

// W2-3 (#1289) x W2-1 (#1287): `translate_anime_title`'s fallback is a
// TOOL-LESS completion on the turn's own model, and on a BYOK turn "the turn's
// own model" is the caller-keyed one. So that call has to leave through the
// same `GuardedFetch` carrying the same caller key as every other call of the
// turn — a second, unguarded way out of a BYOK turn would be the whole S5
// perimeter with a door in it.
//
// The catalog is scripted to know nothing about the title, which is what makes
// the chain fall past `title_cn` to the model (`title-translation.ts`).
//
// test-type: unit (scripted socket and scripted catalog; no network).

const FIXTURE_KEY = "byok-test-key-0000";
const TRANSLATE_TOOL = "translate_anime_title";

/** A catalog that resolves nothing, so the translation reaches the model. */
function unknowingCatalog(): { fetch: (request: Request) => Promise<Response> } {
  return {
    fetch: (request) => {
      assert.equal(new URL(request.url).pathname, "/catalog/resolve");
      return Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" }));
    },
  };
}

function credential(values: Record<string, string>): ByokCredential {
  const parsed = byokCredentialIn(new Headers({ "X-BYOK-Key": FIXTURE_KEY, ...values }));
  assert.ok(parsed !== null, "the fixture headers must parse");
  return parsed;
}

const ANTHROPIC = { "X-BYOK-Provider": "anthropic" };

/** The one family whose credential rides `Authorization`, which is the header
 * `ScriptedEgressFetch` records — so the key itself is assertable. */
const OPENAI_COMPATIBLE = {
  "X-BYOK-Provider": "openai-compatible",
  "X-BYOK-Model": "gpt-4o-mini",
  "X-BYOK-Base-Url": "https://api.openai.com/v1",
};

/** Run `translate_anime_title` on a toolbox built from one turn's model. */
async function translateOn(model: Parameters<typeof turnToolbox>[2]) {
  const session = new TurnCatalogSession({ locale: "ja" });
  const toolbox = turnToolbox({ CATALOG: unknowingCatalog() }, session, model);
  const tool = toolbox.tools().find((registered) => registered.name === TRANSLATE_TOOL);
  assert.ok(tool !== undefined, "the turn must register the translation tool");
  const args = { title: "Hyouka", target_language: "zh" };
  return await tool.execute("call-1", args, undefined);
}

void test("the translation's tool-less call leaves through the turn's own guarded fetch", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  await translateOn(byokTurnModel(credential(ANTHROPIC), { inner: socket.fetch }));
  assert.equal(socket.calls.length > 0, true, "the fallback never reached a provider at all");
  assert.deepEqual(
    [...new Set(socket.urls.map((url) => new URL(url).host))],
    ["api.anthropic.com"],
    "the caller's own provider, decided by the same allowlist as the turn",
  );
  assert.deepEqual([...new Set(socket.calls.map((call) => call.redirect))], ["manual"]);
});

void test("that call carries the caller's key, never a server credential", async () => {
  const socket = new ScriptedEgressFetch([{ status: 401, body: "{}" }]);
  await translateOn(byokTurnModel(credential(OPENAI_COMPATIBLE), { inner: socket.fetch }));
  assert.deepEqual(
    [...new Set(socket.calls.map((call) => call.authorization))],
    [`Bearer ${FIXTURE_KEY}`],
  );
});

void test("a plain turn's translation still runs on the server model", () => {
  const session = new TurnCatalogSession({ locale: "ja" });
  const toolbox = turnToolbox({ CATALOG: unknowingCatalog() }, session, mimoTurnModel("server-key-0000"));
  const names = toolbox.tools().map((registered) => registered.name);
  assert.equal(names.includes(TRANSLATE_TOOL), true);
});
