// Worker entry point — routes requests before OpenNext handles them.
// Intercepts /v1/* (container proxy) and /img/* (image proxy) before
// passing all other requests to the OpenNext-generated Next.js handler.
//
// Auth for /v1/* is handled by Next.js middleware.ts (session cookie +
// JWT + sk_ key validation). This worker only proxies to the container.
import { Container } from "@cloudflare/containers";
import nextHandler from "./.open-next/worker.js";

// Re-export Durable Object handlers required by OpenNext cache features.
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

const CONTAINER_ENV_KEYS = [
  "DEEPSEEK_API_KEY",
  "SUPABASE_DB_URL",
  "ANITABI_API_URL",
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

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // ── Health check — bypass Next.js for fast container probe ──
    if (pathname === "/healthz") {
      const id = env.CONTAINER.idFromName("default");
      return env.CONTAINER.get(id).fetch(request);
    }

    // /v1/* routes go through OpenNext → middleware.ts (auth) → API route handler (container proxy)

    // ── Image proxy: /img/* → anitabi CDN ──
    if (pathname.startsWith("/img/")) {
      const imagePath = pathname.slice(5);
      if (!imagePath || imagePath.includes("..")) {
        return new Response("Bad request", { status: 400 });
      }

      const upstreamUrl = `https://image.anitabi.cn/${imagePath}`;
      const cacheKey = new Request(request.url, request);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const upstream = await fetch(upstreamUrl, {
        headers: { "User-Agent": "Seichijunrei/1.0" },
      });

      if (!upstream.ok) {
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "Content-Type":
              upstream.headers.get("Content-Type") || "image/jpeg",
          },
        });
      }

      const headers = new Headers(upstream.headers);
      headers.set(
        "Cache-Control",
        "public, max-age=604800, s-maxage=2592000",
      );
      headers.set("Access-Control-Allow-Origin", "*");
      headers.delete("Set-Cookie");

      const response = new Response(upstream.body, { status: 200, headers });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // ── Everything else: Next.js SSR via OpenNext ──
    return nextHandler.fetch(request, env, ctx);
  },
};
