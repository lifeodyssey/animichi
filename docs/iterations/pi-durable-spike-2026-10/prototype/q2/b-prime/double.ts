/**
 * The repository's hand-written provider double (`workers/edge/test/doubles/pi-provider-double.ts`), ported from pi-ai
 * 0.87.1's `streamFn` to pi-ai 1.5.2's provider interface (`createProvider`, `dist/models.d.ts:222-263`). It keeps the
 * original's three truthful behaviours, chosen by the user's text, and adds the two part B needs:
 * - usage only when asked (`:58-70` there): a model whose compat sets `supportsUsageInStreaming: false` gets no usage,
 *   as an unasked OpenAI-compatible gateway sends none;
 * - a 4xx thrown out of the adapter before any stream exists (`:202-210` there), `fail-4xx:`;
 * - an `aborted` frame the moment the signal aborts (`:95-120` there);
 * - added: a failed attempt as an error frame carrying usage, `fail-frame:`;
 * - added: `interrupt:`, a slow answer whose partial frames carry no usage and whose final frame carries it. pi-ai's
 *   OpenAI-compatible adapter sets usage only from a chunk that carries one (`dist/api/openai-completions.js:349-351`),
 *   so a kill mid-stream leaves Pi a stored partial with what a gateway that sends usage after the content had sent:
 *   none.
 * Every other turn (`turn:`) calls `translate_anime_title` (whose result carries its own usage), then answers.
 */
import { createAssistantMessageEventStream, createProvider, type Api, type AssistantMessage, type AssistantMessageEvent, type AssistantMessageEventStream,
  type Message, type Model } from "@earendil-works/pi-ai";

type Recorder = (kind: string, detail?: unknown) => void;
type Push = (event: AssistantMessageEvent) => void;
type Script = (push: Push, gap: (ms?: number) => Promise<void>) => Promise<void>;

export const DOUBLE_PROVIDER = "spike-double";
const API = "spike-double";
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
export const REPORTED_USAGE = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: NO_COST };
const SILENT_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: NO_COST };
/** `interrupt:` streams this many deltas, 150 ms apart: about 4.5 s, so a progress commit lands before the kill. */
const SLOW_DELTAS = 30;

const asksForUsage = (compat: unknown) => typeof compat !== "object" || compat === null || (compat as { supportsUsageInStreaming?: unknown }).supportsUsageInStreaming !== false;

function lastUserText(messages: readonly Message[]): string {
  const user = [...messages].reverse().find((message) => message.role === "user");
  const content = user?.role === "user" ? user.content : "";
  return typeof content === "string" ? content : content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function play(script: Script, base: AssistantMessage, signal: AbortSignal | undefined): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const gap = async (ms = 1) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    signal?.throwIfAborted();
  };
  void (async () => {
    try {
      await script((event) => stream.push(event), gap);
      stream.end();
    } catch {
      stream.push({ type: "error", reason: "aborted", error: { ...base, stopReason: "aborted", errorMessage: "Aborted" } });
      stream.end();
    }
  })();
  return stream;
}

const toolCallScript = (base: AssistantMessage, id: string, title: string): Script => async (push, gap) => {
  const toolCall = { type: "toolCall" as const, id, name: "translate_anime_title", arguments: { title, target_language: "zh" } };
  const partial = { ...base, content: [toolCall] };
  push({ type: "start", partial: base });
  await gap();
  push({ type: "toolcall_start", contentIndex: 0, partial });
  await gap();
  push({ type: "toolcall_end", contentIndex: 0, toolCall, partial });
  await gap();
  push({ type: "done", reason: "toolUse", message: { ...partial, stopReason: "toolUse" } });
};

const answerScript = (base: AssistantMessage, text: string): Script => async (push, gap) => {
  const partial = { ...base, content: [{ type: "text" as const, text }] };
  push({ type: "start", partial: base });
  await gap();
  push({ type: "text_start", contentIndex: 0, partial });
  await gap();
  push({ type: "text_delta", contentIndex: 0, delta: text, partial });
  await gap();
  push({ type: "text_end", contentIndex: 0, content: text, partial });
  await gap();
  push({ type: "done", reason: "stop", message: partial });
};

const errorFrameScript = (base: AssistantMessage, message: string): Script => async (push, gap) => {
  push({ type: "start", partial: base });
  await gap();
  push({ type: "error", reason: "error", error: { ...base, stopReason: "error", errorMessage: message } });
};

/** Partials without usage; the final frame with it. */
const slowAnswerScript = (base: AssistantMessage, finalUsage: AssistantMessage["usage"]): Script => async (push, gap) => {
  const silent = { ...base, usage: SILENT_USAGE };
  let text = "";
  push({ type: "start", partial: silent });
  push({ type: "text_start", contentIndex: 0, partial: { ...silent, content: [{ type: "text", text }] } });
  for (let index = 0; index < SLOW_DELTAS; index += 1) {
    await gap(150);
    const delta = `word${String(index)} `;
    text += delta;
    push({ type: "text_delta", contentIndex: 0, delta, partial: { ...silent, content: [{ type: "text", text }] } });
  }
  await gap();
  const final = { ...base, usage: finalUsage, content: [{ type: "text" as const, text }] };
  push({ type: "text_end", contentIndex: 0, content: text, partial: final });
  push({ type: "done", reason: "stop", message: final });
};

export function doubleProvider(record: Recorder) {
  let calls = 0;
  const definitions = [
    { id: "double-reporting", name: "double, usage asked" },
    { id: "double-silent", name: "double, usage not asked", compat: { supportsUsageInStreaming: false } },
  ];
  const models = definitions.map((definition) => ({ ...definition, api: API, provider: DOUBLE_PROVIDER, baseUrl: "https://double.invalid", reasoning: false,
    input: ["text"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 16_384 }));
  const stream = (model: Model<Api>, context: { messages: readonly Message[] }, options?: { signal?: AbortSignal }): AssistantMessageEventStream => {
    calls += 1;
    const user = lastUserText(context.messages);
    const mode = /^([a-z0-9-]+):/.exec(user)?.[1] ?? "turn";
    const lastRole = context.messages.at(-1)?.role ?? null;
    const usage = asksForUsage((model as { compat?: unknown }).compat) ? REPORTED_USAGE : SILENT_USAGE;
    const base: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() };
    record("double:request", { call: calls, mode, lastRole, model: model.id });
    if (mode === "fail-4xx") throw new Error("400 Bad Request: the gateway rejected the request shape");
    if (mode === "fail-frame") return play(errorFrameScript(base, "400 invalid_request_error: the gateway rejected the request"), base, options?.signal);
    if (mode === "interrupt") return play(slowAnswerScript(base, usage), base, options?.signal);
    if (lastRole === "toolResult") return play(answerScript(base, `Answer to ${user}`), base, options?.signal);
    return play(toolCallScript(base, `call-${String(calls)}`, user), base, options?.signal);
  };
  const provider = createProvider({ id: DOUBLE_PROVIDER, auth: { apiKey: { name: "Double", resolve: () => Promise.resolve({ auth: {} }) } },
    models: models as never, api: { stream: stream as never, streamSimple: stream as never } });
  return { provider, calls: () => calls, model: (id: "double-reporting" | "double-silent") => ({ provider: DOUBLE_PROVIDER, modelId: id }) };
}
