import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { Session, SessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxProviderHandle, type FauxResponseStep } from "@earendil-works/pi-ai";
import { createCatalogClient } from "@animichi/agent/tools";
import { nativeClient } from "../src/native-client.ts";
import { SessionAgent } from "../src/agent/host/session-agent.ts";
import { sessionAgentStub } from "../src/agent/host/session-agent-stub.ts";
import { persistPermanentRejection } from "../src/agent/admission/permanent-rejection.ts";
import { gateNativeResultReads, loseNativeReply } from "./lost-reply.ts";
import { recoveryScanInterval } from "./wake-cadence.ts";
import type { ModelAdmissionRequest } from "../src/agent/admission/types.ts";

/** The lifecycle cases authorize no tool; the deadline case needs one permitted, locally-answerable call. */
function lifecycleTools(session: Session) {
  return { session, branch: "main", locale: "en", catalog: createCatalogClient(() => Promise.reject(new Error("No catalog call expected"))),
    assertAuthorized: () => Promise.reject(new Error("No tool invocation authorized in this lifecycle case")),
    reserveToolUsage: () => Promise.reject(new Error("No tool reservation expected")) };
}

function deadlineTools(session: Session) {
  return { session, branch: "main", locale: "en", catalog: createCatalogClient(() => Promise.reject(new Error("No catalog call expected"))),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve() };
}

/** The hold outlasts the published budget by this much, so the deadline is spent when the response lands. */
const PAST_BUDGET_MS = 500;

/** The payload a wake carries, or null when it carries none; the test classifies the row, the host does not. */
function wakePayload(payload: unknown): object | null {
  return typeof payload === "object" && payload !== null ? payload : null;
}

/** The lane's budget is wall clock, so waiting it out has to be too. */
function wait(ms: number) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * One provider call is delivered, then held until the budget the boundary published for that request has
 * expired: the next boundary — never a wall-clock race with the response — is what must end the turn. A
 * boundary that published no budget holds nothing, and the boundary that follows then spends a live one.
 */
function deadlineResponses(): FauxResponseStep[] {
  const held: FauxResponseStep = async (_context, options) => {
    await wait((options?.timeoutMs ?? 0) + PAST_BUDGET_MS);
    return fauxAssistantMessage(fauxToolCall("search_nearby", {}), { stopReason: "toolUse" });
  };
  return [held, fauxAssistantMessage("a request past the deadline must never be issued")];
}

/** Only runtime resources/provider transport are supplied here; production submit/wake own every business action. */
export class BusinessHost extends SessionAgent {
  #provider?: FauxProviderHandle;
  #lost = false;
  #failReattach = false;
  #evidenceBlocked = false;
  #evidenceFailures = 0;
  readonly #evidenceFailed = Promise.withResolvers<undefined>();
  reopenFailures = 0;
  #retryResolve?: (notBefore: number) => void;
  readonly #retryScheduled = new Promise<number>((resolve) => { this.#retryResolve = resolve; });

  /** The test classifies these rows; the report stays the SDK's own row, minus its id and retry policy. */
  async retrySchedules() {
    const notBefore = await this.#retryScheduled;
    return this.withSession(async () => ({ notBefore, schedules: (await this.listSchedules()).map((schedule) => ({
      callback: schedule.callback, type: schedule.type, time: schedule.time, payload: wakePayload(schedule.payload),
    })) }));
  }


  reportReopenFailures() { return Promise.resolve(this.reopenFailures); }
  async reportEvidenceFailure() { await this.#evidenceFailed.promise; return this.#evidenceFailures; }
  releaseEvidenceReads() { this.#evidenceBlocked = false; return Promise.resolve(); }

  /** The deadline lane shortens the ONE turn budget; every other case runs the production constant. */
  protected override turnDeadlineMs() {
    const configured = this.env.TEST_TURN_DEADLINE_MS;
    return configured === undefined ? super.turnDeadlineMs() : Number(configured);
  }

  /** Only a case that waits for the recurring scan itself opts into a faster one; every other case runs production's. */
  protected override wakeIntervalMs() { return recoveryScanInterval(this.env, super.wakeIntervalMs()); }

  providerRequests() { return { requests: this.#provider?.state.callCount ?? -1 }; }

  /** Only this lane's binding picks the slow script; every other lifecycle case keeps the shared one. */
  #providerScript(): FauxResponseStep[] {
    if (this.env.TEST_TURN_DEADLINE_MS !== undefined) return deadlineResponses();
    return this.env.TEST_RETRY === "true"
      ? [fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 rate limit" }), fauxAssistantMessage("Retried")]
      : [fauxAssistantMessage("Completed"), fauxAssistantMessage("Second completed")];
  }

  #toolsFor(session: Session) {
    return this.env.TEST_TURN_DEADLINE_MS === undefined ? lifecycleTools(session) : deadlineTools(session);
  }

  /** A client that leaves mid-turn: the watch view is cancelled, the turn itself stays with the session. */
  async abandonTurn(request: ModelAdmissionRequest) {
    const streamed = await this.submitChat(request, { anonymousAllowance: 2, now: Date.now() });
    await streamed.body?.cancel();
    return Response.json({ status: streamed.status });
  }

  protected configureDatabase(db: PostgresClient<Contract>) { return db; }

  protected override async initializeSession() {
    const url = this.env.AGENT_SVC_DATABASE_URL;
    if (typeof url !== "string") throw new Error("Disposable database is missing");
    const db = this.configureDatabase(nativeClient(url));
    const metadata = await db.orm.public.PiSession.where({ id: this.name }).first();
    const created = metadata ? undefined : await new NeonSessionRepo(db).create({ id: this.name }, BACKGROUND_CONTEXT);
    const nativeMetadata = created?.metadata ?? metadata?.metadata as unknown as SessionMetadata;
    await created?.close(BACKGROUND_CONTEXT);
    const provider = fauxProvider();
    this.#provider = provider;
    provider.setResponses(this.#providerScript());
    const models = createModels();
    models.setProvider(provider.provider);
    this.bindNeonSession(db, nativeMetadata, (session) => {
      if (this.#failReattach) { this.#failReattach = false; this.reopenFailures += 1; throw new Error("Injected first reattach outage"); }
      const loss = this.env.TEST_LOST_REPLY;
      if (!this.#lost && (loss === "accept" || loss === "drive" || loss === "terminal")) loseNativeReply(session, loss, () => {
        this.#lost = true; this.#failReattach = true; this.#evidenceBlocked = this.env.TEST_WITNESS_OUTAGE === "true";
      });
      gateNativeResultReads(session, () => this.#evidenceBlocked, () => { this.#evidenceFailures += 1; this.#evidenceFailed.resolve(undefined); });
      return { models, model: provider.getModel(), retry: { enabled: true, maxRetries: 1, baseDelayMs: 60_000 },
        toolContext: this.#toolsFor(session) }; });
    if (this.env.TEST_REJECT === "true") await this.withSession((_session, lane, _context, harness) => {
      harness.hooks.on("before_drive", async (_event, context) => {
        const current = (await lane.inspectExecution(context)).current;
        if (!current) throw new Error("The controlled refusal requires an actual operation");
        await persistPermanentRejection(db, { sessionId: this.name, operationId: current.id }, "authorization_revoked");
        throw new Error("Injected lost native response");
      });
      return Promise.resolve();
    });
    if (this.env.TEST_RETRY === "true") await this.withSession((_session, _lane, _context, harness) => {
      harness.events.on("retry_scheduled", (event) => { this.#retryResolve?.(event.notBefore); });
      return Promise.resolve();
    });
  }
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<BusinessHost> }) {
    const input = await request.json() as ModelAdmissionRequest;
    const host = await sessionAgentStub(env.SESSION, input.sessionId);
    if (new URL(request.url).pathname === "/initialize") return new Response("initialized");
    if (new URL(request.url).pathname === "/retry-report") return Response.json(await host.retrySchedules());
    if (new URL(request.url).pathname === "/provider-report") return Response.json(await host.providerRequests());
    if (new URL(request.url).pathname === "/abandon") return host.abandonTurn(input);
    if (new URL(request.url).pathname === "/reopen-report") return Response.json(await host.reportReopenFailures());
    if (new URL(request.url).pathname === "/evidence-failure") return Response.json(await host.reportEvidenceFailure());
    if (new URL(request.url).pathname === "/restore-evidence") { await host.releaseEvidenceReads(); return new Response("restored"); }
    if (new URL(request.url).pathname === "/wake") { await host.wakeSession(); return new Response("woken"); }
    return Response.json(await host.submitModel(input, { anonymousAllowance: 2, now: Date.now() }));
  },
};
