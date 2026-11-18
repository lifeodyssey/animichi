/**
 * Question 1: `PiHarness` (agents 0.33.0) hosting pi-durable 1.5.2 in a SQLite Durable Object, wired as the
 * official `agents/docs/harnesses/pi.md` shows (`Lifecycle.install(this).use(harness)`, the factory passing
 * `onWake` to `Harness.open`, the registry per object). One `resolve_anime` tool reaches the stubbed catalog through
 * the global `fetch`, which only the runner's outbound guard answers. The faux model decides each step from the
 * transcript it is handed, so a restarted instance continues the same script. Every event goes to the object's own
 * storage with a per-instance id, so the report survives the eviction it describes.
 */
import { DurableObject } from "cloudflare:workers";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory, type Message } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type ToolRegistration } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import { PiHarness, type PiHarnessOptions } from "agents/harness/pi";
import { Lifecycle, type LifecycleJobContext } from "agents/lifecycle";
import { runtimeProbes } from "./probes.ts";

type Replay = "safe" | "unsafe";
type Recorder = (kind: string, detail?: unknown) => void;
interface Env { readonly SAFE: DurableObjectNamespace; readonly UNSAFE: DurableObjectNamespace }

/** Arguments the model sends for these titles: one no validator can accept, one a coercing validator turns into "42". */
const PROBE_ARGUMENTS: Record<string, Record<string, unknown>> = { "Validation Probe": {}, "Coercion Probe": { title: 42 } };
const ResolveAnime = obj({ title: str() });
const EVENTS = "CREATE TABLE IF NOT EXISTS spike_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL)";

function prompt(title: string) { return `Resolve the anime titled "${title}".`; }

function titleOf(messages: readonly Message[]): string {
  const user = [...messages].reverse().find((message) => message.role === "user");
  const content = user?.role === "user" ? user.content : "";
  const text = typeof content === "string" ? content : content.map((part) => (part.type === "text" ? part.text : "")).join("");
  return /titled "([^"]+)"/.exec(text)?.[1] ?? "";
}

/** The model: call `resolve_anime` for the user's title, then answer from whatever tool result it is handed. */
function scripted(record: Recorder): FauxResponseFactory {
  return (context) => {
    const last = context.messages.at(-1);
    const title = titleOf(context.messages);
    if (last?.role === "toolResult") {
      const text = last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      record("model:answer", { title, sawToolResult: { isError: last.isError, text } });
      return fauxAssistantMessage(`${last.isError ? "Lookup failed" : "Resolved"}: ${text}`);
    }
    const args = PROBE_ARGUMENTS[title] ?? { title };
    record("model:tool_call", { title, args, sawRole: last?.role ?? null });
    return fauxAssistantMessage(fauxToolCall("resolve_anime", args), { stopReason: "toolUse" });
  };
}

function resolveAnime(replay: Replay, record: Recorder): ToolRegistration<typeof ResolveAnime> {
  return {
    name: "resolve_anime",
    description: "Resolve an anime title against the catalog.",
    parameters: ResolveAnime,
    replay,
    async execute({ title }, _api, context) {
      record("tool:start", { title, replay });
      const url = `https://catalog.internal/v1/resolve?title=${encodeURIComponent(title)}`;
      const response = await fetch(url, context.abortSignal ? { signal: context.abortSignal } : {});
      const text = await response.text();
      record("tool:end", { title, status: response.status });
      return { output: [{ type: "text", text }], isError: !response.ok };
    },
  };
}

/** `PiHarness` unchanged, except that each lifecycle job it runs is written to the event log first. */
class ObservedPiHarness extends PiHarness {
  readonly #record: Recorder;

  constructor(options: PiHarnessOptions, record: Recorder) {
    super(options);
    this.#record = record;
  }

  override onJob(context: LifecycleJobContext) {
    this.#record("job", { id: context.job.id, fn: context.job.fn });
    return super.onJob(context);
  }
}

function probeClass(replay: Replay) {
  return class Probe extends DurableObject<Env> {
    readonly #instance = crypto.randomUUID();
    readonly #faux = fauxProvider();
    readonly registry = createRegistry();
    readonly harness = new ObservedPiHarness({
      harness: ({ storage, context, onWake }) => {
        const models = createModels();
        models.setProvider(this.#faux.provider);
        return Harness.open(storage, { models, registry: this.registry, onWake }, context);
      },
      defaults: { model: this.#faux.getModel() },
    }, (kind, detail) => this.#record(kind, detail));
    readonly lifecycle = Lifecycle.install(this).use(this.harness);

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      ctx.storage.sql.exec(EVENTS);
      const record: Recorder = (kind, detail) => this.#record(kind, detail);
      this.#faux.setResponses(Array.from({ length: 64 }, () => scripted(record)));
      this.registry.install({ name: "spike", tools: [resolveAnime(replay, record)] });
      this.#record("constructed", { replay });
    }

    #record(kind: string, detail?: unknown) {
      this.ctx.storage.sql.exec("INSERT INTO spike_events (instance, kind, detail, at) VALUES (?, ?, ?, ?)",
        this.#instance, kind, JSON.stringify(detail ?? null), Date.now());
      console.log(`[spike] ${kind} instance=${this.#instance}`);
    }

    onStart() { this.#record("start"); }

    onAlarm() { this.#record("alarm"); }

    async onRequest(request: Request): Promise<Response> {
      const action = new URL(request.url).pathname.slice(1);
      const body = request.method === "POST" ? await request.json() as { title?: string; operationId: string } : { operationId: "" };
      this.#record(`request:${action}`, body);
      if (action === "submit") return Response.json(await this.harness.submit(prompt(body.title ?? ""), { operationId: body.operationId }));
      if (action === "wait") return Response.json(await this.harness.wait(body.operationId));
      if (action === "probes") return Response.json(await runtimeProbes());
      return Response.json(await this.#report(body.operationId));
    }

    async #report(operationId: string) {
      const result = await this.harness.wait(operationId, { signal: AbortSignal.timeout(20_000) });
      const events = this.ctx.storage.sql.exec("SELECT seq, instance, kind, detail, at FROM spike_events ORDER BY seq").toArray()
        .map((row) => ({ ...row, detail: JSON.parse(String(row.detail)) as unknown }));
      return { instance: this.#instance, replay, result, pending: await this.harness.pending(), messages: await this.harness.messages(), events };
    }
  };
}

export const SafeProbe = probeClass("safe");
export const UnsafeProbe = probeClass("unsafe");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const [binding, name, action] = new URL(request.url).pathname.split("/").filter((part) => part !== "");
    if (binding === "guard") return guardSelfTest();
    const namespace = binding === "unsafe" ? env.UNSAFE : env.SAFE;
    return namespace.get(namespace.idFromName(name ?? "")).fetch(new Request(`https://probe.internal/${action ?? ""}`, request));
  },
};

/** Way 11's negative control: a request to anything but the stubbed catalog must be refused by the runner's guard. */
async function guardSelfTest(): Promise<Response> {
  try {
    const response = await fetch("https://upstream.invalid/spike-guard-self-test");
    return Response.json({ refused: false, status: response.status });
  } catch (error) {
    return Response.json({ refused: true, error: error instanceof Error ? error.message : String(error) });
  }
}
