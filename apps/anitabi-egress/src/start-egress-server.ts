/**
 * The reusable bootstrap: read the environment, wire the real ceiling and
 * fetch, bind the port. `server.ts` calls this with `process.env` and the
 * global fetch; the integration test calls it with a loopback stub upstream
 * and port 0 — the same seams, no separate path for tests.
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readEgressConfig, readListenPort, type EgressConfig } from "./egress-config.ts";
import { handleEgressRequest, type EgressDeps, type UpstreamFetch } from "./egress-service.ts";
import { UpstreamRequestCeiling } from "./upstream-ceiling.ts";

export interface EgressServerOptions {
  env: Record<string, string | undefined>;
  port?: number;
  nowSeconds?: () => number;
  upstreamFetch?: UpstreamFetch;
}

/** Start the service; port 0 picks an ephemeral port (tests). */
export async function startEgressServer(options: EgressServerOptions): Promise<{ server: Server; port: number }> {
  const config: EgressConfig | null = readEgressConfig(options.env);
  const deps: EgressDeps = {
    config,
    ceiling: config ? new UpstreamRequestCeiling(config.ceilingPerHour, options.nowSeconds) : null,
    upstreamFetch: options.upstreamFetch ?? fetch,
    nowSeconds: options.nowSeconds ?? (() => Math.floor(Date.now() / 1000)),
  };
  const server = createServer((request, response) => {
    void serve(request, response, deps);
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? readListenPort(options.env), resolve));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("egress server did not bind");
  return { server, port: address.port };
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
