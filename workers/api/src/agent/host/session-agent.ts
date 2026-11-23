import { submitSelection, reconcileSelectionIntent, type SelectionSubmission } from "../selection/native-selection.ts";
import { createCatalogClient } from "@animichi/agent/tools";
import { selectionResponse } from "../views/selection-response.ts";
import { nativeWatchResponse, watchNativeOperation } from "../views/watch-response.ts";
import { modelAdmissionResponse } from "../../gateway/native-admission-response.ts";
import { Agent } from "agents";
import type { AgentLane } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT, withoutAbortSignal, type Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import type { AdmissionOptions, ModelAdmissionOutcome, ModelAdmissionRequest } from "../admission/types.ts";
import { reconcileModelAdmission } from "../admission/reconcile-model-admission.ts";
import { scanAdmissionIntents, scanSelectionIntents, scanUnsettledOperations } from "../recovery/scan.ts";
import { settleModelOperation } from "../settlement/native-settlement.ts";
import { TURN_DEADLINE_MS } from "./turn-deadline.ts";
import { TurnBudget } from "./turn-budget.ts";
import { WAKE_INTERVAL_MS } from "./wake-interval.ts";
import { bootstrapNativeSession } from "./native-bootstrap.ts";
import { watchableReplay } from "./watchable-replay.ts";
import { ConfiguredOperations } from "./configured-operations.ts";
import type { SessionDomain } from "./session-domain.ts";
import type { ByokCredentialParts } from "../byok/byok-credential.ts";
import type { Env } from "../../env.ts";
import { ownsConversation } from "../admission/session-owner.ts";
import { conversationNotFound } from "../../gateway/agent-turn-responses.ts";

type Harness = Awaited<ReturnType<typeof createPilgrimageHarness>>["harness"];

/** Pi owns execution; the native Agent owns lifetime and exclusion across database awaits. */
export class SessionAgent extends Agent<Env> {
  #tail: Promise<void> = Promise.resolve();
  #domain?: SessionDomain;
  #attached?: { session: Session; harness: Harness; lane: AgentLane };
  #faulted = false;
  #driving = false;
  #budget?: TurnBudget;

  /** Every start registers the recovery cadence; domain startup runs only while no domain is bound. When a startup
   * fails after `onStart` returned, the Agents SDK resets its lifecycle and reruns `onStart` on this same instance,
   * and that retry must keep the domain the first attempt bound rather than open a second one. */
  override async onStart() {
    await this.scheduleEvery(this.wakeIntervalMs() / 1000, "wakeSession");
    if (!this.#domain) await this.initializeSession();
  }

  /** Domain startup, which a start runs while no domain is bound: it binds the NeonSessionRepo, its business
   * database and the Env-configured model operations. A host that runs this class on other dependencies overrides
   * it and binds its own domain. */
  protected async initializeSession() {
    const resources = await bootstrapNativeSession(this.env, this.name, BACKGROUND_CONTEXT);
    this.bindSession({ repo: resources.repo, metadata: resources.metadata, compose: resources.compose, business: resources.db, operations: new ConfiguredOperations(resources) });
  }

  /** Bind, once, everything this incarnation runs against. */
  protected bindSession(domain: SessionDomain) {
    if (this.#domain) throw new Error("The session domain is already bound");
    this.#domain = domain;
  }

  /** The domain startup bound; the Agent runs `onStart` before it serves anything that reaches it. */
  #requireDomain() {
    if (!this.#domain) throw new Error("Native session composition must be bound before attachment");
    return this.#domain;
  }

  /** All future admission/selection/settlement writes enter here, before touching business state. */
  protected withSession<T>(work: (session: Session, lane: AgentLane, context: Context, harness: Harness) => Promise<T>, context: Context = BACKGROUND_CONTEXT): Promise<T> {
    const exclusive = this.#tail.then(async () => {
      await this.scheduleEvery(this.wakeIntervalMs() / 1000, "wakeSession");
      const durableContext = withoutAbortSignal(context);
      const attached = await this.#attach(durableContext);
      return work(attached.session, attached.lane, durableContext, attached.harness);
    });
    this.#tail = exclusive.then(() => undefined, () => undefined);
    return exclusive;
  }

  /** The gateway supplies its validated identity; the DO name is the session authority. */
  async submitModel(request: ModelAdmissionRequest, options: AdmissionOptions, credential?: ByokCredentialParts): Promise<ModelAdmissionOutcome> {
    if (request.sessionId !== this.name) return { kind: "forbidden", operationId: null };
    return this.withSession((session, lane, context) => this.#submit(request, options, credential, session, lane, context));
  }

  /** The native watch is paired while the same admission exclusion is held, before any alarm can drive. */
  async submitChat(request: ModelAdmissionRequest, options: AdmissionOptions, credential?: ByokCredentialParts): Promise<Response> {
    if (request.sessionId !== this.name) return modelAdmissionResponse({ kind: "forbidden", operationId: null }, this.name);
    const replay = await this.#replayWhileDriving(request, credential);
    if (replay) return replay;
    return this.withSession(async (session, lane, context) => {
      const outcome = await this.#submit(request, options, credential, session, lane, context);
      if (outcome.kind !== "accepted" && outcome.kind !== "replayed") return modelAdmissionResponse(outcome, this.name);
      return this.#watchOperation(lane, outcome.operationId, context);
    });
  }

  async #replayWhileDriving(request: ModelAdmissionRequest, credential?: ByokCredentialParts): Promise<Response | undefined> {
    const attached = this.#attached;
    if (!this.#driving || this.#faulted || !attached) return undefined;
    const { business, operations } = this.#requireDomain();
    const outcome = await watchableReplay(business, await operations.replayRequest(request, credential));
    if (!outcome || !this.#canReadAttached(attached.lane)) return undefined;
    if (outcome.kind !== "replayed") return modelAdmissionResponse(outcome, this.name);
    return this.#watchOperation(attached.lane, outcome.operationId, BACKGROUND_CONTEXT);
  }

  /** A resumed UI reads the same native watch without model input, credentials or another admission. */
  async watchChat(identityId: string, operationId: string): Promise<Response> {
    if (!await ownsConversation(this.#requireDomain().business, this.name, identityId)) return conversationNotFound();
    const attached = this.#attached;
    if (attached && this.#canReadAttached(attached.lane)) return this.#watchOperation(attached.lane, operationId, BACKGROUND_CONTEXT);
    return this.withSession((_session, lane, context) => this.#watchOperation(lane, operationId, context));
  }

  #canReadAttached(lane: AgentLane) {
    return !this.#faulted && this.#attached?.lane === lane;
  }

  async #watchOperation(lane: AgentLane, operationId: string, context: Context) {
    const watch = await watchNativeOperation(lane, operationId, context);
    if (!watch) return conversationNotFound();
    return nativeWatchResponse(watch, this.name, operationId, this.#requireDomain().operations.scrub(operationId));
  }

  async #submit(request: ModelAdmissionRequest, options: AdmissionOptions, credential: ByokCredentialParts | undefined, session: Session, lane: AgentLane, context: Context) {
    const { operations } = this.#requireDomain();
    if (await this.#reconcileSelections(lane, context)) return { kind: "blocked", operationId: null } as const;
    await this.#reconcileBeforeAdmission(session, lane, context);
    const outcome = await operations.admit(session, lane, context, request, options, credential);
    if (outcome.operationId && outcome.kind !== "rejected") await this.scheduleOperationWake(outcome.operationId);
    return outcome;
  }

  /** Re-read all discovery sources on each wake; SDK open snapshots are never a business index. */
  async wakeSession(): Promise<void> {
    await this.withSession(async (session, lane, context) => {
      const pendingSelection = await this.#reconcileSelections(lane, context);
      const admissions = pendingSelection ? [] : await scanAdmissionIntents(this.#requireDomain().business, this.name);
      for (const admission of admissions) {
        if (admission.operationId !== null) await this.#advanceOperation(session, lane, admission.operationId, context);
      }
      await this.#settleDiscovered(session, lane, context);
    });
  }

  async submitSelection(request: SelectionSubmission): Promise<Response> {
    if (request.sessionId !== this.name) return selectionResponse({ kind: "forbidden" }, this.name);
    return this.withSession(async (session, lane, context) => {
      await this.#reconcileBeforeAdmission(session, lane, context);
      await this.#reconcileSelections(lane, context);
      await this.schedule(0, "wakeSession", { requestKey: request.clientMessageId }, { idempotent: true });
      const outcome = await submitSelection(this.#requireDomain().business, lane, context, request, createCatalogClient((input) => this.env.CATALOG.fetch(input)));
      return selectionResponse(outcome, this.name);
    });
  }

  async #reconcileSelections(lane: AgentLane, context: Context) {
    const db = this.#requireDomain().business;
    const pending = await scanSelectionIntents(db, this.name);
    for (const admission of pending) await reconcileSelectionIntent(db, lane, context, admission, createCatalogClient((input) => this.env.CATALOG.fetch(input)));
    return (await scanSelectionIntents(db, this.name)).length > 0;
  }

  async #reconcileBeforeAdmission(session: Session, lane: AgentLane, context: Context) {
    const db = this.#requireDomain().business;
    const admissions = await scanAdmissionIntents(db, this.name);
    for (const admission of admissions) {
      if (admission.operationId === null) throw new Error("A model admission has no operation ID");
      await reconcileModelAdmission(db, lane, context, { sessionId: this.name, operationId: admission.operationId }, Date.now());
    }
    await this.#settleDiscovered(session, lane, context);
  }

  async #advanceOperation(session: Session, lane: AgentLane, operationId: string, context: Context) {
    const { operations } = this.#requireDomain();
    if (!await operations.prepareDrive(session, lane, operationId, context)) return;
    await this.scheduleOperationWake(operationId);
    const driveContext = await operations.driveContext(session, operationId, context);
    await this.driveLane(lane, operationId, driveContext);
    await this.#settleOperation(session, lane, operationId, context);
  }

  async #settleDiscovered(session: Session, lane: AgentLane, context: Context) {
    const db = this.#requireDomain().business;
    for (const obligation of await scanUnsettledOperations(db, this.name)) {
      await this.#settleOperation(session, lane, obligation.operationId, context);
    }
  }

  async #settleOperation(session: Session, lane: AgentLane, operationId: string, context: Context) {
    const { business, operations } = this.#requireDomain();
    const result = await settleModelOperation(business, session, lane, operationId, context, Date.now());
    if (result) await operations.release(operationId);
  }

  /** Persist before acknowledgment or drive; native callback/payload identity deduplicates retries. */
  protected async scheduleOperationWake(operationId: string, notBefore?: number) {
    const when = notBefore === undefined ? 0 : new Date(Math.ceil(notBefore / 1000) * 1000);
    const payload = notBefore === undefined ? { operationId } : { operationId, notBefore };
    await this.schedule(when, "wakeSession", payload, { idempotent: true });
  }

  /** The recurring recovery cadence; a host subclass may shrink it so a database lane need not wait 30 s of wall clock. */
  protected wakeIntervalMs() { return WAKE_INTERVAL_MS; }

  /** SDK keepalive and one-shot schedules share the SDK's alarm multiplexer. */
  protected async driveLane(lane: AgentLane, operationId: string, context: Context) {
    this.#driving = true;
    try {
      const budget = new TurnBudget(this.name, this.turnDeadlineMs(), this.#requireDomain().business);
      this.#budget = budget;
      await budget.open(lane, operationId, context);
      return await this.#driveAndSchedule(lane, operationId, context);
    } finally { this.#driving = false; this.#budget = undefined; }
  }

  /** The one whole-turn budget; a host subclass may shrink it so a database lane need not wait 100 s of wall clock. */
  protected turnDeadlineMs() { return TURN_DEADLINE_MS; }

  async #driveAndSchedule(lane: AgentLane, operationId: string, context: Context) {
    const result = await this.keepAliveWhile(() => lane.drive({ operationId, waitForRetry: false }, context));
    if (result.ok && result.value.kind === "waiting" && result.value.reason === "retry") {
      const notBefore = result.value.notBefore;
      await this.scheduleOperationWake(operationId, notBefore);
    }
    return result;
  }

  async #attach(context: Context) {
    if (this.#faulted && this.#attached) {
      await this.#attached.harness.close(context);
      this.#attached = undefined;
    }
    if (this.#attached) return this.#attached;
    const domain = this.#requireDomain();
    const session = await domain.repo.open(domain.metadata, context);
    try {
      const { harness } = await createPilgrimageHarness({ ...domain.compose(session), session }, context);
      const lane = await harness.lane("main", context);
      harness.events.on("fault", () => { this.#faulted = true; });
      harness.hooks.on("before_request", (event, requestContext) => this.#budget?.boundModelRequest(lane, event, requestContext));
      this.#faulted = false;
      this.#attached = { session, harness, lane };
      return this.#attached;
    } catch (error) {
      await session.close(context);
      throw error;
    }
  }
}
