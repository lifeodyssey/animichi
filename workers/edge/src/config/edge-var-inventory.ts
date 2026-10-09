/**
 * The edge Worker's configuration inventory (issue #688): every plain var
 * `wrangler.toml` declares in every ring, plus the identity credentials the
 * knob store must never answer for, with the class that decides whether
 * changing it needs a deploy. `test/edge-vars-inventory.test.ts` fails when a
 * declared var has no entry here, so adding a var to a ring is incomplete until
 * it is classified.
 *
 * `deploy-coupled` is anything whose value must be a reviewed deploy: identity
 * and exposure gates, abuse controls, and the retired entries kept until the
 * Python-tree removal (#1607). `runtime-tunable` is a value the `EDGE_KNOBS`
 * store may override per request; the first consumers are the two anonymous
 * admission ceilings (#688).
 *
 * The misuse boundary: the store may never answer for a deploy-coupled var,
 * which `runtimeKnob` enforces at construction (`runtime-knobs.ts`) by reading
 * this list, not by convention. A knob must be operational (a number the
 * operator tunes during an incident), never a switch that opens a door or a
 * credential. The module imports nothing, so the knob reader can depend on it.
 */

export type EdgeVarClass = "deploy-coupled" | "runtime-tunable";

export interface EdgeVarClassification {
  readonly name: string;
  readonly class: EdgeVarClass;
  readonly reason: string;
}

/** Every plain var declared across `[vars]`, `[env.staging.vars]` and
 * `[env.production.vars]`, plus the identity credentials the store must never
 * answer for, in one place. */
export const EDGE_VARS: readonly EdgeVarClassification[] = [
  { name: "APP_ENV", class: "deploy-coupled", reason: "deployment identity (#498): each ring declares its own name" },
  { name: "CATALOG_API_URL", class: "deploy-coupled", reason: "no reader; retained until the Python-tree removal retires it (#1607)" },
  { name: "ANON_ACCESS_ENABLED", class: "deploy-coupled", reason: "anonymous exposure gate (#274): opening the front door is a reviewed deploy" },
  { name: "ANON_ID_SECRET", class: "deploy-coupled", reason: "anonymous identity HMAC key: a credential, never a store value" },
  { name: "TURNSTILE_SECRET", class: "deploy-coupled", reason: "Turnstile siteverify credential (#447): a secret, never a store value" },
  { name: "EDGE_SHOWCASE_MODE", class: "deploy-coupled", reason: "showcase gate (S0-v2 C9): landing-only production is a deploy-time decision" },
  { name: "NEON_AUTH_JWKS_URL", class: "deploy-coupled", reason: "the edge's only identity source (AUTH-2 #950): moving the issuer is a deploy" },
  { name: "ANON_RATE_LIMIT", class: "deploy-coupled", reason: "anonymous burst limit: abuse control, not a first-consumer knob (#688)" },
  { name: "ANON_RATE_LIMIT_WINDOW_SECONDS", class: "deploy-coupled", reason: "anonymous burst window: abuse control, not a first-consumer knob (#688)" },
  { name: "AUTH_RATE_LIMIT", class: "deploy-coupled", reason: "authenticated burst limit: abuse control, not a first-consumer knob (#688)" },
  { name: "AUTH_RATE_LIMIT_WINDOW_SECONDS", class: "deploy-coupled", reason: "authenticated burst window: abuse control, not a first-consumer knob (#688)" },
  { name: "CORS_ALLOWED_ORIGIN", class: "deploy-coupled", reason: "backend CORS allowlist; no reader since #1605, retained until #1607" },
  { name: "ANON_DAILY_COST_BUDGET_USD", class: "runtime-tunable", reason: "anonymous daily dollar ceiling: the first consumer (#688)" },
  { name: "ANON_DAILY_MESSAGE_QUOTA", class: "runtime-tunable", reason: "anonymous per-identity daily message ceiling: the first consumer (#688)" },
] as const;
