import test from "node:test";
import assert from "node:assert/strict";
import { nativeHostModels, nativeByokModels } from "../src/agent/host/native-models.ts";

const prompt = { messages: [{ role: "user" as const, content: "Hello", timestamp: 0 }] };
function completion() {
  const chunk = { id: "test", object: "chat.completion.chunk", created: 0, model: "mimo-v2.6-flash", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

function recordingFetch(requests: Request[], respond: () => Response = completion) {
  return (input: Parameters<typeof fetch>[0]) => {
    requests.push(new Request(input));
    return Promise.resolve(respond());
  };
}

void test("a native turn asks OpenCode Go for the published V2.6 Flash id at its catalog rates", async () => {
  const requests: Request[] = [];
  const native = await nativeHostModels("server-key", recordingFetch(requests));
  const result = await native.models.completeSimple(native.model, prompt);
  assert.equal(result.stopReason, "stop");
  const sent = requests[0];
  assert.ok(sent);
  const wire = JSON.parse(await sent.text()) as { model: string };
  assert.equal(wire.model, "mimo-v2.6-flash");
  assert.deepEqual(native.model.cost, { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 });
});

void test("the default turn reaches OpenCode Go, never the direct Xiaomi provider", async () => {
  const requests: Request[] = [];
  const native = await nativeHostModels("server-key", recordingFetch(requests));
  assert.equal(native.model.provider, "opencode-go");
  assert.equal((await native.models.completeSimple(native.model, prompt)).stopReason, "stop");
  const sent = requests[0];
  assert.ok(sent);
  assert.equal(sent.headers.get("authorization"), "Bearer server-key");
  assert.equal(new URL(sent.url).hostname, "opencode.ai");
});

void test("every default-turn request carries the OpenCode Go session header", async () => {
  const requests: Request[] = [];
  const native = await nativeHostModels("server-key", recordingFetch(requests));
  await native.models.completeSimple(native.model, prompt);
  await native.models.completeSimple(native.model, prompt);
  const sessions = requests.map((request) => request.headers.get("x-opencode-session"));
  assert.equal(requests.length, 2);
  assert.equal(new Set(sessions).size, 1, "one host incarnation is one OpenCode Go session");
  assert.match(String(sessions[0]), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

void test("an OpenCode Go quota refusal ends the turn as a visible model error and never reaches Xiaomi", async () => {
  const requests: Request[] = [];
  const native = await nativeHostModels("server-key", recordingFetch(requests, () => new Response("quota", { status: 429 })));
  const result = await native.models.completeSimple(native.model, prompt);
  assert.equal(result.stopReason, "error");
  assert.equal(requests.length, 1);
  const sent = requests[0];
  assert.ok(sent);
  assert.equal(new URL(sent.url).hostname, "opencode.ai");
});

void test("BYOK native Models use only the ephemeral request key and logout cannot fall back", async () => {
  const requests: Request[] = [];
  const native = await nativeByokModels({ family: "openai-compatible", provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1", secret: "caller-key" },
    recordingFetch(requests));
  assert.equal((await native.models.completeSimple(native.model, prompt)).stopReason, "stop");
  const sent = requests[0];
  assert.ok(sent);
  assert.equal(sent.headers.get("authorization"), "Bearer caller-key");
  await native.models.logout("openai");
  assert.equal((await native.models.completeSimple(native.model, prompt)).stopReason, "error");
  assert.equal(requests.length, 1);
});

void test("missing server credentials preserve a keyless OpenCode Go model for controlled cancellation only", async () => {
  const native = await nativeHostModels(undefined);
  assert.equal(native.model.provider, "opencode-go");
  assert.equal(native.available, false);
  assert.equal((await native.models.completeSimple(native.model, prompt)).stopReason, "error");
});

void test("a cold native harness cancels the original BYOK operation without reusing a server model", async () => {
  const { MemorySessionRepo } = await import("@earendil-works/pi-agent-core/harness/session");
  const { BACKGROUND_CONTEXT: context } = await import("@earendil-works/pi-agent-core/harness/context");
  const { AgentHarness } = await import("@earendil-works/pi-agent-core");
  const repo = new MemorySessionRepo();
  let session = await repo.create({}, context);
  const caller = await nativeByokModels({ family: "openai-compatible", provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1", secret: "lost-key" });
  let { harness } = await AgentHarness.create({ session, ...caller }, context);
  let lane = await harness.lane("main", context);
  const accepted = await lane.accept({ kind: "prompt", operationId: "cold-byok", prompt: "Never call a model" }, context);
  assert.equal(accepted.ok, true);
  await harness.close(context);
  session = await repo.open(session.metadata, context);
  const server = await nativeHostModels(undefined);
  ({ harness } = await AgentHarness.create({ session, models: server.models, model: server.model }, context));
  lane = await harness.lane("main", context);
  assert.equal((await lane.requestAbort("cold-byok", context)).ok, true);
  const result = await lane.drive({ operationId: "cold-byok", waitForRetry: false }, context);
  assert.equal(result.ok, true);
  assert.equal((await lane.getResult("cold-byok", context))?.status, "aborted");
  await harness.close(context);
  await repo.close(context);
});
