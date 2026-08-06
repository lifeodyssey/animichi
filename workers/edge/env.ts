/// <reference types="@cloudflare/workers-types" />
import type { GuardNamespace } from "./guard-store.ts";
import type { TileBucket } from "./tiles.ts";

export interface Env {
  CATALOG: { fetch: (req: Request) => Promise<Response> };
  USERS: { fetch: (req: Request) => Promise<Response> };
  CONTAINER: DurableObjectNamespace;
  EDGE_GUARD: GuardNamespace;
  MAP_TILES?: TileBucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Cloudflare Turnstile secret (Worker secret binding — never process.env). */
  TURNSTILE_SECRET: string;
  ANON_ACCESS_ENABLED?: string;
  ANON_ID_SECRET?: string;
  /** Showcase-mode gate (S0-v2 GOAL C / C9): strict boolean, worker-side
   * sibling of the web app's VITE_SHOWCASE_MODE. Only the literal "false"
   * opens functional routes; unset/empty/malformed values fail closed (deny). */
  EDGE_SHOWCASE_MODE?: string;
  [key: string]: unknown;
}

export type WorkerExecutionContext = Pick<ExecutionContext, "waitUntil" | "passThroughOnException">;
