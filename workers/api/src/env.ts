/// <reference types="@cloudflare/workers-types" />
// The Worker's binding/context types, imported by every concern folder.
import type { SessionAgent } from "./agent/host/session-agent.ts";
import type { GuardNamespace } from "./protect/guard-store.ts";
import type { R2ObjectBucket } from "./proxy/private-r2-object.ts";

export interface Env {
  CATALOG: { fetch: (req: Request) => Promise<Response> };
  USERS: { fetch: (req: Request) => Promise<Response> };
  EDGE_GUARD: GuardNamespace;
  MAP_TILES?: R2ObjectBucket;
  /** The private docs-asset bucket (#1650); absent fails `/img/docs` closed. */
  DOCS_ASSETS?: R2ObjectBucket;
  /** Neon Auth branch JWKS URL — the edge's only identity source (AUTH-2 #950).
   * Empty/absent fails closed: no JWKS, no verified bearer. */
  NEON_AUTH_JWKS_URL?: string;
  /** Native account secret binding; local development uses .dev.vars strings. */
  TURNSTILE_SECRET: SecretsStoreSecret | string;
  ANON_ACCESS_ENABLED?: string;
  ANON_ID_SECRET?: SecretsStoreSecret | string;
  /** Showcase-mode gate (S0-v2 GOAL C / C9): strict boolean, worker-side
   * sibling of the web app's VITE_SHOWCASE_MODE. Only the literal "false"
   * opens functional routes; unset/empty/malformed values fail closed (deny). */
  EDGE_SHOWCASE_MODE?: string;
  /** Native per-session host; production configurations bind it. */
  AGENT_SESSION?: DurableObjectNamespace<SessionAgent>;
  /** Deployment identity for environment-specific product capabilities. */
  APP_ENV?: string;
  /** Per-identity anonymous message reservation ceiling; zero disables it. */
  ANON_DAILY_MESSAGE_QUOTA?: string;
  ANON_DAILY_COST_BUDGET_USD?: string;
  MIMO_API_KEY?: SecretsStoreSecret | string;
  /** The `agent_svc` Neon DSN. A Cloudflare Secrets Store binding where one is
   * declared (both environments, `docs/ops/secrets.md`), or a plain string
   * from local .dev.vars. */
  AGENT_SVC_DATABASE_URL?: SecretsStoreSecret | string;
  /** Cloudflare-native `ratelimit` binding (issue #680): the COARSE
   * best-effort burst damper. Absent (unit tests, a config without the
   * binding) is treated as an outage — coarseBurstAllow fails open + alerts. */
  RATE_LIMITER?: RateLimit;
  [key: string]: unknown;
}

export type WorkerExecutionContext = Pick<ExecutionContext, "waitUntil" | "passThroughOnException">;

function isStoreSecret(value: unknown): value is SecretsStoreSecret {
  if (typeof value !== "object" || value === null) return false;
  return "get" in value && typeof value.get === "function";
}

/** Native Secrets Store binding, or a plain string from local `.dev.vars`
 * (#1157). Moved here with #1605, when the container env-forwarding allowlist
 * that used to own it was deleted: reading a binding is this module's subject,
 * and the identity gates plus `protect/turnstile.ts` were always its real
 * callers. */
export async function readStoreOrString(value: unknown): Promise<string | undefined> {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (!isStoreSecret(value)) return undefined;
  const text = await value.get();
  return typeof text === "string" && text.length > 0 ? text : undefined;
}
