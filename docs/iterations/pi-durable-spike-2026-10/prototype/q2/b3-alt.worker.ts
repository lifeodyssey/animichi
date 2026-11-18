/**
 * b3-alt: the card's literal (b) criterion without Postgres. `PiHarness` hosted exactly as question 1 hosts it, except
 * that the factory opens Pi on a second SQLite store in the same object, under its own table prefix (`alt_`), so it is
 * not the store `_doOpen` prepared (`agents@0.33.0 dist/harness/pi/index.js:449`). The runner SIGKILLs workerd during
 * the tool call and sends nothing until the restarted object has answered. The report reads the operation three ways:
 * through `PiHarness`'s `wait()` (which reads its own store), through Pi from the alt store, and as rows per prefix.
 */
import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory, type Message } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type Storage, type ToolRegistration } from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import { obj, str } from "@earendil-works/pi-schema";
import { PiHarness, type PiHarnessOptions } from "agents/harness/pi";
import { Lifecycle, type LifecycleJobContext } from "agents/lifecycle";

type Replay = "safe" | "unsafe";
type Recorder = (kind: string, detail?: unknown) => void;
interface Env { readonly SAFE: DurableObjectNamespace; readonly UNSAFE: DurableObjectNamespace }

const BG = BACKGROUND_CONTEXT;
const ROOT = 1;
const ALT_PREFIX = "alt_";
const ResolveAnime = obj({ title: str() });
const EVENTS = "CREATE TABLE IF NOT EXISTS spike_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL)";

function titleOf(messages: readonly Message[]): string {
  const user = [...messages].reverse().find((message) => message.role === "user");
  const content = user?.role === "user" ? user.content : "";
  const text = typeof content === "string" ? content : content.map((part) => (part.type === "text" ? part.text : "")).join("");
  return /titled "([^"]+)"/.exec(text)?.[1] ?? "";
}

/** Question 1's model: call `resolve_anime` for the user's title, then answer from whatever tool result it is handed. */
function scripted(record: Recorder): FauxResponseFactory {
  return (context) => {
    const last = context.messages.at(-1);
    const title = titleOf(context.messages);
    if (last?.role === "toolResult") {
      const text = last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      record("model:answer", { title, sawToolResult: { isError: last.isError, text } });
      return fauxAssistantMessage(`${last.isError ? "Lookup failed" : "Resolved"}: ${text}`);
    }
    record("model:tool_call", { title });
    return fauxAssistantMessage(fauxToolCall("resolve_anime", { title }), { stopReason: "toolUse" });
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
      const response = await fetch(`https://catalog.internal/v1/resolve?title=${encodeURIComponent(title)}`, context.abortSignal ? { signal: context.abortSignal } : {});
      const text = await response.text();
      record("tool:end", { title, status: response.status });
      return { output: [{ type: "text", text }], isError: !response.ok };
    },
  };
}

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
  return class AltStoreProbe extends DurableObject<Env> {
    readonly #instance = crypto.randomUUID();
    readonly #faux = fauxProvider();
    #alt: Storage | undefined;
    readonly registry = createRegistry();
    readonly harness = new ObservedPiHarness({
      harness: async ({ context, onWake }) => {
        const models = createModels();
        models.setProvider(this.#faux.provider);
        this.#alt = await openDurableObjectSqliteStorage(this.ctx.storage, { prefix: ALT_PREFIX });
        this.#record("factory:opened-alt-store", { prefix: ALT_PREFIX });
        return Harness.open(this.#alt, { models, registry: this.registry, onWake }, context);
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
      const body = await request.json() as { title?: string; operationId: string };
      this.#record(`request:${action}`, body);
      if (action === "submit") return Response.json(await this.harness.submit(`Resolve the anime titled "${body.title ?? ""}".`, { operationId: body.operationId }));
      return Response.json(await this.#report(body.operationId));
    }

    /** The operation through `PiHarness`, through Pi from the alt store, and as rows under each prefix. */
    async #report(operationId: string) {
      const pi = await this.harness.pi();
      const alt = this.#alt;
      if (!alt) throw new Error("the factory did not run");
      const record = await alt.submissionByRequest(ROOT, operationId, BG);
      const submission = record ? await pi.submission(record.id, BG) : undefined;
      const settled = submission ? await submission.wait(withAbortSignal(AbortSignal.timeout(20_000), BG)) : undefined;
      const count = (table: string) => Number(this.ctx.storage.sql.exec(`SELECT count(*) AS n FROM ${table}`).one().n);
      const tables = this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'pi\\_%' ESCAPE '\\' OR name LIKE 'alt\\_%' ESCAPE '\\') ORDER BY name")
        .toArray().map((row) => String(row.name));
      return {
        instance: this.#instance,
        replay,
        piHarnessWait: await this.harness.wait(operationId, { signal: AbortSignal.timeout(5_000) }),
        settledByPiFromAltStore: settled ? { status: settled.status, ...(settled.status === "unanswered" ? { reason: settled.reason } : {}) } : null,
        rows: { altSubmissions: count(`${ALT_PREFIX}submissions`), piSubmissions: count("pi_submissions"), altEntries: count(`${ALT_PREFIX}entries`), piEntries: count("pi_entries") },
        tables,
        messages: await this.harness.messages(),
        events: this.ctx.storage.sql.exec("SELECT seq, instance, kind, detail, at FROM spike_events ORDER BY seq").toArray()
          .map((row) => ({ ...row, detail: JSON.parse(String(row.detail)) as unknown })),
      };
    }
  };
}

export const SafeProbe = probeClass("safe");
export const UnsafeProbe = probeClass("unsafe");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const [binding, name, action] = new URL(request.url).pathname.split("/").filter((part) => part !== "");
    const namespace = binding === "unsafe" ? env.UNSAFE : env.SAFE;
    return namespace.get(namespace.idFromName(name ?? "")).fetch(new Request(`https://probe.internal/${action ?? ""}`, request));
  },
};
