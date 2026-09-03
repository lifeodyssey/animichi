// A stand-in for a real pi provider stream, used by the W0-S1 abort tests
// (#1244) and the W0-S2 compat measurements (#1245). It is a double, not a
// fake-that-always-succeeds: it drives the real `Agent` loop, it really emits a
// tool call and waits for the tool result before answering, and it really
// terminates with an `aborted` error frame the moment its signal is aborted —
// which is what every shipped pi adapter does. A double that ignored the signal
// would make the abort tests pass for the wrong reason.
//
// W0-S2 (#1245) added three truthful behaviours, all mirroring a real
// OpenAI-compatible gateway: usage arrives only when the model's compat leaves
// `supportsUsageInStreaming` alone, because pi sends
// `stream_options: { include_usage: true }` exactly then (pi-ai
// `dist/api/openai-completions.js:594`) and an unasked gateway sends none; and a
// gateway that rejects the request shape throws out of the adapter rather than
// streaming an error frame (`client.chat.completions.create` throws on a 4xx),
// either on the first request or on the second one that replays the tool
// result.

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

type Push = (event: AssistantMessageEvent) => void;
type Gap = () => Promise<void>;
type Script = (push: Push, gap: Gap) => Promise<void>;

export const DOUBLE_ANSWER = "Hyouka fans go to Takayama.";
export const DOUBLE_TOOL_CALL_ID = "call-1";

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

const REPORTED_USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: NO_COST,
};

const SILENT_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: NO_COST,
};

function asksForUsage(compat: unknown): boolean {
  if (typeof compat !== "object" || compat === null) return true;
  return (compat as { supportsUsageInStreaming?: unknown }).supportsUsageInStreaming !== false;
}

function baseMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: asksForUsage(model.compat) ? REPORTED_USAGE : SILENT_USAGE,
    stopReason: "stop",
    timestamp: 0,
  };
}

class ScriptedProviderStream {
  private readonly stream: AssistantMessageEventStream = createAssistantMessageEventStream();
  private readonly base: AssistantMessage;
  private readonly signal: AbortSignal | undefined;

  constructor(base: AssistantMessage, signal: AbortSignal | undefined) {
    this.base = base;
    this.signal = signal;
  }

  run(script: Script): AssistantMessageEventStream {
    void this.play(script);
    return this.stream;
  }

  private async play(script: Script): Promise<void> {
    try {
      await script(
        (event) => {
          this.stream.push(event);
        },
        () => this.gap(),
      );
      this.stream.end();
    } catch {
      this.endAborted();
    }
  }

  /** One scheduler turn between frames, then honour the caller's signal. */
  private async gap(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.signal?.throwIfAborted();
  }

  private endAborted(): void {
    const error: AssistantMessage = {
      ...this.base,
      stopReason: "aborted",
      errorMessage: "Aborted",
    };
    this.stream.push({ type: "error", reason: "aborted", error });
    this.stream.end();
  }
}

/** One tool call a scripted turn issues. */
export interface ScriptedToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

const DOUBLE_SPOT_CALL: ScriptedToolCall = { name: "lookup_spot", arguments: { title: "Hyouka" } };

function toolCallScript(base: AssistantMessage, call: ScriptedToolCall = DOUBLE_SPOT_CALL, id = DOUBLE_TOOL_CALL_ID): Script {
  const toolCall = {
    type: "toolCall" as const,
    id,
    name: call.name,
    arguments: call.arguments,
  };
  const partial: AssistantMessage = { ...base, content: [toolCall] };
  return async (push, gap) => {
    push({ type: "start", partial: base });
    await gap();
    push({ type: "toolcall_start", contentIndex: 0, partial });
    await gap();
    push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(call.arguments), partial });
    await gap();
    push({ type: "toolcall_end", contentIndex: 0, toolCall, partial });
    await gap();
    push({ type: "done", reason: "toolUse", message: { ...partial, stopReason: "toolUse" } });
  };
}

function answerScript(base: AssistantMessage): Script {
  const partial: AssistantMessage = {
    ...base,
    content: [{ type: "text", text: DOUBLE_ANSWER }],
  };
  return async (push, gap) => {
    push({ type: "start", partial: base });
    await gap();
    push({ type: "text_start", contentIndex: 0, partial });
    await gap();
    push({ type: "text_delta", contentIndex: 0, delta: DOUBLE_ANSWER, partial });
    await gap();
    push({ type: "text_end", contentIndex: 0, content: DOUBLE_ANSWER, partial });
    await gap();
    push({ type: "done", reason: "stop", message: partial });
  };
}

/**
 * Returns a `streamFn` that calls the tool on its first invocation and answers
 * on the second — the shortest transcript that still visits all three break
 * points.
 */
export function makeToolCallingStreamFn() {
  let calls = 0;
  return (model: Model<Api>, _context: Context, options?: SimpleStreamOptions) => {
    const base = baseMessage(model);
    calls += 1;
    const script = calls === 1 ? toolCallScript(base) : answerScript(base);
    return new ScriptedProviderStream(base, options?.signal).run(script);
  };
}

/**
 * A `streamFn` that issues `calls` one per model turn, in order, then answers.
 *
 * The single-call `makeToolCallingStreamFn` above is the abort suite's script;
 * this one exists because a turn that hands a REF from one tool to the next
 * needs two calls in one run to be a real sequence rather than two test cases.
 */
export function makeSequencedToolCallsStreamFn(calls: readonly ScriptedToolCall[]) {
  let turn = 0;
  return (model: Model<Api>, _context: Context, options?: SimpleStreamOptions) => {
    const base = baseMessage(model);
    const call = calls[turn];
    turn += 1;
    const script = call ? toolCallScript(base, call, `${DOUBLE_TOOL_CALL_ID}-${String(turn)}`) : answerScript(base);
    return new ScriptedProviderStream(base, options?.signal).run(script);
  };
}

/**
 * A gateway that rejects the request shape: the OpenAI client throws on a 4xx
 * before any stream exists, which pi turns into `state.errorMessage`.
 */
export function makeRejectedRequestStreamFn(message: string) {
  return (): never => {
    throw new Error(message);
  };
}

/**
 * A gateway that accepts the tool call but rejects the follow-up request
 * carrying the tool result. That second request is where
 * `requiresToolResultName` and `requiresAssistantAfterToolResult` change the
 * wire shape, so it is the failure mode the S2 matrix is looking for: a tool
 * call that succeeded and an answer that never came.
 */
export function makeToolResultRejectingStreamFn(message: string) {
  let calls = 0;
  return (model: Model<Api>, _context: Context, options?: SimpleStreamOptions) => {
    calls += 1;
    if (calls > 1) throw new Error(message);
    const base = baseMessage(model);
    return new ScriptedProviderStream(base, options?.signal).run(toolCallScript(base));
  };
}
