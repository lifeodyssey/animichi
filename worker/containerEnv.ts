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

// Container-level egress URL-hostname denylist (#284 Task 7). Split out for the
// same reason as the env-var allowlist above: a plain `node --test` importer
// must not pull in `entry.ts`'s `@cloudflare/containers` import chain.
//
// CORRECTION (PR #478 review, second round): `RuntimeContainer.deniedHosts` is
// typed `string[]` but is **not** CIDR-aware. The vendored
// `@cloudflare/containers@0.3.7` implementation
// (`node_modules/@cloudflare/containers/dist/lib/container.js`,
// `simpleGlobMatch`/`matchesHostList`) is a plain string-prefix/suffix glob
// matcher on the **request URL's hostname string** (`*` = any sequence of
// characters) — it does not parse `/`-suffixed CIDR notation at all, and it
// never resolves DNS, so it cannot match against a hostname's *resolved* IP
// either. An earlier revision of this file shipped literal CIDR strings like
// `"10.0.0.0/8"`, which never matched anything (`matchesHostList` would only
// match a hostname that is the literal string `"10.0.0.0/8"`) — a complete
// no-op, caught only because a reviewer read the vendored matcher source
// directly rather than trusting the type (`string[]`) or the docs prose.
//
// What is shipped instead: dotted-decimal glob prefixes that are the correct
// equivalent of the target ranges *when the request URL already contains a
// bare IPv4 literal* (e.g. `http://169.254.169.254/` — the common shape for
// cloud-metadata SSRF, and the literal shape of the spec's Task 7 AC). This is
// a **URL-hostname-layer denylist, not a network/CIDR policy**:
//   - it does NOT catch DNS rebinding (a hostname that *resolves* to a denied
//     IP but isn't itself a denied literal/glob) — that remains the
//     application-layer guard's job (`egress_guard`/`GuardedAsyncTransport`,
//     Task 1);
//   - it DOES catch the literal well-known metadata hostname
//     `metadata.google.internal` and the two well-known non-IMDS metadata IPs
//     below, in addition to the three glob-representable ranges.
// See `docs/ops/cloudflare-hardening.md` §6 for the full corrected spike
// writeup and the AC disposition against this reality.
const RFC1918_172_BLOCK = Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*`); // 172.16.0.0/12
const CGNAT_100_BLOCK = Array.from({ length: 64 }, (_, i) => `100.${64 + i}.*`); // 100.64.0.0/10

export const DENIED_EGRESS_HOSTS = [
  "10.*", // RFC1918 10.0.0.0/8 — glob-exact equivalent
  ...RFC1918_172_BLOCK, // RFC1918 172.16.0.0/12
  "192.168.*", // RFC1918 192.168.0.0/16 — glob-exact equivalent
  "169.254.*", // link-local 169.254.0.0/16 — glob-exact equivalent; covers AWS/Azure/GCP IMDS IP literal
  ...CGNAT_100_BLOCK, // CGNAT 100.64.0.0/10
  "100.100.100.200", // Alibaba/Tencent metadata (exact; already covered by the CGNAT block above, kept explicit)
  "192.0.0.192", // Oracle Cloud Infrastructure metadata
  "metadata.google.internal", // GCP metadata hostname literal (not an IP; glob ranges above cannot match this)
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
