/// <reference types="@cloudflare/workers-types" />
// TODO(#841 path-delta): shared Env/context types — stays at the worker root
// (imported by every concern folder) until the #853 package-ization.
import type { NamedStubs } from "./agent/durable-namespace.ts";
import type { GuardNamespace } from "./protect/guard-store.ts";
import type { TileBucket } from "./proxy/tiles.ts";

export interface Env {
  CATALOG: { fetch: (req: Request) => Promise<Response> };
  USERS: { fetch: (req: Request) => Promise<Response> };
  CONTAINER: DurableObjectNamespace;
  EDGE_GUARD: GuardNamespace;
  MAP_TILES?: TileBucket;
  /** Neon Auth branch JWKS URL — the edge's only identity source (AUTH-2 #950).
   * Empty/absent fails closed: no JWKS, no verified bearer. */
  NEON_AUTH_JWKS_URL?: string;
  /** Cloudflare Turnstile secret (Worker secret binding — never process.env). */
  TURNSTILE_SECRET: string;
  ANON_ACCESS_ENABLED?: string;
  ANON_ID_SECRET?: string;
  /** Showcase-mode gate (S0-v2 GOAL C / C9): strict boolean, worker-side
   * sibling of the web app's VITE_SHOWCASE_MODE. Only the literal "false"
   * opens functional routes; unset/empty/malformed values fail closed (deny). */
  EDGE_SHOWCASE_MODE?: string;
  /** Per-session `AgentSession` DO — the instance one turn runs inside (#1252).
   * Optional for the same reason as `RUN_SWEEPER` below: every deployed
   * environment binds it, and the gateway tests construct envs without it. */
  AGENT_SESSION?: NamedStubs;
  /** Which tier serves `POST /v1/chat` and the transcript GET (W1-7 #1256):
   * only the literal "edge" moves them onto this Worker's own agent tier;
   * unset/anything else keeps forwarding to the Python container. */
  AGENT_TURN_ROUTE?: string;
  /** Per-identity anonymous daily message allowance (#282). Read by BOTH the
   * container (through `CONTAINER_ENV_KEYS`) and, since #1256, by the edge's
   * own intake — whichever tier the flag above selected is the one enforcing
   * it. `0`/unset disables the ceiling. */
  ANON_DAILY_MESSAGE_QUOTA?: string;
  /** Singleton `RunSweeper` DO — the at-least-once backstop for agent turns
   * (#1251). Optional: it is bound in every deployed environment, but the
   * gateway tests construct envs without it. */
  RUN_SWEEPER?: NamedStubs;
  /** The `agent_svc` Neon DSN. A Cloudflare Secrets Store binding where one is
   * declared (staging, `docs/ops/secrets.md`), a plain string in local dev, and
   * absent in production until the #855 cutover provisions it. */
  AGENT_SVC_DATABASE_URL?: { get: () => Promise<string> } | string;
  /** Cloudflare-native `ratelimit` binding (issue #680): the COARSE
   * best-effort burst damper. Absent (unit tests, a config without the
   * binding) is treated as an outage — coarseBurstAllow fails open + alerts. */
  RATE_LIMITER?: RateLimit;
  [key: string]: unknown;
}

export type WorkerExecutionContext = Pick<ExecutionContext, "waitUntil" | "passThroughOnException">;
