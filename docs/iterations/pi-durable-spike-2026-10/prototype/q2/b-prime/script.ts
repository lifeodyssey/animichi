/**
 * Route (b′)'s faux model and tools. Two turn shapes, chosen by the user's text:
 * - `respond: <text>`: the baseline's shape (`workers/edge/host-integration-test/default-worker.ts:31-35`), one model
 *   request calling a `respond` tool whose result ends the run (`control.terminate`), so no second request follows;
 * - `Resolve the anime titled "<title>"`: question 1's turn, `resolve_anime` against the stubbed catalog, then an answer.
 * The model reads the transcript it is handed, so a restarted object continues the same script.
 */
import { fauxAssistantMessage, fauxToolCall, type FauxResponseFactory, type Message } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";

export type Recorder = (kind: string, detail?: unknown) => void;
export type Replay = "safe" | "unsafe";

const ResolveAnime = obj({ title: str() });
const Respond = obj({ message: str() });
/** About 100 extra faux tokens on an answer, streamed at the class's rate. */
const LONG_TAIL = ` ${"streamed ".repeat(100)}`;

function textOf(message: Message | undefined): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: { type?: string; text?: string }) => (part.type === "text" ? part.text ?? "" : "")).join("");
}

export function lastUser(messages: readonly Message[]): string {
  return textOf([...messages].reverse().find((message) => message.role === "user"));
}

export function model(record: Recorder, longAnswers: boolean): FauxResponseFactory {
  return (context) => {
    const last = context.messages.at(-1);
    const user = lastUser(context.messages);
    const respond = /^respond: ([\s\S]*)$/.exec(user)?.[1];
    if (respond !== undefined && last?.role !== "toolResult") {
      record("model:tool_call", { tool: "respond" });
      return fauxAssistantMessage(fauxToolCall("respond", { message: `${respond}${longAnswers ? LONG_TAIL : ""}` }), { stopReason: "toolUse" });
    }
    const title = /titled "([^"]+)"/.exec(user)?.[1] ?? "";
    if (last?.role === "toolResult") {
      const text = textOf(last);
      record("model:answer", { title, sawToolResult: { isError: (last as { isError?: boolean }).isError, text } });
      return fauxAssistantMessage(`${(last as { isError?: boolean }).isError ? "Lookup failed" : "Resolved"}: ${text}${longAnswers ? LONG_TAIL : ""}`);
    }
    record("model:tool_call", { tool: "resolve_anime", title });
    return fauxAssistantMessage(fauxToolCall("resolve_anime", { title }), { stopReason: "toolUse" });
  };
}

export function tools(replay: Replay, record: Recorder): ToolRegistration<ReturnType<typeof obj>>[] {
  const resolve: ToolRegistration<typeof ResolveAnime> = {
    name: "resolve_anime",
    description: "Resolve an anime title against the catalog.",
    parameters: ResolveAnime,
    replay,
    async execute({ title }, _api, context) {
      record("tool:start", { title, replay });
      const response = await fetch(`https://catalog.internal/v1/resolve?title=${encodeURIComponent(title)}`, context.abortSignal ? { signal: context.abortSignal } : {});
      const text = await response.text();
      record("tool:end", { title, status: response.status });
      return { output: [{ type: "text", text }], isError: !response.ok };
    },
  };
  const respond: ToolRegistration<typeof Respond> = {
    name: "respond",
    description: "Answer the user and end the turn.",
    parameters: Respond,
    replay: "safe",
    execute({ message }) {
      record("tool:respond", { chars: message.length });
      return Promise.resolve({ output: [{ type: "text", text: message }], control: { terminate: true } });
    },
  };
  /** The settlement case's tool: `"unsafe"`, as the migration maps it, and its result carries its own usage, as a model translation's would. */
  const translate: ToolRegistration<typeof Translate> = {
    name: "translate_anime_title",
    description: "Translate an anime title.",
    parameters: Translate,
    replay: "unsafe",
    execute({ title, target_language }) {
      record("tool:translate", { title });
      return Promise.resolve({ output: [{ type: "text", text: JSON.stringify({ original: title, translated: "巡礼", target_language }) }], usage: TOOL_USAGE });
    },
  };
  return [resolve, respond, translate] as ToolRegistration<ReturnType<typeof obj>>[];
}

const Translate = obj({ title: str(), target_language: str() });
export const TOOL_USAGE = { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
