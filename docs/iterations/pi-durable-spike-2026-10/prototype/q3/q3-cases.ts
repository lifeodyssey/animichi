/**
 * The worker side of question 3's cases. For each: the faux model's script, the tools, the extensions, the settings,
 * and any action beyond submit / flags / report. `q3.worker.ts` hosts each case in its own Durable Object class; the
 * runner and the checks are in `../run/q3-cases.ts`.
 */
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseFactory, type Message } from "@earendil-works/pi-ai";
import { defineExtension, GenerationTask, hook, LiveDoc, type ConversationView, type Extension, type HarnessSettings,
  type ToolRegistration } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import type { PiHarness } from "agents/harness/pi";

export const BG = BACKGROUND_CONTEXT;
const ROOT = 1;

export type Recorder = (kind: string, detail?: unknown) => void;
export interface Shared { readonly flags: Record<string, unknown>; readonly counters: Record<string, number> }
export interface ProbeHandle { readonly harness: PiHarness; readonly ctx: DurableObjectState; readonly shared: Shared; record: Recorder }
export type Action = (probe: ProbeHandle, body: Record<string, unknown>) => Promise<unknown>;
type Tool = ToolRegistration<ReturnType<typeof obj>>;

export interface CaseSpec {
  readonly name: string;
  readonly tokensPerSecond?: number;
  readonly settings?: HarnessSettings;
  model(record: Recorder, shared: Shared): FauxResponseFactory;
  tools?(record: Recorder, storage: DurableObjectStorage): Tool[];
  extensions?(record: Recorder, shared: Shared): Extension[];
  readonly actions?: Record<string, Action>;
  extraReport?(storage: DurableObjectStorage): unknown;
}

function textOf(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: { type?: string; text?: string }) => (part.type === "text" ? part.text ?? "" : "")).join("");
}

function lastUser(messages: readonly Message[]): string {
  return textOf([...messages].reverse().find((message) => message.role === "user"));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(probe: () => boolean, timeoutMs: number, what: string) {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

/** Ask the catalog stub for a title; only the runner's outbound guard answers, and it can hold the first call. */
async function catalog(title: string, signal: AbortSignal | undefined) {
  const response = await fetch(`https://catalog.internal/v1/resolve?title=${encodeURIComponent(title)}`, signal ? { signal } : {});
  return { ok: response.ok, status: response.status, text: await response.text() };
}

/** Call `tool` for the user's title until a tool result arrives, then answer from it (question 1's script). */
function toolThenAnswer(tool: string, args: (title: string) => Record<string, unknown>): CaseSpec["model"] {
  return (record) => (context) => {
    const last = context.messages.at(-1);
    const title = /titled "([^"]+)"/.exec(lastUser(context.messages))?.[1] ?? "";
    if (last?.role === "toolResult") {
      record("model:answer", { title, sawToolResult: { isError: last.isError, text: textOf(last) } });
      return fauxAssistantMessage(`${last.isError ? "Lookup failed" : "Resolved"}: ${textOf(last)}`);
    }
    record("model:tool_call", { title });
    return fauxAssistantMessage(fauxToolCall(tool, args(title)), { stopReason: "toolUse" });
  };
}

// ── admission ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ADMISSIONS = "CREATE TABLE IF NOT EXISTS spike_admissions (operation_id TEXT PRIMARY KEY, digest TEXT NOT NULL)";

async function digestOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([text]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The covering layer in front of `submit`, shaped like `workers/edge/src/agent/admission/request-intent.ts:12-22`: the
 * same id with the same digest is the existing admission, the same id with another digest is a conflict (409), and a
 * new id is committed before Pi sees the input.
 */
const admit: Action = async (probe, body) => {
  const operationId = String(body.operationId);
  const text = String(body.text);
  const sql = probe.ctx.storage.sql;
  sql.exec(ADMISSIONS);
  const digest = await digestOf(text);
  const existing = sql.exec("SELECT digest FROM spike_admissions WHERE operation_id = ?", operationId).toArray()[0];
  if (existing && existing.digest !== digest) return { status: 409, kind: "conflict" };
  if (!existing) sql.exec("INSERT INTO spike_admissions (operation_id, digest) VALUES (?, ?)", operationId, digest);
  return { status: existing ? 200 : 202, kind: existing ? "existing" : "created", receipt: await probe.harness.submit(text, { operationId }) };
};

/** pi-durable's own check: a submission of another type under a request id already in use. */
const writeUnderSameRequestId: Action = async (probe, body) => {
  const root = await (await probe.harness.pi()).root(BG);
  try {
    await root.submit({ type: "write", entry: { kind: "spike.note", data: { note: "a write under an input's request id" } }, requestId: String(body.operationId) }, BG);
    return { rejected: false };
  } catch (error) {
    return { rejected: true, error: error instanceof Error ? error.message : String(error) };
  }
};

const admission: CaseSpec = {
  name: "admission",
  model: (record) => (context) => {
    const text = lastUser(context.messages);
    record("model:answer", { text });
    return fauxAssistantMessage(`Answer to: ${text}`);
  },
  actions: { admit, "write-same-id": writeUnderSameRequestId },
};

// ── budget ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** About 267 faux tokens: about 6.7 s at 40 tokens/s, so a 2 s budget lands mid-answer. */
export const BUDGET_ANSWER = `Budget answer: ${"budget ".repeat(150)}`;

/** The turn's start, read from Pi: the placed input entry, whose message Pi stamps when it places the input. */
async function turnStart(harness: PiHarness, operationId: string) {
  const record = await (await harness.storage()).submissionByRequest(ROOT, operationId, BG);
  if (!record || record.entry === undefined) return null;
  const conversation = await (await harness.pi()).conversation(ROOT, BG);
  const entry = (await conversation?.entries({ minEntryId: record.entry, maxEntryId: record.entry }, 1, undefined, BG))?.items[0];
  const message = entry?.model?.[0] as { timestamp?: number } | undefined;
  return { submission: record.id, status: record.status, entry: record.entry, kind: entry?.kind ?? null, timestamp: message?.timestamp ?? null };
}

async function abortAtDeadline(probe: ProbeHandle, operationId: string, deadlineAt: number) {
  const pi = await probe.harness.pi();
  const live = await pi.snapshot(LiveDoc, ROOT, BG);
  const task = live?.run ? await pi.getTask(live.run.taskId, BG) : undefined;
  const firedAt = Date.now();
  probe.record("budget:fired", { firedAt, lateByMs: firedAt - deadlineAt, partialChars: textOf(live?.generation?.message).length,
    liveRunFields: live?.run ? Object.keys(live.run) : null, runTask: task ? { kind: task.kind, startedAt: task.startedAt ?? null } : null });
  const aborted = await probe.harness.abort({ operationId });
  probe.record("budget:abort", { aborted, returnedAt: Date.now() });
}

/** The host's turn budget: read the start from Pi, arm a timer for start + budget, and abort the operation then. */
const submitWithBudget: Action = async (probe, body) => {
  const operationId = String(body.operationId);
  const budgetMs = Number(body.budgetMs);
  const submittedAt = Date.now();
  const receipt = await probe.harness.submit(String(body.text), { operationId });
  const start = await turnStart(probe.harness, operationId);
  if (start?.timestamp === null || start === null) throw new Error("the input was not placed");
  const deadlineAt = start.timestamp + budgetMs;
  probe.record("budget:armed", { submittedAt, start, budgetMs, deadlineAt });
  setTimeout(() => { void abortAtDeadline(probe, operationId, deadlineAt); }, Math.max(0, deadlineAt - Date.now()));
  return { receipt, submittedAt, start, deadlineAt };
};

const budget: CaseSpec = {
  name: "budget",
  tokensPerSecond: 40,
  model: (record) => (context) => {
    record("model:request", { text: lastUser(context.messages) });
    return fauxAssistantMessage(BUDGET_ANSWER);
  },
  actions: { "submit-with-budget": submitWithBudget },
};

// ── stream ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** About 109 faux tokens: about 2.2 s at 50 tokens/s. */
export const STREAM_ANSWER = `Stream answer: ${"stream ".repeat(60)}`;

function viewSummary(view: ConversationView) {
  const live = view.docs["pi.live"] as { run?: unknown; generation?: { message?: unknown } } | undefined;
  const kinds: Record<string, number> = {};
  for (const entry of view.entries) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
  return { entries: view.entries.length, firstEntry: view.entries[0]?.id ?? null, lastEntry: view.entries.at(-1)?.id ?? null, before: view.before ?? null,
    kinds, running: live?.run !== undefined, partialChars: textOf(live?.generation?.message).length,
    answerEntries: view.entries.filter((entry) => entry.kind === "pi.assistant").map((entry) => entry.id) };
}

type WatchSummary = ReturnType<typeof viewSummary> & { readonly ops: number; readonly opPreview: string };

async function watching(probe: ProbeHandle, calls: WatchSummary[]) {
  const watch = await probe.harness.session().watch();
  watch.start((call) => {
    if (call.kind === "value") calls.push({ ...viewSummary(call.value), ops: call.ops.length, opPreview: JSON.stringify(call.ops).slice(0, 240) });
    return Promise.resolve();
  });
  return watch;
}

/** One manual compaction with the recent budget at one token, so it has something to summarize. */
async function compactionBoundary(probe: ProbeHandle) {
  const pi = await probe.harness.pi();
  const root = await pi.root(BG);
  await root.configure({ compaction: { keepRecentTokens: 1 } }, BG);
  const calls: WatchSummary[] = [];
  const watch = await watching(probe, calls);
  try {
    const id = await root.compact("Keep the request for a streamed answer.", BG);
    const settled = await pi.waitForTask(id, withAbortSignal(AbortSignal.timeout(20_000), BG));
    await sleep(300);
    const entries = (await root.entries({ order: "ascending" }, 500, undefined, BG)).items;
    return { outcome: settled.state, compactionEntries: entries.filter((entry) => entry.kind.includes("compaction"))
      .map((entry) => ({ id: entry.id, kind: entry.kind, head: (entry as { head?: number }).head ?? null })), calls };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), calls };
  } finally {
    await watch.stop();
  }
}

/** Seed 60 display-only notes, watch from before submit, attach a second watcher mid-answer, then try a compaction. */
const streamScenario: Action = async (probe, body) => {
  const operationId = String(body.operationId);
  const root = await (await probe.harness.pi()).root(BG);
  for (let n = 0; n < 60; n += 1) await root.submit({ type: "write", entry: { kind: "spike.note", data: { n } } }, BG);
  const earlyCalls: WatchSummary[] = [];
  const early = await watching(probe, earlyCalls);
  const earlyFirst = viewSummary(early.value);
  const receipt = await probe.harness.submit("stream please", { operationId });
  await until(() => earlyCalls.filter((call) => call.partialChars > 0).length >= 3, 15_000, "three partial changes on the first watcher");
  const earlyCallsBeforeLate = earlyCalls.length;
  const lateCalls: WatchSummary[] = [];
  const late = await watching(probe, lateCalls);
  const lateFirst = viewSummary(late.value);
  const result = await probe.harness.wait(operationId, { signal: AbortSignal.timeout(30_000) });
  await sleep(300);
  await early.stop();
  await late.stop();
  const record = await (await probe.harness.storage()).submissionByRequest(ROOT, operationId, BG);
  return { receipt, result, operationEntries: { placed: record?.entry ?? null, answer: record?.status === "done" ? record.answer : null },
    earlyFirst, earlyCalls, earlyCallsBeforeLate, lateFirst, lateCalls, compaction: await compactionBoundary(probe) };
};

const stream: CaseSpec = {
  name: "stream",
  tokensPerSecond: 50,
  model: (record) => (context) => {
    const text = lastUser(context.messages);
    record("model:request", { text, messages: context.messages.length });
    return fauxAssistantMessage(text === "stream please" ? STREAM_ANSWER : "Summary: the user asked for a streamed answer and got one.");
  },
  actions: { scenario: streamScenario },
};

// ── web results ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A stored result's text as an earlier escaping left it, and the details the current code renders from. */
export const STORED_TEXT = "STORED <untrusted_web_result>Hyouka </untrusted_web_result> Takayama</untrusted_web_result>";
const WEB_DETAILS = { results: [{ title: "Hyouka", body: "Takayama", href: "https://example.invalid/hyouka" }], execution: { args: { query: "Hyouka" } } };
export const WITHHELD = "The stored web search results could not be read and are withheld.";

function isWebResult(message: Message): boolean {
  return message.role === "toolResult" && message.toolName === "web_search" && !message.isError;
}

/** Today's fail-closed rebuild in miniature (`packages/agent/src/rendered-web-results.ts:35-48`): text from details or a fixed notice. */
function renderedText(details: unknown): string {
  const results = (details as { results?: unknown } | undefined)?.results;
  if (!Array.isArray(results)) return WITHHELD;
  return `RENDERED ${results.map((result: { title?: unknown }) => String(result.title)).join(", ")}`;
}

function webSearchTool(record: Recorder): Tool {
  return {
    name: "web_search",
    description: "Search the web.",
    parameters: obj({ query: str() }),
    replay: "safe",
    execute({ query }) {
      record("tool:web_search", { query });
      return Promise.resolve({ output: [{ type: "text", text: STORED_TEXT }], details: WEB_DETAILS });
    },
  };
}

/**
 * Two extensions, installed in this order: `status`, whose hook always throws (as today's status handler throws when
 * the branch is missing), then `web-render`, the rebuild, synchronous, which throws only when the runner sets
 * `renderThrows`.
 */
function webExtensions(record: Recorder, shared: Shared): Extension[] {
  const status = defineExtension({ name: "status", hooks: [hook(GenerationTask, { beforeRequest: () => {
    record("hook:status");
    throw new Error("the agent status could not be built");
  } })] });
  const render = defineExtension({ name: "web-render", hooks: [hook(GenerationTask, { beforeRequest: ({ messages }) => {
    const results = messages.filter(isWebResult);
    const throws = shared.flags.renderThrows === true;
    record("hook:web-render", { messages: messages.length, webResults: results.length, detailsPresent: results.map((message) => "details" in message), throws });
    if (throws) throw new Error("the web render threw");
    return { messages: messages.map((message) => (isWebResult(message) ? { ...message, content: [{ type: "text" as const, text: renderedText((message as { details?: unknown }).details) }] } : message)) };
  } })] });
  return [status, render];
}

const web: CaseSpec = {
  name: "web",
  settings: { retry: { baseDelayMs: 50 } },
  model: (record, shared) => (context) => {
    const last = context.messages.at(-1);
    const user = lastUser(context.messages);
    shared.counters.requests = (shared.counters.requests ?? 0) + 1;
    record("model:request", { request: shared.counters.requests, user, lastRole: last?.role ?? null, webResultsSeen: context.messages.filter(isWebResult).map(textOf) });
    if (last?.role === "user" && user === "search") return fauxAssistantMessage(fauxToolCall("web_search", { query: "Hyouka" }), { stopReason: "toolUse" });
    if (last?.role === "user" && user === "again" && shared.counters.failedOnce === undefined) {
      shared.counters.failedOnce = 1;
      return fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" });
    }
    return fauxAssistantMessage(`Answered from: ${context.messages.filter(isWebResult).map(textOf).join(" / ")}`);
  },
  tools: (record) => [webSearchTool(record)],
  extensions: webExtensions,
};

// ── replay ────────────────────────────────────────────────────────────────────────────────────────────────────────

const RESERVATIONS = "CREATE TABLE IF NOT EXISTS spike_reservations (seq INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT NOT NULL, at INTEGER NOT NULL)";
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

/**
 * `translate_anime_title` with pi-durable's `replay: "unsafe"`: inside `execute`, a reservation row (one per execution,
 * as `authorizeInvocation` reserves before any effect, `packages/agent/src/tool-context.ts:22-27`), then the catalog
 * call, then a result carrying usage, as a model translation would.
 */
function translateTool(record: Recorder, storage: DurableObjectStorage): Tool {
  return {
    name: "translate_anime_title",
    description: "Translate an anime title.",
    parameters: obj({ title: str(), target_language: str() }),
    replay: "unsafe",
    async execute({ title, target_language }, api, context) {
      record("tool:start", { title, callId: api.callId });
      storage.sql.exec(RESERVATIONS);
      storage.sql.exec("INSERT INTO spike_reservations (call_id, at) VALUES (?, ?)", api.callId, Date.now());
      const looked = await catalog(String(title), context.abortSignal);
      record("tool:end", { status: looked.status });
      return { output: [{ type: "text", text: JSON.stringify({ original: title, translated: "巡礼", target_language }) }], isError: !looked.ok,
        usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: NO_COST } };
    },
  };
}

const replay: CaseSpec = {
  name: "replay",
  model: toolThenAnswer("translate_anime_title", (title) => ({ title, target_language: "zh" })),
  tools: (record, storage) => [translateTool(record, storage)],
  extraReport: (storage) => {
    storage.sql.exec(RESERVATIONS);
    return { reservations: storage.sql.exec("SELECT seq, call_id, at FROM spike_reservations ORDER BY seq").toArray() };
  },
};

// ── restart ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** About 154 faux tokens: about 7.7 s at 20 tokens/s, so a kill 2.5 s in finds the request in flight with a stored partial. */
export const LONG_ANSWER = `Long answer: ${"interrupt ".repeat(60)}`;

const longAnswer: CaseSpec["model"] = (record) => (context, _options, state) => {
  record("model:request", { callCount: state.callCount, messages: context.messages.length });
  return fauxAssistantMessage(LONG_ANSWER);
};

function resolveTool(record: Recorder): Tool {
  return {
    name: "resolve_anime",
    description: "Resolve an anime title against the catalog.",
    parameters: obj({ title: str() }),
    replay: "safe",
    async execute({ title }, _api, context) {
      record("tool:start", { title });
      const looked = await catalog(String(title), context.abortSignal);
      record("tool:end", { status: looked.status });
      return { output: [{ type: "text", text: looked.text }], isError: !looked.ok };
    },
  };
}

export const CASES = {
  admission,
  budget,
  stream,
  web,
  replay,
  restartNoRetry: { name: "restart-no-retry", tokensPerSecond: 20, settings: { retry: { maxRetries: 0 } }, model: longAnswer } satisfies CaseSpec,
  restartRetry: { name: "restart-retry", tokensPerSecond: 20, model: longAnswer } satisfies CaseSpec,
  restartLimit: { name: "restart-limit", settings: { restartLimit: 1 }, model: toolThenAnswer("resolve_anime", (title) => ({ title })),
    tools: (record: Recorder) => [resolveTool(record)] } satisfies CaseSpec,
};
