/**
 * Question 3's semantic-difference prototypes in workerd, one Durable Object class per case. Each hosts `PiHarness` as
 * question 1 does (`Lifecycle.install(this).use(harness)`, the factory passing `onWake`, Pi on the object's SQLite) with
 * pi-ai 1.5.2's faux model. Every event, `onReport` included, goes to the object's own SQLite with a per-instance id, so
 * the evidence survives an eviction. The cases' scripts are in `q3-cases.ts`; the runner is `../run/q3.ts`.
 */
import { DurableObject } from "cloudflare:workers";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, LiveDoc, type HarnessSettings } from "@earendil-works/pi-durable";
import { PiHarness, type PiHarnessOptions } from "agents/harness/pi";
import { Lifecycle, type LifecycleJobContext } from "agents/lifecycle";
import { BG, CASES, type Action, type CaseSpec, type Recorder, type Shared } from "./q3-cases.ts";

type Bindings = "ADMISSION" | "BUDGET" | "STREAM" | "WEB" | "REPLAY" | "RESTART_NO_RETRY" | "RESTART_RETRY" | "RESTART_LIMIT";
type Env = Record<Bindings, DurableObjectNamespace>;

const EVENTS = "CREATE TABLE IF NOT EXISTS spike_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL)";

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

function reportDetail(report: { kind: string; error?: unknown; reason?: string; extension?: string; restarts?: number }) {
  return { kind: report.kind, reason: report.reason, extension: report.extension, restarts: report.restarts,
    error: report.error instanceof Error ? report.error.message : report.error === undefined ? undefined : String(report.error) };
}

function probeClass(spec: CaseSpec) {
  return class Probe extends DurableObject<Env> {
    readonly instance = crypto.randomUUID();
    readonly shared: Shared = { flags: {}, counters: {} };
    readonly faux = fauxProvider(spec.tokensPerSecond === undefined ? {} : { tokensPerSecond: spec.tokensPerSecond });
    readonly registry = createRegistry();
    readonly harness = new ObservedPiHarness({
      harness: ({ storage, context, onWake }) => {
        const models = createModels();
        models.setProvider(this.faux.provider);
        const settings: HarnessSettings | undefined = spec.settings;
        return Harness.open(storage, { models, registry: this.registry, onWake, ...(settings ? { settings } : {}),
          onReport: (report) => this.record("report", reportDetail(report as Parameters<typeof reportDetail>[0])) }, context);
      },
      defaults: { model: this.faux.getModel() },
    }, (kind, detail) => this.record(kind, detail));
    readonly lifecycle = Lifecycle.install(this).use(this.harness);

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      ctx.storage.sql.exec(EVENTS);
      const record: Recorder = (kind, detail) => this.record(kind, detail);
      this.faux.setResponses(Array.from({ length: 64 }, () => spec.model(record, this.shared)));
      this.registry.install({ name: "spike", tools: spec.tools?.(record, ctx.storage) ?? [] });
      for (const extension of spec.extensions?.(record, this.shared) ?? []) this.registry.install(extension);
      this.record("constructed", { case: spec.name });
    }

    record(kind: string, detail?: unknown) {
      this.ctx.storage.sql.exec("INSERT INTO spike_events (instance, kind, detail, at) VALUES (?, ?, ?, ?)",
        this.instance, kind, JSON.stringify(detail ?? null), Date.now());
      console.log(`[spike] ${kind} instance=${this.instance}`);
    }

    onStart() { this.record("start"); }

    onAlarm() { this.record("alarm"); }

    async onRequest(request: Request): Promise<Response> {
      const action = new URL(request.url).pathname.slice(1);
      const body = request.method === "POST" ? await request.json() as Record<string, unknown> : {};
      this.record(`request:${action}`, body);
      const custom: Action | undefined = spec.actions?.[action];
      if (custom) return Response.json(await custom(this, body));
      const operationId = String(body.operationId ?? "");
      if (action === "submit") return Response.json(await this.harness.submit(String(body.text), { operationId }));
      if (action === "flags") return Response.json(Object.assign(this.shared.flags, body));
      return Response.json(await this.report(operationId, Number(body.timeoutMs ?? 30_000)));
    }

    async report(operationId: string, timeoutMs: number) {
      const pi = await this.harness.pi();
      const result = operationId === "" ? null : await this.harness.wait(operationId, { signal: AbortSignal.timeout(timeoutMs) });
      const events = this.ctx.storage.sql.exec("SELECT seq, instance, kind, detail, at FROM spike_events ORDER BY seq").toArray()
        .map((row) => ({ ...row, detail: JSON.parse(String(row.detail)) as unknown }));
      return { instance: this.instance, result, pending: await this.harness.pending(), messages: await this.harness.messages(),
        usage: await pi.usage(BG), live: await pi.snapshot(LiveDoc, 1, BG) ?? null, fauxCalls: this.faux.state.callCount, events,
        extra: spec.extraReport ? spec.extraReport(this.ctx.storage) : undefined };
    }
  };
}

export const AdmissionProbe = probeClass(CASES.admission);
export const BudgetProbe = probeClass(CASES.budget);
export const StreamProbe = probeClass(CASES.stream);
export const WebProbe = probeClass(CASES.web);
export const ReplayProbe = probeClass(CASES.replay);
export const RestartNoRetryProbe = probeClass(CASES.restartNoRetry);
export const RestartRetryProbe = probeClass(CASES.restartRetry);
export const RestartLimitProbe = probeClass(CASES.restartLimit);

const ROUTES: Record<string, Bindings> = { admission: "ADMISSION", budget: "BUDGET", stream: "STREAM", web: "WEB", replay: "REPLAY",
  "restart-no-retry": "RESTART_NO_RETRY", "restart-retry": "RESTART_RETRY", "restart-limit": "RESTART_LIMIT" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const [binding, name, action] = new URL(request.url).pathname.split("/").filter((part) => part !== "");
    const namespace = env[ROUTES[binding ?? ""] ?? "ADMISSION"];
    return namespace.get(namespace.idFromName(name ?? "")).fetch(new Request(`https://probe.internal/${action ?? ""}`, request));
  },
};
