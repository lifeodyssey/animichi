import { Container } from "@cloudflare/containers";
import nextHandler from "./.open-next/worker.js";
import { createWorkerApp, catalogOutbound, type Env } from "./app.ts";

export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

const CONTAINER_ENV_KEYS = [
  "DEEPSEEK_API_KEY", "SUPABASE_DB_URL", "ANITABI_API_URL", "CATALOG_API_URL",
  "APP_ENV", "CACHE_TTL_SECONDS", "CORS_ALLOWED_ORIGIN", "DEBUG",
  "DEFAULT_AGENT_MODEL", "FALLBACK_AGENT_MODEL", "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT", "LOG_LEVEL", "MAX_RETRIES", "OBSERVABILITY_ENABLED",
  "OBSERVABILITY_EXPORTER_TYPE", "OBSERVABILITY_OTLP_ENDPOINT", "OBSERVABILITY_SERVICE_NAME",
  "OBSERVABILITY_SERVICE_VERSION", "OPENAI_COMPAT_BASE_URL", "RATE_LIMIT_CALLS",
  "RATE_LIMIT_PERIOD_SECONDS", "TIMEOUT_SECONDS", "USE_CACHE", "ZETA_API_KEY",
  "GEMINI_API_KEY", "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN", "OPENAI_COMPAT_API_KEY",
];
const CONTAINER_REQUIRED_KEYS = ["DEEPSEEK_API_KEY", "SUPABASE_DB_URL"];

function buildContainerEnvVars(env: Record<string, unknown>): Record<string, string> {
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

export class RuntimeContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  enableInternet = true;
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this.envVars = buildContainerEnvVars(env);
  }
}

// Container -> catalog over a private hostname, intercepted here and routed to
// the CATALOG service binding (no public internet). Host matches CATALOG_API_URL.
//
// Deny-by-default: with enableInternet = true and no catch-all in outboundByHost,
// every container outbound EXCEPT catalog.internal goes to the public internet by
// design (the agent calls Anitabi, Bangumi, and LLM APIs directly). Catalog's
// privacy rests entirely on this exact host match — any FUTURE internal-only
// service MUST be added to outboundByHost explicitly; it will NOT be private
// otherwise.
RuntimeContainer.outboundByHost = {
  "catalog.internal": (request: Request, env: Env) => catalogOutbound(request, env),
};

export default createWorkerApp({ nextHandler });
