// Worker entry point — routes requests before OpenNext handles them.
// Intercepts /healthz, /img/* (image proxy), and /catalog/* (catalog service)
// before passing all other requests to the OpenNext-generated Next.js handler.
//
// /catalog/* is forwarded to the separate catalog Worker via the CATALOG
// service binding (see wrangler.toml [[services]]). This serves the frontend
// read APIs (search/spots/nearby/route) over plain JSON.
//
// /v1/* (the agent runtime) is handled by the Next.js middleware.ts inside the
// OpenNext handler (session cookie + JWT + sk_ key validation), which proxies
// to the RuntimeContainer. This worker only intercepts the kinds above.
//
// The pathname -> kind decision lives in worker/router.js so it can be
// unit-tested without the OpenNext build artifact.
import { Container } from "@cloudflare/containers";
import nextHandler from "./.open-next/worker.js";
import { routeKindFor } from "./router.js";

// Re-export Durable Object handlers required by OpenNext cache features.
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

const CONTAINER_ENV_KEYS = [
  "DEEPSEEK_API_KEY",
  "SUPABASE_DB_URL",
  "ANITABI_API_URL",
  "CATALOG_API_URL",
  "APP_ENV",
  "CACHE_TTL_SECONDS",
  "CORS_ALLOWED_ORIGIN",
  "DEBUG",
  "DEFAULT_AGENT_MODEL",
  "FALLBACK_AGENT_MODEL",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "LOG_LEVEL",
  "MAX_RETRIES",
  "OBSERVABILITY_ENABLED",
  "OBSERVABILITY_EXPORTER_TYPE",
  "OBSERVABILITY_OTLP_ENDPOINT",
  "OBSERVABILITY_SERVICE_NAME",
  "OBSERVABILITY_SERVICE_VERSION",
  "OPENAI_COMPAT_BASE_URL",
  "RATE_LIMIT_CALLS",
  "RATE_LIMIT_PERIOD_SECONDS",
  "TIMEOUT_SECONDS",
  "USE_CACHE",
  "ZETA_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "LOGFIRE_TOKEN",
  "OPENAI_COMPAT_API_KEY",
];

const CONTAINER_REQUIRED_KEYS = ["DEEPSEEK_API_KEY", "SUPABASE_DB_URL"];

function buildContainerEnvVars(env) {
  const envVars = {
    APP_ENV: "production",
    SERVICE_HOST: "0.0.0.0",
    SERVICE_PORT: "8080",
  };
  for (const key of CONTAINER_REQUIRED_KEYS) {
    const value = env[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Missing required container env: ${key}`);
    }
    envVars[key] = value;
  }
  for (const key of CONTAINER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      envVars[key] = value;
    }
  }
  return envVars;
}

export class RuntimeContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  enableInternet = true;

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = buildContainerEnvVars(env);
  }
}

async function handleImageProxy(request, pathname, ctx) {
  const imagePath = pathname.slice(5);
  if (!imagePath || imagePath.includes("..")) {
    return new Response("Bad request", { status: 400 });
  }

  const cacheKey = new Request(request.url, request);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(`https://image.anitabi.cn/${imagePath}`, {
    headers: { "User-Agent": "Seichijunrei/1.0" },
  });

  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg" },
    });
  }

  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "public, max-age=604800, s-maxage=2592000");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.delete("Set-Cookie");

  const response = new Response(upstream.body, { status: 200, headers });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const kind = routeKindFor(pathname);

    if (kind === "healthz") {
      return env.CONTAINER.get(env.CONTAINER.idFromName("default")).fetch(request);
    }

    if (kind === "image") {
      return handleImageProxy(request, pathname, ctx);
    }

    if (kind === "catalog") {
      return env.CATALOG.fetch(request);
    }

    return nextHandler.fetch(request, env, ctx);
  },
};
