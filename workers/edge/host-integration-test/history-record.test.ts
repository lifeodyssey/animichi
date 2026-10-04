/**
 * Ticket 4 of #1996 (#2004): the history read returns the complete per-turn
 * record after a real host turn, including the `translate_anime_title` catalog
 * miss's own provider and model, and the read model writes nothing.
 *
 * test-type: integration.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { GetSessionHistoryResponse } from "@animichi/contract";
import { NeonStorage } from "@animichi/pi-session-neon";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { InstrumentedStorage } from "@earendil-works/pi-agent-core/harness/session/testing";
import { nativeClient } from "../src/native-client.ts";
import { readHistoryStorage } from "../src/agent/views/history.ts";
import { chatBody, chatHeaders, defaultWorker } from "./default-worker.ts";
import { dsn, pool, SESSION } from "./postgres.ts";
import { selectedPoint } from "./seed-selection.ts";

function call(index: number, name: string, args: object) {
  return { index, id: `native-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function completion(delta: object, finish: "tool_calls" | "stop", tokens: number) {
  const chunk = { id: "native", object: "chat.completion.chunk", created: 0, model: "mimo-v2.6-flash",
    choices: [{ index: 0, delta, finish_reason: finish }], usage: { prompt_tokens: tokens, completion_tokens: tokens === 30 ? 20 : 3, total_tokens: tokens === 30 ? 50 : 10 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

/** The main model asks for a catalog call and the fallback; the fallback answers with its own distinct usage. */
function recordNetwork() {
  let main = 0;
  return { catalog: () => Response.json({ rows: [{ ...selectedPoint, city: "东京" }], synced_at: "2026-09-10", partial: false }),
    model: async (request: Request) => {
      const body = await request.json() as { tools?: unknown[] };
      if (!body.tools?.length) return completion({ content: "Official translated title" }, "stop", 7);
      main += 1;
      if (main > 1) return completion({ tool_calls: [call(0, "respond", { kind: "greeting", message: "Finished" })] }, "tool_calls", 30);
      return completion({ tool_calls: [call(0, "search_bangumi", { bangumi_id: "123" }), call(1, "translate_anime_title", { title: "Original", target_language: "en" })] }, "tool_calls", 30);
    } };
}

void test("the history read returns the complete per-turn record including the translation fallback", { timeout: 60_000 }, async (context) => {
  const { worker, requests } = await defaultWorker(context, {}, recordNetwork());
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: AbortSignal.timeout(30_000) }).then(() => true, () => false);
  const response = await worker.dispatchFetch("https://host.test/v1/chat", { method: "POST", headers: chatHeaders, body: chatBody });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Finished/);
  assert.equal(await settled, true);
  assert.equal(requests.length, 3);
  const historyResponse = await worker.dispatchFetch(`https://host.test/v1/conversations/${SESSION}/messages`);
  assert.equal(historyResponse.status, 200);
  const history = GetSessionHistoryResponse.parse(await historyResponse.json());
  const toolResults = history.tool_results ?? [];
  const modelCalls = history.model_calls ?? [];
  assert.equal(history.run?.status, "succeeded");
  assert.ok((history.steps?.length ?? 0) >= 1);
  assert.deepEqual(toolResults.map((result) => result.tool_name).sort(), ["respond", "search_bangumi", "translate_anime_title"]);
  const translate = toolResults.find((result) => result.tool_name === "translate_anime_title");
  assert.ok(translate);
  assert.partialDeepStrictEqual(JSON.parse(translate.result), { provider: "xiaomi", model: "mimo-v2.6-flash", translated: "Official translated title" });
  const respond = toolResults.find((result) => result.tool_name === "respond");
  assert.ok(respond);
  assert.equal((JSON.parse(respond.result) as { message?: string }).message, "Finished");
  const fallback = modelCalls.find((call) => call.usage.input === 7);
  assert.ok(fallback, JSON.stringify(modelCalls));
  assert.deepEqual({ provider: fallback.provider, model: fallback.model, output: fallback.usage.output }, { provider: "xiaomi", model: "mimo-v2.6-flash", output: 3 });
  assert.deepEqual(modelCalls.map((call) => call.usage.input).sort((a, b) => a - b), [7, 30, 30]);
});

void test("the history read only reads: no commit is attempted", { timeout: 60_000 }, async (context) => {
  const { worker } = await defaultWorker(context);
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: AbortSignal.timeout(30_000) }).then(() => true, () => false);
  const response = await worker.dispatchFetch("https://host.test/v1/chat", { method: "POST", headers: chatHeaders, body: chatBody });
  assert.match(await response.text(), /Hello from the native host/);
  assert.equal(await settled, true);
  const db = nativeClient(dsn);
  const storage = new InstrumentedStorage(new NeonStorage(db, { sessionId: SESSION }));
  try {
    const history = await readHistoryStorage(storage, { offset: 0, limit: 100 }, BACKGROUND_CONTEXT);
    assert.ok(history.messages.length > 0);
    assert.ok((history.model_calls ?? []).length > 0);
    assert.deepEqual(storage.getCommitAttempts(), []);
  } finally { await storage.close(BACKGROUND_CONTEXT); await db.close(); }
});
