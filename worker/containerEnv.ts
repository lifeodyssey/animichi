/**
 * The env-var forwarding allowlist between the worker and the container.
 *
 * Split out of `entry.ts` (issue #282 review) so this pure function can be
 * unit-tested under plain `node --test`: `entry.ts` imports `Container` from
 * `@cloudflare/containers`, whose ESM build uses an extensionless relative
 * import that only resolves under workerd's module loader, not Node's. A test
 * that imported `buildContainerEnvVars` straight from `entry.ts` would pull
 * that broken import chain in and fail with `ERR_MODULE_NOT_FOUND` outside
 * `wrangler dev`/deploy — this module has no such dependency.
 */

export const CONTAINER_ENV_KEYS = [
  "DEEPSEEK_API_KEY", "MIMO_API_KEY", "SUPABASE_DB_URL", "ANITABI_API_URL", "CATALOG_API_URL",
  "APP_ENV", "CACHE_TTL_SECONDS", "CORS_ALLOWED_ORIGIN", "DEBUG",
  "DEFAULT_AGENT_MODEL", "FALLBACK_AGENT_MODEL", "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT", "LOG_LEVEL", "MAX_RETRIES", "OBSERVABILITY_SERVICE_NAME",
  "OBSERVABILITY_SERVICE_VERSION", "OPENAI_COMPAT_BASE_URL", "RATE_LIMIT_CALLS",
  "RATE_LIMIT_PERIOD_SECONDS", "TIMEOUT_SECONDS", "USE_CACHE", "ZETA_API_KEY",
  "GEMINI_API_KEY", "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN", "OPENAI_COMPAT_API_KEY",
  // Anonymous daily-budget circuit breaker (X4): the container ingress owns the
  // authoritative decision because it is the only tier that reads daily_usage.
  "ANON_DAILY_COST_BUDGET_USD", "MODEL_INPUT_COST_PER_MTOK_USD", "MODEL_OUTPUT_COST_PER_MTOK_USD",
  // Per-identity anonymous daily message quota (issue #282, S1.10): same
  // container-ingress-authoritative reasoning as the budget breaker above.
  "ANON_DAILY_MESSAGE_QUOTA",
];

export const CONTAINER_REQUIRED_KEYS = ["DEEPSEEK_API_KEY", "MIMO_API_KEY", "SUPABASE_DB_URL"];

// Container-level egress network policy (#284 Task 7). Split out for the same
// reason as the env-var allowlist above: a plain `node --test` importer must not
// pull in `entry.ts`'s `@cloudflare/containers` import chain. See
// `docs/ops/cloudflare-hardening.md` §6 for the full spike + rationale — this is
// `RuntimeContainer.deniedHosts` (accepts IP CIDR, enforced before any outbound
// handler, unconditional even with `enableInternet: true`).
export const DENIED_EGRESS_CIDRS = [
  "10.0.0.0/8", // RFC1918
  "172.16.0.0/12", // RFC1918
  "192.168.0.0/16", // RFC1918
  "169.254.0.0/16", // link-local (AWS/Azure/GCP IMDS)
  "100.64.0.0/10", // CGNAT (Alibaba/Tencent metadata)
];

export function buildContainerEnvVars(env: Record<string, unknown>): Record<string, string> {
  const envVars: Record<string, string> = { APP_ENV: "production", SERVICE_HOST: "0.0.0.0", SERVICE_PORT: "8080" };
  for (const key of CONTAINER_REQUIRED_KEYS) {
    const value = env[key];
    if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required container env: ${key}`);
    envVars[key] = value;
  }
  for (const key of CONTAINER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) envVars[key] = value;
  }
  return envVars;
}
