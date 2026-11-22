import { getAgentByName } from "agents";
import type { AgentLane } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxProviderHandle } from "@earendil-works/pi-ai";
import { createCatalogClient } from "@animichi/agent/tools";
import { SessionAgent } from "../src/agent/host/session-agent.ts";
import { BoundaryLossRepo, OPERATION, type Boundary, type InterruptedCommit } from "./tool-replay-boundary-loss.ts";

/**
 * #1542's in-repo half: one crashed drive per durable tool boundary, recovered by the SDK's own
 * schedule. `pi` commits a tool invocation three times — the intent (`pi.op.tool_args`), the staged
 * outcome (`pi.pending.entry`), then the result entry. Losing the response of a commit that landed
 * and losing the commit itself are the two legal endings the spec separates
 * (`docs/specs/2026-09-09-agent-on-pi-harness-spec.md` §五 S4). The probe buys exactly one commit from
 * the real repository and reports what that commit carried and whether the repository accepted it
 * before the loss; no lane, harness or session behavior is replaced. Miniflare never evicts a
 * Durable Object, so instance loss here is the faulted harness being closed and the next attach
 * reopening the session from storage, exactly as the host does after an eviction.
 */
const POINT = { id: "replay-point", name: "Station", bangumi_id: "123", screenshot_url: "", latitude: 35, longitude: 135 };
const SAFE = { name: "search_bangumi", args: { bangumi_id: "123" }, path: "/catalog/points-by-bangumi-id" } as const;
const NEVER = { name: "translate_anime_title", args: { title: "Native Replay Proof", target_language: "zh" }, path: "/catalog/resolve" } as const;

export interface ReplayReport {
  readonly boundary: Boundary;
  readonly tool: string;
  readonly path: string;
  readonly crashed: boolean;
  readonly effectsAtCrash: number;
  readonly interruptedCommit: InterruptedCommit;
  readonly effects: Record<string, number>;
  readonly reservations: string[];
  readonly results: { readonly tool: string; readonly isError: boolean }[];
  readonly status: string | null;
  readonly drives: string[];
  readonly attaches: number;
  readonly callbacks: number;
  readonly modelCalls: number;
  readonly intervals: number;
}

/** The production host, one scripted tool, one counted catalog and the real native repository. */
export class ReplayProbe extends SessionAgent {
  #repo?: BoundaryLossRepo;
  #provider?: FauxProviderHandle;
  #models?: ReturnType<typeof createModels>;
  #effects: Record<string, number> = {};
  #reservations: string[] = [];
  #drives: string[] = [];
  #crashed = false;
  #effectsAtCrash = 0;
  #attaches = 0;
  #callbacks = 0;
  #recovered = Promise.withResolvers<undefined>();

  protected get boundary(): Boundary { return this.name as Boundary; }
  protected get tool() { return this.boundary === "never" ? NEVER : SAFE; }

  override async onStart() {
    const repo = new BoundaryLossRepo(this.boundary);
    this.#repo = repo;
    const session = await repo.create({ id: this.name }, BACKGROUND_CONTEXT);
    await session.close(BACKGROUND_CONTEXT);
    this.#script();
    this.bindSession(repo, session.metadata, (opened) => { this.#attaches += 1; return this.#composition(opened); });
    await super.onStart();
  }

  /** One script per session, not per attachment: recovery continues the same turn and its next round. */
  #script() {
    const provider = fauxProvider();
    this.#provider = provider;
    provider.setResponses([fauxAssistantMessage(fauxToolCall(this.tool.name, this.tool.args), { stopReason: "toolUse" }), fauxAssistantMessage("Recovered")]);
    const models = createModels();
    models.setProvider(provider.provider);
    this.#models = models;
  }

  #composition(session: Session) {
    return { models: this.#requireModels(), model: this.#requireProvider().getModel(), toolContext: { session, branch: "main", locale: "en",
      catalog: createCatalogClient((request) => this.#catalog(request)),
      assertAuthorized: () => Promise.resolve(),
      reserveToolUsage: (invocationId: string) => { this.#reservations.push(invocationId); return Promise.resolve(); } } };
  }

  /** One external effect per invocation; a replayed safe or never tool raises the same counter. */
  #catalog(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname !== this.tool.path) return Promise.reject(new Error(`Unexpected catalog request: ${pathname}`));
    this.#effects[pathname] = (this.#effects[pathname] ?? 0) + 1;
    return Promise.resolve(Response.json(pathname === SAFE.path ? { rows: [POINT], synced_at: "2026-09-16" }
      : { outcome: "resolved", match: { bangumi_id: "1556", title: "Native Replay Proof", title_cn: "本地巡礼" } }));
  }

  protected override async driveLane(lane: AgentLane, operationId: string, context: Context) {
    this.#drives.push(operationId);
    return super.driveLane(lane, operationId, context);
  }

  /** The SDK's scheduled callback body; no client request ever reaches the host after the crash. */
  override async wakeSession(): Promise<void> {
    this.#callbacks += 1;
    try { await super.wakeSession(); } finally { this.#recovered.resolve(undefined); }
  }

  /** Drive the admitted turn until the injected boundary faults it, then report the interruption. */
  async startTurn() {
    await this.withSession(async (_session, lane, context) => {
      const accepted = await lane.accept({ kind: "prompt", operationId: OPERATION, prompt: "Recover the replayed invocation" }, context);
      if (!accepted.ok) throw accepted.error;
      try { await this.driveLane(lane, OPERATION, context); }
      catch { this.#crashed = true; }
    });
    this.#effectsAtCrash = Object.values(this.#effects).reduce((total, count) => total + count, 0);
    return this.#observed();
  }

  /** Arm one durable SDK wake and make it due, so the real alarm delivers the real callback. */
  async recover() {
    const wake = await this.schedule(new Date(0), "wakeSession", { operationId: OPERATION }, { idempotent: true });
    await this.ctx.storage.setAlarm(Date.now());
    return { id: wake.id, callbacks: this.#callbacks };
  }

  async waitForRecovery() {
    await this.#recovered.promise;
    return { recovered: true };
  }

  async report(): Promise<ReplayReport> {
    const live = await this.withSession(async (_session, lane, context) => ({
      results: (await lane.findEntries({ type: "message" }, context))
        .flatMap((entry) => entry.type === "message" && entry.message.role === "toolResult" ? [{ tool: entry.message.toolName, isError: entry.message.isError }] : []),
      status: (await lane.getResult(OPERATION, context))?.status ?? null,
    }));
    const intervals = (await this.listSchedules()).filter((schedule) => schedule.callback === "wakeSession" && schedule.type === "interval").length;
    return { ...live, ...this.#observed(), intervals, reservations: [...this.#reservations], drives: [...this.#drives] };
  }

  #observed() {
    return { boundary: this.boundary, tool: this.tool.name, path: this.tool.path, crashed: this.#crashed, effectsAtCrash: this.#effectsAtCrash,
      interruptedCommit: this.#requireRepo().interrupted, effects: { ...this.#effects }, attaches: this.#attaches, callbacks: this.#callbacks,
      modelCalls: this.#requireProvider().state.callCount };
  }

  #requireRepo() { if (!this.#repo) throw new Error("The probe repository is not bound"); return this.#repo; }
  #requireProvider() { if (!this.#provider) throw new Error("The probe provider is not scripted"); return this.#provider; }
  #requireModels() { if (!this.#models) throw new Error("The probe models are not scripted"); return this.#models; }
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<ReplayProbe> }) {
    const [boundary, action] = new URL(request.url).pathname.split("/").filter((part) => part !== "");
    const host = await getAgentByName(env.SESSION, boundary ?? "", { locationHint: "apac" });
    if (action === "run") return Response.json(await host.startTurn());
    if (action === "recover") return Response.json(await host.recover());
    if (action === "settled") return Response.json(await host.waitForRecovery());
    return Response.json(await host.report());
  },
};
