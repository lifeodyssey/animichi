/**
 * The Worker one staging-prefix request meets (E-1 #1380), wrapped in the two
 * things a case reads afterwards: where the request ended, and what it carried.
 *
 * The whole app is real — `createWorkerApp` with its own gateway — because the
 * cases are about ROUTING: whether a request reached the session's Durable
 * Object, was forwarded to the Python container, or was answered by the gateway
 * before either. Only the three bindings a request of this shape touches are
 * doubles, and each one records rather than asserts.
 */
import { createWorkerApp, type WorkerDeps } from "../../src/app.ts";
import { fakeGuard } from "./guard-doubles.ts";

/** One seeding path, on the session every case in this folder names. */
export const SEED_PATH = "/v1/staging/sessions/session-42/prefix";

const NOW = Date.UTC(2026, 8, 6, 9, 0, 0);

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

/** A caller whose Neon Auth bearer verified. */
export const AUTHED: WorkerDeps = {
  authenticate: () => Promise.resolve({ ok: true, userId: "qa-neon-user", userType: "human" } as const),
};

export interface StagingPrefixHarness {
  readonly post: (path: string, body: string) => Promise<Response>;
  /** One request built by the case itself — a streamed body, say. */
  readonly send: (request: Request) => Promise<Response>;
  /** Every request the session's Durable Object was handed. */
  readonly seeded: Request[];
  /** Every request forwarded to the Python container instead. */
  readonly forwarded: Request[];
}

export function makeStagingPrefixHarness(appEnv: string | undefined, deps: WorkerDeps): StagingPrefixHarness {
  const seeded: Request[] = [];
  const forwarded: Request[] = [];
  const app = createWorkerApp(deps);
  const env = {
    APP_ENV: appEnv,
    AGENT_TURN_ROUTE: "edge",
    EDGE_SHOWCASE_MODE: "false",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    EDGE_GUARD: fakeGuard(NOW).namespace,
    AGENT_SESSION: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (request: Request) => {
          seeded.push(request);
          return Promise.resolve(Response.json({ session_id: "session-42", seeded: true }));
        },
      }),
    },
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({
        fetch: (request: Request) => {
          forwarded.push(request);
          return Promise.resolve(new Response("container", { status: 404 }));
        },
      }),
    },
  } as never;
  const post = async (path: string, body: string): Promise<Response> =>
    await app.request(path, { method: "POST", body }, env, stubCtx);
  const send = async (request: Request): Promise<Response> => await app.fetch(request, env, stubCtx);
  return { seeded, forwarded, post, send };
}
