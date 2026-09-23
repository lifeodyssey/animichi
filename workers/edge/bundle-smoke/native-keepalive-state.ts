import type { Session, AgentLane } from "@earendil-works/pi-agent-core";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createCatalogClient } from "@animichi/agent/tools";

function nativeResources() {
  const entered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  const provider = fauxProvider();
  provider.setResponses([async () => { entered.resolve(undefined); await released.promise; return fauxAssistantMessage("completed"); }]);
  const models = createModels();
  models.setProvider(provider.provider);
  return { entered, released, provider, models, repo: new MemorySessionRepo() };
}

function cleanupObservation() {
  return { collecting: false, promises: new Array<Promise<unknown>>() };
}

/** One physical-alarm write, in the order it reached the probe's wrapper. */
export interface AlarmWrite {
  /** Who asked for it: the probe's own fire, or the SDK. */
  source: "probe" | "sdk";
  /** The instant that was asked for. */
  requested: number;
  /** The instant the clamp asked the runtime to keep — the runtime may keep its own clock a moment later. */
  stored: number;
  /** Whether the fired deadline's callback had already started when the write arrived. */
  afterCallbackEntry: boolean;
}

/** The fired deadline's callback, and the observer's handshake with the delivery it must witness. */
function callbackBoundary() {
  return { arrived: Promise.withResolvers<undefined>(), released: Promise.withResolvers<undefined>() };
}

export function keepaliveState() {
  return {
    resources: nativeResources(), cleanup: cleanupObservation(),
    clock: { realNow: Date.now, now: Math.ceil(Date.now() / 1000) * 1000 + 60_000 },
    deadline: { id: "", time: 0 }, firing: false, firedAt: null as number | null,
    alarmAtCallbackEntry: null as number | null, callbackEntered: false, probeArming: false,
    writes: new Array<AlarmWrite>(), boundary: callbackBoundary(),
    calls: { count: 0, active: false, duringDrive: false, result: "pending" },
    delivered: Promise.withResolvers<undefined>(),
  };
}

export function composition(state: ReturnType<typeof keepaliveState>, session: Session) {
  return { models: state.resources.models, model: state.resources.provider.getModel(), toolContext: {
    session, branch: "main", locale: "en",
    catalog: createCatalogClient(() => Promise.reject(new Error("Unexpected catalog request"))),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve(),
  } };
}

/** Observe the SDK's actual promises while forwarding every call to the native context unchanged. */
export function observeCleanup(ctx: DurableObjectState, cleanup: ReturnType<typeof cleanupObservation>) {
  const waitUntil = ctx.waitUntil.bind(ctx);
  ctx.waitUntil = (promise: Promise<unknown>) => {
    if (cleanup.collecting) cleanup.promises.push(promise);
    waitUntil(promise);
  };
}

/**
 * Keep the physical alarm in the past while the fired deadline is undelivered, and ledger every write.
 *
 * The probe freezes `Date.now`, so an SDK re-arm landing after the fire recomputes its heartbeat ~70 s
 * into the real future; without this clamp that write displaces the due deadline and it is never delivered.
 * The ledger is what lets the probe name the SDK's re-arm as a write rather than reading an entry state
 * that any component may have set: `source` separates the probe's own fire from the SDK's writes, and
 * `afterCallbackEntry` separates a write made while the fired deadline's callback was in flight — the
 * keepalive re-arm — from anything armed before the callback started. The instant this writes is the
 * probe's clock, and the runtime keeps `max(that, its own now)` for a due instant, so a reader must not
 * expect the alarm it reads back to equal `stored` to the millisecond (#1900).
 */
export function clampDueAlarm(ctx: DurableObjectState, state: ReturnType<typeof keepaliveState>) {
  const storage = ctx.storage;
  const setAlarm = storage.setAlarm.bind(storage);
  storage.setAlarm = (time: number | Date) => {
    const requested = time instanceof Date ? time.getTime() : time;
    const stored = state.firing && state.calls.count === 0 ? state.clock.realNow() : requested;
    state.writes.push({ source: state.probeArming ? "probe" : "sdk", requested, stored,
      afterCallbackEntry: state.callbackEntered });
    return setAlarm(stored);
  };
}

export function releaseProvider(state: ReturnType<typeof keepaliveState>) {
  state.cleanup.collecting = true;
  state.resources.released.resolve(undefined);
}

export async function drainCleanup(state: ReturnType<typeof keepaliveState>) {
  state.cleanup.collecting = false;
  await Promise.all(state.cleanup.promises);
  state.cleanup.promises.length = 0;
}

export async function observeDrive(state: ReturnType<typeof keepaliveState>, drive: () => ReturnType<AgentLane["drive"]>) {
  state.calls.active = true;
  try { const result = await drive(); return { kind: result.ok ? result.value.kind : "error" }; }
  finally { state.calls.active = false; }
}

export function alarmSnapshot(state: ReturnType<typeof keepaliveState>, deadlineId: string | null, alarm: number | null) {
  return { deadlineId, deadlineTime: state.deadline.time, alarm, callbackCount: state.calls.count,
    callbackDuringDrive: state.calls.duringDrive, driveActive: state.calls.active, completedStatus: state.calls.result,
    physicalNow: state.clock.realNow(), firedAt: state.firedAt, alarmAtCallbackEntry: state.alarmAtCallbackEntry,
    writes: [...state.writes] };
}
