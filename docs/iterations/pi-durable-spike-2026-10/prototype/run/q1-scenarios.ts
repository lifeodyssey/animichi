/** Question 1's scenarios. Each returns what it observed; `q1.ts` checks it and writes the evidence. */
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import type { Bundle } from "./bundle.ts";
import { OutboundGuard, WorkerdLog, startWorkerd, withTimeout } from "./workerd.ts";

export interface Event { readonly seq: number; readonly instance: string; readonly kind: string; readonly detail: unknown; readonly at: number }
interface Message { readonly role: string; readonly content?: string | { type: string; text?: string; name?: string; arguments?: unknown }[]; readonly toolName?: string; readonly isError?: boolean; readonly usage?: unknown }
interface Entry { readonly id: number; readonly kind: string; readonly model?: Message[] }
interface Report { readonly instance: string; readonly result: unknown; readonly pending: unknown[]; readonly messages: Entry[]; readonly events: Event[] }

export interface Step { readonly id: number; readonly kind: string; readonly text?: string; readonly toolCalls?: unknown[]; readonly toolName?: string; readonly isError?: boolean; readonly usage?: unknown }

const DURABLE_OBJECTS = { SAFE: { className: "SafeProbe", useSQLite: true as const }, UNSAFE: { className: "UnsafeProbe", useSQLite: true as const } };

function textOf(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((part) => (part.type === "text" ? part.text ?? "" : "")).join("");
}

/** Pi's entries, reduced to what question 1 reads: who spoke, the tool calls, and each tool result. */
export function summarize(messages: Entry[]): Step[] {
  return messages.map((entry) => {
    const message = entry.model?.[0];
    const calls = Array.isArray(message?.content) ? message.content.filter((part) => part.type === "toolCall") : [];
    const toolCalls = calls.map((part) => ({ name: part.name, arguments: part.arguments }));
    if (message?.role === "toolResult") return { id: entry.id, kind: entry.kind, toolName: message.toolName, isError: message.isError, text: textOf(message.content) };
    // Each assistant entry keeps the usage of its own model call; question 3's settlement plan reads it from here.
    const usage = message?.role === "assistant" ? { usage: message.usage } : {};
    return { id: entry.id, kind: entry.kind, ...(toolCalls.length > 0 ? { toolCalls } : { text: textOf(message?.content) }), ...usage };
  });
}

export class Scenarios {
  readonly #built: Bundle;
  readonly #work: string;
  readonly log = new WorkerdLog();
  readonly guard = new OutboundGuard();

  constructor(built: Bundle, work: string) {
    this.#built = built;
    this.#work = work;
  }

  #start(run: string, persist: string): Miniflare {
    return startWorkerd(this.#built, { run, persist: join(this.#work, persist), log: this.log, guard: this.guard, durableObjects: DURABLE_OBJECTS });
  }

  async #call<T>(mf: Miniflare, path: string, body: unknown = {}): Promise<T> {
    const response = await mf.dispatchFetch(`https://probe.test${path}`, { method: "POST", body: JSON.stringify(body) });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`${path} answered ${String(response.status)}: ${text}`);
    return JSON.parse(text) as T;
  }

  /** One turn with no eviction, then the runtime probes from inside the same object. */
  async plainTurn(name: string, title: string) {
    const mf = this.#start(name, `persist-${name}`);
    try {
      const operationId = `${name}-1`;
      const receipt = await this.#call(mf, `/safe/${name}/submit`, { title, operationId });
      const result = await withTimeout(this.#call(mf, `/safe/${name}/wait`, { operationId }), 60_000, `the ${name} turn`);
      const report = await this.#call<Report>(mf, `/safe/${name}/report`, { operationId });
      const probes = await this.#call(mf, `/safe/${name}/probes`);
      return { title, operationId, receipt, result, catalogCalls: this.guard.calls(title), transcript: summarize(report.messages), events: report.events, probes };
    } finally {
      await mf.dispose();
    }
  }

  /**
   * Submit, wait until the tool's catalog call is in flight (the guard holds it), SIGKILL workerd, start a new workerd
   * over the same persisted directory and send nothing until the restarted object has answered.
   */
  async evictDuringToolCall(binding: "safe" | "unsafe", title: string) {
    const hold = this.guard.holdFirstCall(title);
    const operationId = `${binding}-evict-1`;
    const first = this.#start(`${binding}:A`, `persist-${binding}`);
    const receipt = await this.#call(first, `/${binding}/evict/submit`, { title, operationId });
    const inFlightAt = await withTimeout(hold.inFlight, 60_000, `the ${binding} tool's first catalog call`);
    // Kill only once the wake job has run on A and its 30 s heartbeat re-arm is durable, so every run takes the same
    // path. The log line precedes the commit, so a kill right after it can still find the due-now alarm `submit`
    // pushed, and workerd B then fires that at once. The tool call stays held through the wait.
    const armedAt = (await this.log.waitFor(`${binding}:A`, /\[spike\] alarm /, 30_000, `the ${binding} wake job's first alarm on A`)).at;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const killedAt = Date.now();
    await first.dispose();
    hold.release();
    const second = this.#start(`${binding}:B`, `persist-${binding}`);
    await second.ready;
    const restartedAt = Date.now();
    const answer = await this.log.waitFor(`${binding}:B`, /\[spike\] model:answer /, 150_000, `the restarted ${binding} object's answer`);
    const firstRequestAt = Date.now();
    try {
      const report = await this.#call<Report>(second, `/${binding}/evict/report`, { operationId });
      return { binding, title, operationId, receipt, inFlightAt, armedAt, killedAt, restartedAt, answerLoggedAt: answer.at, firstRequestAt,
        catalogCalls: this.guard.catalogCalls.filter((call) => call.title === title), result: report.result, pending: report.pending,
        transcript: summarize(report.messages), events: report.events };
    } finally {
      await second.dispose();
    }
  }

  /** Way 11's negative control, run last: the worker asks for a host that is not the catalog. */
  async guardSelfTest() {
    const mf = this.#start("guard", "persist-guard");
    try {
      return { response: await this.#call(mf, "/guard"), violations: [...this.guard.violations] };
    } finally {
      await mf.dispose();
    }
  }
}
