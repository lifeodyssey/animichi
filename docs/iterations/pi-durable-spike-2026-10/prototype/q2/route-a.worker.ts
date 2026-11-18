/**
 * Route (a): `PiHarness` on its own SQLite store, as question 1 hosts it, plus a projection of each completed turn
 * into Postgres, keyed by `(session_id, seq)` with the outer session id. Pi's store is authoritative; the Postgres row is
 * its projection, recomputed from Pi's entries: model, provider, per-call usage, tool calls and results, answer, status.
 *
 * When the projection runs: inside `PiHarness`'s own wake job, after the step that finds Pi idle returns nothing, so that
 * the job would complete (`onJob` and `_wakeStep`, `agents@0.33.0 dist/harness/pi/index.js:144-154`, `:360-381`). While
 * the projection runs, the job has not completed, so a kill anywhere in it leaves the job in Lifecycle's queue, and the
 * restarted object runs it again: in the recorded runs about 30 s later, when the alarm Lifecycle stores before driving
 * due jobs fires (`dist/lifecycle-v1rKHV2C.js:594`). How the restarted object releases the job's running flag is not
 * shown (the README, route (a)). A local note (the object's SQLite) records each projected turn; the Postgres
 * write inserts at most once, so a re-projection after a crash writes nothing twice. Crash markers, armed per request:
 * a1 after Pi's commit and before the write, a2 inside the write's transaction before `COMMIT`, a3 after `COMMIT` and
 * before the note.
 */
import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type Harness as PiDurable, type SubmissionRecord } from "@earendil-works/pi-durable";
import { PiHarness, type PiHarnessOptions } from "agents/harness/pi";
import { Lifecycle, type LifecycleJobContext } from "agents/lifecycle";
import pg from "pg";
import { model, tools } from "./b-prime/script.ts";

interface Env { readonly DSN: string; readonly ROUTE_A: DurableObjectNamespace }
const BG = BACKGROUND_CONTEXT;
const LOCAL = ["CREATE TABLE IF NOT EXISTS spike_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS spike_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)", "CREATE TABLE IF NOT EXISTS spike_projected (seq INTEGER PRIMARY KEY)"];

type Content = { type: string; text?: string; name?: string; arguments?: unknown }[];
interface Message { role: string; content?: string | Content; model?: string; provider?: string; usage?: unknown; stopReason?: string; toolName?: string; isError?: boolean }

const textOf = (message: Message | undefined) => (typeof message?.content === "string" ? message.content
  : (message?.content ?? []).map((part) => (part.type === "text" ? part.text ?? "" : "")).join(""));

/** The projection of one settled operation, recomputed from Pi's entries in its own range. */
export async function projectionOf(pi: PiDurable, record: SubmissionRecord) {
  const range = record as { entry?: number; answer?: number; requestId?: string; status: string; conversationId: number };
  const conversation = await pi.conversation(range.conversationId, BG);
  const items = conversation && range.entry !== undefined && range.answer !== undefined
    ? (await conversation.entries({ minEntryId: range.entry, maxEntryId: range.answer, order: "ascending" }, 500, undefined, BG)).items : [];
  const calls: unknown[] = [];
  const toolCalls: unknown[] = [];
  const toolResults: unknown[] = [];
  let answer = "";
  for (const entry of items) {
    const message = (entry as { model?: Message[] }).model?.[0];
    if (message?.role === "assistant") {
      calls.push({ entry: entry.id, model: message.model, provider: message.provider, usage: message.usage, stopReason: message.stopReason });
      for (const part of Array.isArray(message.content) ? message.content : []) if (part.type === "toolCall") toolCalls.push({ name: part.name, arguments: part.arguments });
    } else if (message?.role === "toolResult") toolResults.push({ name: message.toolName, isError: message.isError, text: textOf(message) });
    if (entry.id === range.answer) answer = textOf(message);
  }
  const last = calls.at(-1) as { model?: string; provider?: string } | undefined;
  return { operationId: range.requestId, status: range.status, model: last?.model, provider: last?.provider, calls, toolCalls, toolResults, answer };
}

class ProjectingPiHarness extends PiHarness {
  readonly #host: { project(): Promise<void>; record(kind: string, detail?: unknown): void };

  constructor(options: PiHarnessOptions, host: ProjectingPiHarness["host"]) {
    super(options);
    this.#host = host;
  }

  get host() { return this.#host; }

  /** `PiHarness`'s job unchanged, except that the step that finds Pi idle projects before the job completes. */
  override async onJob(context: LifecycleJobContext) {
    this.#host.record("job", { id: context.job.id });
    const outcome = await super.onJob(context);
    if (context.job.fn === "wake" && outcome === undefined) await this.#host.project();
    return outcome;
  }
}

export class RouteA extends DurableObject<Env> {
  readonly instance = crypto.randomUUID();
  readonly faux = fauxProvider();
  readonly registry = createRegistry();
  readonly harness: ProjectingPiHarness = new ProjectingPiHarness({
    harness: ({ storage, context, onWake }) => {
      const models = createModels();
      models.setProvider(this.faux.provider);
      return Harness.open(storage, { models, registry: this.registry, onWake }, context);
    },
    defaults: { model: this.faux.getModel() },
  }, this);
  readonly lifecycle = Lifecycle.install(this).use(this.harness);
  client: Promise<pg.Client> | undefined;
  crash: { readonly point: string } | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const statement of LOCAL) ctx.storage.sql.exec(statement);
    const record = (kind: string, detail?: unknown) => this.record(kind, detail);
    this.faux.setResponses(Array.from({ length: 64 }, () => model(record, false)));
    this.registry.install({ name: "spike", tools: tools("safe", record) });
    this.record("constructed");
  }

  record(kind: string, detail?: unknown) {
    this.ctx.storage.sql.exec("INSERT INTO spike_events (instance, kind, detail, at) VALUES (?, ?, ?, ?)", this.instance, kind, JSON.stringify(detail ?? null), Date.now());
    const op = (detail as { operationId?: string } | null | undefined)?.operationId;
    console.log(`[spike] ${kind} instance=${this.instance}${op === undefined ? "" : ` op=${op}`}`);
  }

  get session(): string | undefined {
    return this.ctx.storage.sql.exec("SELECT value FROM spike_meta WHERE key = 'session'").toArray()[0]?.value as string | undefined;
  }

  projection(session: string): Promise<pg.Client> {
    this.client ??= (async () => {
      const client = new pg.Client({ connectionString: this.env.DSN, application_name: `proj:${session}` });
      await client.connect();
      return client;
    })().catch((error: unknown) => { this.client = undefined; throw error; });
    return this.client;
  }

  async marker(point: string) {
    if (this.crash?.point !== point) return;
    this.record(`marker:${point}`);
    await new Promise(() => undefined);
  }

  /** Every turn Pi settled `done` and the local note lacks: recompute from Pi's store, write once, note it. */
  async project(): Promise<void> {
    const session = this.session;
    if (session === undefined) return;
    const pi = await this.harness.pi();
    const settled = (await (await this.harness.storage()).scanSubmissions({ status: "done" }, 200, undefined, BG)).items;
    for (const record of settled) {
      if (record.requestId === undefined || this.ctx.storage.sql.exec("SELECT 1 FROM spike_projected WHERE seq = ?", record.id).toArray().length > 0) continue;
      const projection = await projectionOf(pi, record);
      await this.marker("a1");
      const client = await this.projection(session);
      await client.query("BEGIN");
      try {
        await client.query("INSERT INTO proj_turns (session_id, seq, operation_id, record) VALUES ($1, $2, $3, $4) ON CONFLICT (session_id, seq) DO NOTHING",
          [session, record.id, record.requestId, JSON.stringify(projection)]);
        await this.marker("a2");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      await this.marker("a3");
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO spike_projected (seq) VALUES (?)", record.id);
      this.record("projected", { operationId: record.requestId, seq: record.id, bytes: JSON.stringify(projection).length });
    }
  }

  /** Lifecycle routes requests here after startup, as in question 1 (`src/q1.worker.ts`). */
  async onRequest(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.slice(1);
    const body = await request.json() as { session?: string; operationId?: string; text?: string; crashAt?: string };
    this.record(`request:${action}`, { operationId: body.operationId });
    if (action === "submit") {
      if (body.session !== undefined) this.ctx.storage.sql.exec("INSERT OR IGNORE INTO spike_meta (key, value) VALUES ('session', ?)", body.session);
      if (body.crashAt !== undefined) this.crash = { point: body.crashAt };
      return Response.json(await this.harness.submit(body.text ?? "", { operationId: body.operationId ?? "" }));
    }
    const pi = await this.harness.pi();
    const record = await (await this.harness.storage()).submissionByRequest(1, body.operationId ?? "", BG);
    return Response.json({ instance: this.instance, session: this.session, sqliteBytes: this.ctx.storage.sql.databaseSize,
      recomputed: record ? await projectionOf(pi, record) : null, status: record?.status ?? null });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const [name, action] = new URL(request.url).pathname.split("/").filter((part) => part !== "");
    return env.ROUTE_A.get(env.ROUTE_A.idFromName(name ?? "")).fetch(new Request(`https://probe.internal/${action ?? ""}`, request));
  },
};
