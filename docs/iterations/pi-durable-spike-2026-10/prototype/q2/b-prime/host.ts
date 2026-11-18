/**
 * Route (b′)'s host: an Agents SDK `Agent`, as `SessionAgent` is (`workers/edge/src/agent/host/session-agent.ts`), that
 * calls pi-durable's `Harness.open` itself on the Postgres backend, keyed by its own name (the session id), and owns
 * the wake that `PiHarness` would otherwise provide:
 * - an interval heartbeat armed in `onStart`, the edge's pattern (`session-agent.ts:52`, `WAKE_INTERVAL_MS` 30 s);
 * - before Pi is handed an input, a one-shot `schedule(0, "wakeSession", …)` (`session-agent.ts:141,224-228`), a
 *   Lifecycle job that stays due until its callback returns, so a kill mid-turn leaves it for the 30 s deadman alarm;
 * - `wakeSession` resumes Pi and waits while `pi.wake()` is active, as `PiHarness`'s `_waitWhileActive` does
 *   (`agents@0.33.0 dist/harness/pi/index.js:391-418`); Pi's `onWake` re-arms the job for an active Session or a sleep.
 * Scheduling stays paused after `Harness.open` until `resume()` (`pi-durable dist/harness/types.d.ts:830-835`), so after
 * a restart only `wakeSession` moves the turn. Every event goes to the object's own SQLite with a per-instance id.
 *
 * With `business`, the host also runs the covering layers of `business.ts`: admission before Pi's submit, and on every
 * wake the recovery scan (an admitted operation Pi does not have is submitted again under its id; one Pi has settled is
 * settled once). Crash markers (`c1`–`c4`), armed per request by the runner, block forever at their point so the runner
 * can SIGKILL workerd there; they live in memory and die with the process.
 */
import { Agent } from "agents";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type StorageWrite, type SubmissionRecord, type Wake } from "@earendil-works/pi-durable";
import pg from "pg";
import { PgStorage } from "../pg-storage/storage.ts";
import { admit, admitted, settle } from "./business.ts";
import { chargeOf } from "./charge.ts";
import { doubleProvider } from "./double.ts";
import { keyOf } from "./key.ts";
import { model, tools, type Replay } from "./script.ts";

export interface PrimeEnv { readonly DSN: string; readonly WAKE_INTERVAL_S?: string }
export interface PrimeOptions {
  readonly replay: Replay;
  readonly tokensPerSecond?: number;
  readonly longAnswers?: boolean;
  readonly business?: boolean;
  /** `double`: the ported provider double (`double.ts`) instead of faux, for question 3's `settlement`. */
  readonly provider?: "faux" | "double";
}
interface Opened { readonly harness: Harness; readonly storage: PgStorage }

const BG = BACKGROUND_CONTEXT;
const ROOT = 1;
const WAIT_BUDGET_MS = 10 * 60_000;
/** The one-shot wake's payload: one identity, so the SDK's idempotent dedup keeps a single due wake. */
const WAKE = { wake: "pi" };
const EVENTS = "CREATE TABLE IF NOT EXISTS spike_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL)";

export function primeClass(options: PrimeOptions) {
  return class PrimeHost extends Agent<PrimeEnv> {
    readonly instance = crypto.randomUUID();
    readonly faux = fauxProvider(options.tokensPerSecond === undefined ? {} : { tokensPerSecond: options.tokensPerSecond });
    readonly registry = createRegistry();
    opening: Promise<Opened> | undefined;
    biz: Promise<pg.Client> | undefined;
    waiting: Promise<void> | undefined;
    changed: (() => void) | undefined;
    crash: { readonly point: string; readonly operationId: string } | undefined;
    submissionCommitted = false;
    readonly double: ReturnType<typeof doubleProvider> | undefined;

    constructor(ctx: DurableObjectState, env: PrimeEnv) {
      super(ctx, env);
      ctx.storage.sql.exec(EVENTS);
      const record = (kind: string, detail?: unknown) => this.record(kind, detail);
      this.double = options.provider === "double" ? doubleProvider(record) : undefined;
      this.faux.setResponses(Array.from({ length: 64 }, () => model(record, options.longAnswers === true)));
      this.registry.install({ name: "spike", tools: tools(options.replay, record) });
      this.record("constructed", { replay: options.replay });
    }

    record(kind: string, detail?: unknown) {
      this.ctx.storage.sql.exec("INSERT INTO spike_events (instance, kind, detail, at) VALUES (?, ?, ?, ?)", this.instance, kind, JSON.stringify(detail ?? null), Date.now());
      const op = (detail as { operationId?: string } | null | undefined)?.operationId;
      console.log(`[spike] ${kind} instance=${this.instance}${op === undefined ? "" : ` op=${op}`}`);
    }

    get key(): string { return keyOf(this.name); }

    override async onStart() {
      this.record("start");
      await this.scheduleEvery(Number(this.env.WAKE_INTERVAL_S ?? "30"), "wakeSession");
      await this.open();
    }

    open(): Promise<Opened> {
      this.opening ??= this.doOpen().catch((error: unknown) => { this.opening = undefined; throw error; });
      return this.opening;
    }

    async doOpen(): Promise<Opened> {
      const client = new pg.Client({ connectionString: this.env.DSN, application_name: `pi:${this.key}` });
      await client.connect();
      const storage = await PgStorage.open(client, this.key, { beforeCommit: (batches) => this.beforeCommit(batches) });
      const models = createModels();
      models.setProvider(this.double?.provider ?? this.faux.provider);
      const harness = await Harness.open(storage, { models, registry: this.registry, onWake: (wake) => this.onPiWake(wake) }, BG);
      harness.subscribeClose(() => { this.opening = undefined; });
      const fauxModel = this.faux.getModel();
      await harness.root(BG, { agent: { model: this.double?.model("double-reporting") ?? { provider: fauxModel.provider, modelId: fauxModel.id } } });
      this.record("pi:opened", { key: this.key });
      return { harness, storage };
    }

    bizClient(): Promise<pg.Client> {
      this.biz ??= (async () => {
        const client = new pg.Client({ connectionString: this.env.DSN, application_name: `biz:${this.key}` });
        await client.connect();
        return client;
      })().catch((error: unknown) => { this.biz = undefined; throw error; });
      return this.biz;
    }

    /** Pi's wake changed: end a wait's sleep, or arm the one-shot for an active Session or the earliest sleep. */
    onPiWake(wake: Wake) {
      this.changed?.();
      if (this.waiting) return;
      const arm = wake.active ? this.schedule(0, "wakeSession", WAKE, { idempotent: true })
        : wake.at === undefined ? undefined : this.schedule(new Date(wake.at), "wakeSession", WAKE, { idempotent: true });
      arm?.catch((error: unknown) => this.record("wake:arm-error", { error: String(error) }));
    }

    /** The SDK's scheduled callback, interval or one-shot: resume Pi, run the recovery scan, wait while Pi has work, settle. */
    async wakeSession(payload?: unknown): Promise<void> {
      this.record("wake:start", payload);
      const { harness, storage } = await this.open();
      harness.resume();
      if (options.business) await this.recoverAdmissions(harness, storage);
      if (this.waiting) {
        await this.waiting;
        this.record("wake:joined", payload);
      } else {
        this.waiting = this.waitWhileActive(harness).finally(() => { this.waiting = undefined; });
        this.record("wake:waiting", { active: harness.wake().active });
        await this.waiting;
        this.record("wake:end", { active: harness.wake().active });
      }
      if (options.business) await this.settleDiscovered(harness, storage);
    }

    async waitWhileActive(pi: Harness): Promise<void> {
      const deadline = Date.now() + WAIT_BUDGET_MS;
      let wake = pi.wake();
      while (wake.active && Date.now() < deadline) {
        let sleep = deadline - Date.now();
        if (wake.at !== undefined) sleep = Math.min(sleep, wake.at - Date.now());
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.max(0, sleep));
          this.changed = () => { clearTimeout(timer); resolve(); };
        });
        this.changed = undefined;
        if (wake.at !== undefined && Date.now() >= wake.at) pi.resume();
        wake = pi.wake();
      }
    }

    /** Arm the wake, then hand Pi the input under the operation's id (Pi's own request-id dedupe, `submissions.js:173-180`). */
    async submit(operationId: string, text: string) {
      this.record("request:submit", { operationId });
      await this.schedule(0, "wakeSession", WAKE, { idempotent: true });
      const { harness } = await this.open();
      const submission = await (await harness.root(BG)).submit({ type: "input", content: text, whenBusy: "followUp", requestId: operationId }, BG);
      return { operationId, submission: submission.id };
    }

    /** Admission first, then the wake, then Pi: today's order (`session-agent.ts:134-143`). */
    async admit(operationId: string, text: string, crashAt?: string) {
      if (crashAt !== undefined) this.crash = { point: crashAt, operationId };
      this.record("request:admit", { operationId, crashAt });
      const outcome = await admit(await this.bizClient(), this.key, operationId, "model", text);
      if (outcome.kind === "conflict") return { status: 409, operationId };
      await this.marker("c1");
      await this.schedule(0, "wakeSession", WAKE, { idempotent: true });
      const { harness } = await this.open();
      await (await harness.root(BG)).submit({ type: "input", content: text, whenBusy: "followUp", requestId: operationId }, BG);
      return { status: outcome.kind === "created" ? 202 : 200, operationId };
    }

    /** Change the session's model, as `PiSession.setModel` does (`agents@0.33.0 dist/harness/pi/index.js:569-571`). */
    async useModel(modelId: "double-reporting" | "double-silent") {
      if (!this.double) throw new Error("this class has no provider double");
      const { harness } = await this.open();
      await (await harness.root(BG)).configure({ model: this.double.model(modelId) }, BG);
      this.record("request:use-model", { modelId });
      return true;
    }

    /** A selection turn, no model: the same admission, then a display-only write under the operation id, which Pi settles at once. */
    async select(operationId: string, choice: string) {
      this.record("request:select", { operationId });
      const outcome = await admit(await this.bizClient(), this.key, operationId, "selection", choice);
      if (outcome.kind === "conflict") return { status: 409, operationId };
      const { harness, storage } = await this.open();
      const submission = await (await harness.root(BG)).submit({ type: "write", entry: { kind: "animichi.selection", data: { choice } }, requestId: operationId }, BG);
      const settled = await submission.wait(withAbortSignal(AbortSignal.timeout(10_000), BG));
      await this.settleDiscovered(harness, storage);
      return { status: outcome.kind === "created" ? 202 : 200, operationId, submission: submission.id, settled: settled.status };
    }

    /** C1, C2: an admitted operation Pi does not have is submitted again under its id, which Pi keeps as one submission. */
    async recoverAdmissions(harness: Harness, storage: PgStorage) {
      for (const admission of await admitted(await this.bizClient(), this.key)) {
        if (admission.kind !== "model" || await storage.submissionByRequest(ROOT, admission.operationId, BG)) continue;
        this.record("recover:resubmit", { operationId: admission.operationId });
        await (await harness.root(BG)).submit({ type: "input", content: admission.input, whenBusy: "followUp", requestId: admission.operationId }, BG);
      }
    }

    /** C4: every admitted operation Pi has settled is settled here, at most once (`business.ts` `settle`). */
    async settleDiscovered(harness: Harness, storage: PgStorage) {
      for (const admission of await admitted(await this.bizClient(), this.key)) {
        const record = await storage.submissionByRequest(ROOT, admission.operationId, BG);
        if (record?.status !== "done" && record?.status !== "unanswered") continue;
        const charge = await this.operationCharge(harness, record);
        await this.marker("c4");
        const { banked } = await settle(await this.bizClient(), this.key, admission.operationId, record.status, charge.total, charge.first, charge.last);
        this.record("settled", { operationId: admission.operationId, outcome: record.status, charged: charge.total, banked });
      }
    }

    /** The operation's own entry range, from its placed input to its answer, and the usage inside it. */
    async operationCharge(harness: Harness, record: SubmissionRecord) {
      const first = (record as { entry?: number }).entry ?? null;
      const last = (record as { answer?: number }).answer ?? null;
      if (first === null || last === null) return { total: 0, first, last, calls: [] };
      const entries = (await (await harness.root(BG)).entries({ minEntryId: first, maxEntryId: last, order: "ascending" }, 500, undefined, BG)).items;
      return { ...chargeOf(entries as unknown as { id: number; model?: unknown[] }[]), first, last };
    }

    /** Blocks forever at the crash point the runner armed, so it can SIGKILL workerd there. */
    async marker(point: string): Promise<void> {
      if (this.crash?.point !== point) return;
      this.record(`marker:${point}`, { operationId: this.crash.operationId });
      await new Promise(() => undefined);
    }

    /** C2 blocks Pi's commit of the submission before its `COMMIT`; C3 lets it commit and blocks the next commit. */
    async beforeCommit(batches: readonly (readonly StorageWrite[])[]) {
      const crash = this.crash;
      if (crash === undefined) return;
      const carries = batches.some((writes) => writes.some((write) => write.type === "submission" && write.value.requestId === crash.operationId));
      if (crash.point === "c2" && carries) await this.marker("c2");
      if (crash.point !== "c3") return;
      if (this.submissionCommitted) await this.marker("c3");
      else if (carries) this.submissionCommitted = true;
    }

    /** Arm the one-shot wake with no new input: the idle wake, whose cost b′3 counts. */
    async armWake() {
      this.record("request:arm-wake");
      await this.schedule(0, "wakeSession", WAKE, { idempotent: true });
      return true;
    }

    /** The operation as Pi settles it, the transcript, Pi's usage and the event log. Reads through Pi; run after any count. */
    async report(operationId: string) {
      this.record("request:report", { operationId });
      const { harness, storage } = await this.open();
      const record = await storage.submissionByRequest(ROOT, operationId, BG);
      const submission = record ? await harness.submission(record.id, BG) : undefined;
      const settled = submission ? await submission.wait(withAbortSignal(AbortSignal.timeout(30_000), BG)) : undefined;
      const conversation = await harness.root(BG);
      return {
        instance: this.instance, key: this.key, operationId,
        settled: settled === undefined ? null : { status: settled.status, ...(settled.status === "unanswered" ? { reason: settled.reason } : { answer: (settled as { answer?: number }).answer }) },
        messages: [...(await conversation.context(BG)).entries],
        usage: await harness.usage(BG),
        events: this.ctx.storage.sql.exec("SELECT seq, instance, kind, detail, at FROM spike_events ORDER BY seq").toArray()
          .map((row) => ({ ...row, detail: JSON.parse(String(row.detail)) as unknown })),
      };
    }
  };
}
