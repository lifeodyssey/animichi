import { getAgentByName } from "agents";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { SessionAgent } from "../src/agent/host/session-agent.ts";
import { keepaliveState, composition, observeCleanup, clampDueAlarm, releaseProvider, drainCleanup, observeDrive, alarmSnapshot } from "./native-keepalive-state.ts";

/** A stalled wait fails by name; a healthy wait is settled by its own event, never by this bound. */
function stalledAfter(diagnosticMs: number, description: string) {
  return new Promise<never>((_resolve, reject) => {
    setTimeout(() => { reject(new Error(`Timed out after ${String(diagnosticMs)} ms waiting for ${description}`)); }, diagnosticMs);
  });
}

/** The event is the bound; the diagnostic only renames a stall that would otherwise be a silent timeout. */
function bounded<T>(event: Promise<T>, diagnosticMs: number, description: string) {
  return Promise.race([event, stalledAfter(diagnosticMs, description)]);
}

/** Real SDK scheduling and drive, with a public faux-provider response barrier. */
export class KeepaliveProbe extends SessionAgent {
  static override options = { keepAliveIntervalMs: 1_000 };
  readonly #state = keepaliveState();
  override async onStart() {
    observeCleanup(this.ctx, this.#state.cleanup);
    clampDueAlarm(this.ctx, this.#state);
    Date.now = () => this.#state.clock.now;
    const session = await this.#state.resources.repo.create({ id: this.name }, BACKGROUND_CONTEXT);
    await session.close(BACKGROUND_CONTEXT);
    this.bindSession(this.#state.resources.repo, session.metadata, (opened) => composition(this.#state, opened));
    await super.onStart();
  }
  async startDrive() {
    const deadline = await this.schedule(new Date(this.#state.clock.now + 10_000), "deadline", { operationId: "held" });
    this.#state.deadline = { id: deadline.id, time: deadline.time * 1000 };
    return this.withSession(async (_session, lane, context) => {
      const accepted = await lane.accept({ kind: "prompt", operationId: "held", prompt: "finish" }, context);
      if (!accepted.ok) throw accepted.error;
      return observeDrive(this.#state, () => this.driveLane(lane, "held", context));
    });
  }
  /**
   * The fired deadline's own callback: it records the alarm its fire consumed, then holds until an observer
   * has read the physical alarm an SDK re-arm writes. The delivery happens only after that observer arrives.
   */
  async deadline() {
    this.#state.callbackEntered = true;
    this.#state.alarmAtCallbackEntry = await this.ctx.storage.getAlarm();
    await this.withSession(async (_session, lane, context) => {
      this.#state.boundary.arrived.resolve(undefined);
      await this.#state.boundary.released.promise;
      this.#state.calls.duringDrive = this.#state.calls.active;
      this.#state.calls.result = (await lane.getResult("held", context))?.status ?? "missing";
      this.#state.calls.count += 1;
      this.#state.delivered.resolve(undefined);
    });
  }
  async inspect() {
    const deadline = await this.getScheduleById(this.#state.deadline.id);
    return alarmSnapshot(this.#state, deadline?.id ?? null, await this.ctx.storage.getAlarm());
  }
  waitForProvider() { return this.#state.resources.entered.promise; }
  releaseProvider() { releaseProvider(this.#state); }
  drainCleanup() { return drainCleanup(this.#state); }
  restoreClock() { Date.now = this.#state.clock.realNow; }
  async fireDeadline() {
    this.#state.clock.now = this.#state.deadline.time + 1;
    this.#state.firing = true;
    this.#state.firedAt = this.#state.clock.realNow();
    this.#state.probeArming = true;
    try { await this.ctx.storage.setAlarm(this.#state.firedAt); }
    finally { this.#state.probeArming = false; }
  }

  /** The observer's boundary: the fired deadline's callback is in flight and still undelivered. */
  async awaitCallbackArrival(diagnosticMs: number) {
    await bounded(this.#state.boundary.arrived.promise, diagnosticMs, "the fired deadline's callback");
  }

  /**
   * Release the held callback, then await the delivered event that alone witnesses its one delivery.
   *
   * The count before the release proves the observer arrived while the deadline was undelivered; the count
   * after the event is read synchronously, so only the event can advance it. The diagnostic is never read.
   */
  async awaitDeadlineCallback(diagnosticMs: number) {
    const undeliveredAtArrival = this.#state.calls.count;
    this.#state.boundary.released.resolve(undefined);
    await bounded(this.#state.delivered.promise, diagnosticMs, "the delivered deadline callback");
    return { undeliveredAtArrival, deliveredAtWait: this.#state.calls.count, observation: await this.inspect() };
  }
}

async function probeResponse(host: DurableObjectStub<KeepaliveProbe>, url: URL): Promise<Response> {
  if (url.pathname === "/drive") return Response.json(await host.startDrive());
  if (url.pathname === "/entered") { await host.waitForProvider(); return new Response("entered"); }
  if (url.pathname === "/release") { await host.releaseProvider(); return new Response("released"); }
  if (url.pathname === "/drain") { await host.drainCleanup(); return new Response("drained"); }
  if (url.pathname === "/fire") { await host.fireDeadline(); return new Response("armed"); }
  if (url.pathname === "/alarm-entered") { await host.awaitCallbackArrival(diagnosticMs(url)); return new Response("at the callback boundary"); }
  if (url.pathname === "/restore") { await host.restoreClock(); return new Response("restored"); }
  if (url.pathname === "/callback") return Response.json(await host.awaitDeadlineCallback(diagnosticMs(url)));
  return Response.json(await host.inspect());
}

/** The caller sets its own stall diagnostic; the worker only enforces it, and no assertion reads it. */
function diagnosticMs(url: URL) {
  return Number(url.searchParams.get("diagnosticMs") ?? 30_000);
}

export default {
  async fetch(request: Request, env: { SESSION: DurableObjectNamespace<KeepaliveProbe> }) {
    return probeResponse(await getAgentByName(env.SESSION, "keepalive", { locationHint: "apac" }), new URL(request.url));
  },
};
