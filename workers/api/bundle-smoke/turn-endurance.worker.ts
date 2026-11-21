import { getAgentByName } from "agents";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo, type Session } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type AssistantMessage, type FauxProviderHandle, type ToolCall } from "@earendil-works/pi-ai";
import { createCatalogClient } from "@animichi/agent/tools";
import { SessionAgent } from "../src/agent/host/session-agent.ts";

/**
 * #1540's in-repo half: one disconnected client, one long multi-tool turn.
 *
 * The spec (`docs/specs/2026-09-09-agent-on-pi-harness-spec.md` §五 S2) runs this turn on a
 * spike-only ≥130 s budget; production keeps the 100 s budget in `host/turn-deadline.ts`, so the
 * spike budget is what a 130 s turn needs on any host. The clock is mocked and advanced per model
 * round, so the turn spans 135 host-clock seconds without holding a real 130 s of wall time.
 * The deployed wall-clock, CPU and cost figures stay with #1583; Miniflare never evicts a DO.
 */
const SPIKE_TURN_DEADLINE_MS = 600_000;
const ROUND_MS = 45_000;
const OPERATION = "endurance";
const ORIGIN = { lat: 35, lng: 135 };
const POINT = { id: "endurance-point", name: "Station", bangumi_id: "123", screenshot_url: "", latitude: 35, longitude: 135 };

/** One catalog effect per tool: the `search_nearby` call uses the shared origin and needs no geocode. */
const CATALOG_PATHS: Readonly<Record<string, string>> = { "/catalog/points-by-bangumi-id": "search_bangumi", "/catalog/nearby": "search_nearby" };

const TOOL_CALLS: readonly ToolCall[] = [
  fauxToolCall("search_bangumi", { bangumi_id: "123" }),
  fauxToolCall("search_nearby", {}),
  fauxToolCall("respond", { kind: "greeting", message: "The disconnected turn finished" }),
];

export interface EnduranceReport {
  readonly admissions: number;
  readonly modelCalls: number;
  readonly keepAliveEntries: number;
  readonly toolInvocations: string[];
  readonly toolEffects: Record<string, number>;
  readonly elapsedMs: number;
  readonly disconnected: boolean;
  readonly status: string | null;
}

/** The production host with a scripted provider, a counted catalog and one client-owned AbortSignal. */
export class EnduranceProbe extends SessionAgent {
  readonly #clock = { now: Math.ceil(Date.now() / 1000) * 1000 };
  readonly #repo = new MemorySessionRepo({ now: () => this.#clock.now });
  readonly #entered = Promise.withResolvers<undefined>();
  readonly #released = Promise.withResolvers<undefined>();
  readonly #disconnect = new AbortController();
  readonly #effects = new Map<string, number>();
  #provider?: FauxProviderHandle;
  #admissions = 0;
  #keepAliveEntries = 0;
  #startedAt = 0;
  #disconnected = false;
  #invocations: string[] = [];

  protected override turnDeadlineMs() { return SPIKE_TURN_DEADLINE_MS; }

  /** The SDK keepalive is what must hold a disconnected turn; its absence has to be observable. */
  override async keepAliveWhile<T>(work: () => Promise<T>): Promise<T> {
    this.#keepAliveEntries += 1;
    return super.keepAliveWhile(work);
  }

  override async onStart() {
    const session = await this.#repo.create({ id: this.name }, BACKGROUND_CONTEXT);
    await session.close(BACKGROUND_CONTEXT);
    this.bindSession(this.#repo, session.metadata, this.#composition());
    await super.onStart();
  }

  /** The scripted provider and the tool context are the only seams this host replaces. */
  #composition() {
    const provider = fauxProvider();
    this.#provider = provider;
    provider.setResponses(TOOL_CALLS.map((call) => () => this.#round(call)));
    const models = createModels();
    models.setProvider(provider.provider);
    return (session: Session) => ({ models, model: provider.getModel(), toolContext: this.#tools(session) });
  }

  #tools(session: Session) {
    return { session, branch: "main", locale: "en", origin: ORIGIN,
      catalog: createCatalogClient((request) => this.#catalog(request)),
      assertAuthorized: () => Promise.resolve(),
      reserveToolUsage: (invocationId: string) => { this.#invocations.push(invocationId); return Promise.resolve(); } };
  }

  /** Every model round waits on the fixture's event and then spends its share of the host clock. */
  async #round(call: ToolCall): Promise<AssistantMessage> {
    this.#entered.resolve(undefined);
    await this.#released.promise;
    this.#clock.now += ROUND_MS;
    return fauxAssistantMessage(call, { stopReason: "toolUse" });
  }

  /** One external effect per tool invocation; a replayed safe tool would raise the same counter. */
  #catalog(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const tool = CATALOG_PATHS[pathname];
    if (!tool) return Promise.reject(new Error(`Unexpected catalog request: ${pathname}`));
    this.#effects.set(tool, (this.#effects.get(tool) ?? 0) + 1);
    return Promise.resolve(Response.json(pathname === "/catalog/nearby" ? { rows: [POINT] } : { rows: [POINT], synced_at: "2026-09-16" }));
  }

  /** The client's cancellation signal reaches the host here, exactly as a closed browser tab does. */
  async startTurn(): Promise<EnduranceReport> {
    const realNow = Date.now;
    Date.now = () => this.#clock.now;
    this.#startedAt = this.#clock.now;
    try { return this.#report(await this.#runTurn()); }
    finally { Date.now = realNow; }
  }

  #runTurn(): Promise<string | null> {
    return this.withSession(async (_session, lane, context) => {
      const accepted = await lane.accept({ kind: "prompt", operationId: OPERATION, prompt: "Endure the disconnect" }, context);
      if (!accepted.ok) throw accepted.error;
      this.#admissions += 1;
      await this.driveLane(lane, OPERATION, context);
      return (await lane.getResult(OPERATION, context))?.status ?? null;
    }, withAbortSignal(this.#disconnect.signal, BACKGROUND_CONTEXT));
  }

  #report(status: string | null): EnduranceReport {
    return { admissions: this.#admissions, modelCalls: this.#provider?.state.callCount ?? -1,
      keepAliveEntries: this.#keepAliveEntries, toolInvocations: this.#invocations,
      toolEffects: Object.fromEntries(this.#effects), elapsedMs: this.#clock.now - this.#startedAt,
      disconnected: this.#disconnected, status };
  }

  waitForProvider() { return this.#entered.promise; }
  releaseProvider() { this.#released.resolve(undefined); return "released"; }

  /** The disconnect is an abort of the client's own signal, mid-turn, with no reconnection after it. */
  disconnect() {
    this.#disconnected = true;
    this.#disconnect.abort(new DOMException("The client disconnected", "AbortError"));
    return "disconnected";
  }
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<EnduranceProbe> }) {
    const host = await getAgentByName(env.SESSION, "endurance", { locationHint: "apac" });
    const path = new URL(request.url).pathname;
    if (path === "/entered") { await host.waitForProvider(); return new Response("entered"); }
    if (path === "/disconnect") return new Response(await host.disconnect());
    if (path === "/release") return new Response(await host.releaseProvider());
    return Response.json(await host.startTurn());
  },
};
