/**
 * The reusable bootstrap: read the environment, wire the real ceiling and
 * fetch, bind the port. `server.ts` calls this with `process.env` and the
 * global fetch; the integration test calls it with a loopback stub upstream
 * and port 0 — the same seams, no separate path for tests.
 *
 * This is also the ONE place the process names the global network function
 * (#1792): the value is resolved here and handed to both of the two things
 * that use it — the relay, and the external store the ceiling counts in
 * (#1810). Neither module names a network module or a global function itself,
 * which is what keeps the whole outbound surface one reviewed injection point.
 *
 * The ceiling is null — every request refused with `configuration` — when the
 * service has no key, no limit, or no STORE to count in. A ceiling that cannot
 * be counted is not enforced, and this service does not run without it.
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  readCeilingStoreConfig,
  readEgressConfig,
  readListenPort,
  type EgressConfig,
} from "./egress-config.ts";
import { handleEgressRequest, type Ceiling, type EgressDeps, type UpstreamFetch } from "./egress-service.ts";
import { RedisRestCeilingStore, type StoreTransport } from "./redis-rest-ceiling-store.ts";
import { UpstreamRequestCeiling, type CeilingStore } from "./upstream-ceiling.ts";

export interface EgressServerOptions {
  env: Record<string, string | undefined>;
  port?: number;
  nowSeconds?: () => number;
  upstreamFetch?: UpstreamFetch;
  /** The ceiling's counter, when the caller supplies one (tests); otherwise it is built from the environment. */
  ceilingStore?: CeilingStore;
}

/** Start the service; port 0 picks an ephemeral port (tests). */
export async function startEgressServer(options: EgressServerOptions): Promise<{ server: Server; port: number }> {
  const config: EgressConfig | null = readEgressConfig(options.env);
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const outbound: UpstreamFetch = options.upstreamFetch ?? fetch;
  const deps: EgressDeps = {
    config,
    ceiling: ceilingFor(config, options, outbound, nowSeconds),
    upstreamFetch: outbound,
    nowSeconds,
  };
  const server = createServer((request, response) => {
    void serve(request, response, deps);
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? readListenPort(options.env), resolve));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("egress server did not bind");
  return { server, port: address.port };
}

/** The ceiling the handler asks: null when the service has no key, no limit, or no store to count in. */
function ceilingFor(
  config: EgressConfig | null,
  options: EgressServerOptions,
  outbound: UpstreamFetch,
  nowSeconds: () => number,
): Ceiling | null {
  if (config === null) return null;
  const store = options.ceilingStore ?? storeFromEnv(options.env, outbound);
  return store === null ? null : new UpstreamRequestCeiling(config.ceilingPerHour, store, nowSeconds);
}

/** The store the environment names, or null — and null means a ceiling that cannot be counted. */
function storeFromEnv(env: Record<string, string | undefined>, transport: StoreTransport): RedisRestCeilingStore | null {
  const storeConfig = readCeilingStoreConfig(env);
  return storeConfig === null ? null : new RedisRestCeilingStore({ ...storeConfig, transport });
}

async function serve(request: IncomingMessage, response: ServerResponse, deps: EgressDeps): Promise<void> {
  const answer = await handleEgressRequest(toRequest(request), deps);
  response.writeHead(answer.status, headersToObject(answer.headers));
  response.end(Buffer.from(await answer.arrayBuffer()));
}

/** Lift the node:http pair into the one Request the handler reads. GETs carry no body. */
function toRequest(request: IncomingMessage): Request {
  const host = request.headers.host ?? "localhost";
  const url = `http://${host}${request.url ?? "/"}`;
  return new Request(url, { method: request.method, headers: flatHeaders(request.headers) });
}

/** Fetch `Headers` → the plain record node:http writes. */
function headersToObject(headers: Headers): Record<string, string> {
  const flat: Record<string, string> = {};
  headers.forEach((value, name) => { flat[name] = value; });
  return flat;
}

/** node:http's header record (values may repeat) → the single-valued form Request reads. */
function flatHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") flat[name] = value;
    else if (Array.isArray(value) && value[0] !== undefined) flat[name] = value[0];
  }
  return flat;
}
