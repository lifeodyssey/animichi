// A stand-in for a real pi provider stream, used by the W0-S1 abort tests
// (#1244). It is a double, not a fake-that-always-succeeds: it drives the real
// `Agent` loop, it really emits a tool call and waits for the tool result
// before answering, and it really terminates with an `aborted` error frame the
// moment its signal is aborted — which is what every shipped pi adapter does.
// A double that ignored the signal would make the abort tests pass for the
// wrong reason.

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

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function baseMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: USAGE,
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

function toolCallScript(base: AssistantMessage): Script {
  const toolCall = {
    type: "toolCall" as const,
    id: DOUBLE_TOOL_CALL_ID,
    name: "lookup_spot",
    arguments: { title: "Hyouka" },
  };
  const partial: AssistantMessage = { ...base, content: [toolCall] };
  return async (push, gap) => {
    push({ type: "start", partial: base });
    await gap();
    push({ type: "toolcall_start", contentIndex: 0, partial });
    await gap();
    push({ type: "toolcall_delta", contentIndex: 0, delta: '{"title":"Hyouka"}', partial });
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
