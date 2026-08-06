import { handleGuardRequest } from "./protect/edge-guard.ts";
import { memoryGuardStore, type GuardNamespace, type GuardStore } from "./guard-store.ts";

export interface GuardCall {
  readonly url: string;
  readonly method: string;
}

/** A fixed-clock EDGE_GUARD double; shards are keyed per DO id, and every
 * handled request is appended to `calls` so tests can assert on traffic. */
export function fakeGuard(nowMs: number, calls: GuardCall[] = []): { namespace: GuardNamespace; calls: GuardCall[] } {
  const shards = new Map<string, GuardStore>();
  const namespace = {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: (id: DurableObjectId) => guardHandler(shards, calls, nowMs, id),
  };
  return { namespace, calls };
}

function guardHandler(shards: Map<string, GuardStore>, calls: GuardCall[], nowMs: number, id: DurableObjectId) {
  return {
    fetch: (request: Request) => {
      calls.push({ url: request.url, method: request.method });
      const store = shardFor(shards, String(id));
      return handleGuardRequest(request, store, nowMs, { limit: 20, windowSeconds: 60 });
    },
  };
}

function shardFor(shards: Map<string, GuardStore>, name: string): GuardStore {
  const existing = shards.get(name);
  if (existing) return existing;
  const created = memoryGuardStore();
  shards.set(name, created);
  return created;
}

/** In-memory DurableObjectStorage double with observable alarm state. */
export function fakeStorage() {
  const data = new Map<string, unknown>();
  const alarm = { at: null as number | null, calls: 0 };
  return { data, alarm, state: storageState(data, alarm) };
}

function storageState(data: Map<string, unknown>, alarm: { at: number | null; calls: number }) {
  return {
    get: (key: string) => Promise.resolve(data.get(key)),
    put: (key: string, value: unknown) => { data.set(key, value); return Promise.resolve(); },
    delete: (key: string) => Promise.resolve(data.delete(key)),
    getAlarm: () => Promise.resolve(alarm.at),
    setAlarm: (time: number) => { alarm.at = time; alarm.calls += 1; return Promise.resolve(); },
  };
}
