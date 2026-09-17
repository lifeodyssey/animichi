/**
 * Shared gateway test doubles (#1605). Moved out of `src/container/entry-env.ts`
 * when the container folder was deleted: every surviving helper here is a double
 * for the WORKER's entry surface — an execution context, a CATALOG binding, an
 * always-allow guard — not container plumbing, so it belongs under
 * `test/doubles/` (production code never imports test fixtures,
 * `workers/edge/AGENTS.md`). The one helper that was container plumbing,
 * `envWithContainer`, was deleted with the container rather than moved.
 */
import type { WorkerExecutionContext } from "../../src/env.ts";

export const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

/** The same context, except that the work it schedules is awaited by the case:
 * a cache write runs off the response path, so a case that asserts on the write
 * has to hold its promise itself. */
export function collectingCtx(settled: Promise<unknown>[]): WorkerExecutionContext {
  return { waitUntil: (promise) => { settled.push(promise); }, passThroughOnException: () => undefined };
}

export function envWithCatalog(captured: { req?: Request }) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    CATALOG: { fetch: (r: Request) => { captured.req = r; return Promise.resolve(new Response("cat")); } },
  } as never;
}

/** An EDGE_GUARD stand-in that always allows — these tests exercise routing
 * and header handling, not the limiter itself (see byok.test.ts / Task 9). */
export const alwaysAllowGuard = {
  idFromName: (name: string) => name as unknown as DurableObjectId,
  get: () => ({
    fetch: () =>
      Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))),
  }),
};

/** The env most gateway cases need: showcase off, the always-allow guard, and
 * nothing downstream. Named for the surface rather than for a binding it no
 * longer carries — `CONTAINER` went with the container (#1605). */
export function gatewayEnv(extra: Record<string, unknown> = {}): never {
  return { EDGE_SHOWCASE_MODE: "false", EDGE_GUARD: alwaysAllowGuard, ...extra } as never;
}
