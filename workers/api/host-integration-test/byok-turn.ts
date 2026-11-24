import { once } from "node:events";
import type { TestContext } from "node:test";
import type { Miniflare } from "miniflare";
import { chatBody, chatHeaders } from "./default-worker.ts";
import type { DriveReport } from "./configured-operations.worker.ts";
import { pool } from "./postgres.ts";

/** A signed-in member: only a member may bring a key. */
export const MEMBER = { TEST_IDENTITY: "member-native", TEST_USER_TYPE: "user" };
export const CHAT = "https://host.test/v1/chat";
/** The production SessionAgent, observed around each drive (`configured-operations.worker.ts`). */
export const OBSERVED_HOST = new URL("./configured-operations.worker.ts", import.meta.url);
const USAGE = { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 };

/** A member's chat turn that brings its own OpenAI-compatible key. */
export function byokTurn(key: string, body = chatBody) {
  return { method: "POST", body, headers: { ...chatHeaders, "x-byok-provider": "openai-compatible",
    "x-byok-base-url": "https://api.openai.com/v1", "x-byok-model": "gpt-4.1", "x-byok-key": key } };
}

/** A chat body whose one user message says `text`. */
export function chatSaying(text: string) {
  return JSON.stringify({ messages: [{ id: "user", role: "user", parts: [{ type: "text", text }] }] });
}

/** Resolves true once a settlement commits; the listener is armed before the turn is sent. */
export async function settlementCommit(context: TestContext) {
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
  return { settled: once(observer, "notification", { signal }).then(() => true, () => false) };
}

/** A text chunk of a provider answer. */
export function textChunk(content: string) {
  return { choices: [{ index: 0, delta: { content }, finish_reason: null }] };
}

/** The chunk that opens a respond call, carrying `argumentsText`, the raw JSON a provider streams. */
export function respondStart(argumentsText: string) {
  const call = { index: 0, id: "answer", type: "function", function: { name: "respond", arguments: argumentsText } };
  return { choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: null }] };
}

/** The chunk that ends a provider answer, carrying the rest of the open respond call's raw JSON arguments. */
export function argumentsEnd(argumentsText: string) {
  return { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argumentsText } }] }, finish_reason: "tool_calls" }], usage: USAGE };
}

/** The chunk that ends a provider answer by calling respond whole. */
export function respondChunk() {
  const call = { index: 0, id: "answer", type: "function", function: { name: "respond", arguments: JSON.stringify({ kind: "greeting", message: "Done" }) } };
  return { choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: "tool_calls" }], usage: USAGE };
}

/** An OpenAI-compatible event stream of `chunks`, the way the provider double answers. */
export function completionStream(chunks: readonly object[]) {
  const events = chunks.map((chunk) => `data: ${JSON.stringify({ id: "echo", object: "chat.completion.chunk", created: 0, model: "gpt-4.1", ...chunk })}\n\n`);
  return new Response(`${events.join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

/** The observed host's drives and its last drive's provider, read once the work it has queued has finished. */
export async function driveReport(worker: Miniflare) {
  const response = await worker.dispatchFetch("https://host.test/drive-report", { headers: chatHeaders });
  return await response.json() as DriveReport;
}
