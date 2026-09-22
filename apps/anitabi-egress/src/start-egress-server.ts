/**
 * The reusable bootstrap: read the environment, wire the real ceiling and
 * fetch, bind the port. `server.ts` calls this with `process.env` and the
 * global fetch; the integration test calls it with a loopback stub upstream
 * and port 0 — the same seams, no separate path for tests.
 *
 * This is also the ONE place the process names the network (#1792, #1824): the
 * global fetch is resolved here and handed to the relay, and the TCP dial the
 * ceiling's store is reached through is built here too. Neither the store
 * module nor the relay names a network module or a global function itself,
 * which is what keeps the whole outbound surface one reviewed injection point.
 *
 * The ceiling is null — every request refused with `configuration` — when the
 * service has no key, no limit, or no STORE to count in. A ceiling that cannot
 * be counted is not enforced, and this service does not run without it.
 *
 * The store's failures leave by a second road (#1833): the ceiling reports each
 * one through the sink below, which is the process's stderr — what `fly logs`
 * reads, and where `docs/ops/anitabi-egress.md` sends an operator looking. The
 * caller's answer is unchanged and still one of three ceiling outcomes; the
 * line is for whoever has to fix the store.
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createConnection, type Socket } from "node:net";
import { ceilingStoreFailureLogger, type LogSink } from "./ceiling-store-log.ts";
import {
  readCeilingStoreConfig,
  readEgressConfig,
  readListenPort,
  type EgressConfig,
} from "./egress-config.ts";
import { handleEgressRequest, type Ceiling, type EgressDeps, type UpstreamFetch } from "./egress-service.ts";
import {
  RedisTcpCeilingStore,
  STORE_TIMEOUT_MS,
  type StoreConnect,
  type StoreSocket,
} from "./redis-tcp-ceiling-store.ts";
import { UpstreamRequestCeiling, type CeilingStore } from "./upstream-ceiling.ts";

export interface EgressServerOptions {
  env: Record<string, string | undefined>;
  port?: number;
  nowSeconds?: () => number;
  upstreamFetch?: UpstreamFetch;
  /** The ceiling's counter, when the caller supplies one (tests); otherwise it is built from the environment. */
  ceilingStore?: CeilingStore;
  /** Where a store failure is written, when the caller owns the stream (tests); otherwise this process's stderr. */
  logSink?: LogSink;
}

/** Start the service; port 0 picks an ephemeral port (tests). */
export async function startEgressServer(options: EgressServerOptions): Promise<{ server: Server; port: number }> {
  const config: EgressConfig | null = readEgressConfig(options.env);
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const outbound: UpstreamFetch = options.upstreamFetch ?? fetch;
  const deps: EgressDeps = {
    config,
    ceiling: ceilingFor(config, options, nowSeconds),
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

/**
 * The ceiling the handler asks: null when the service has no key, no limit, or
 * no store to count in.
 *
 * Exported for one reason, as `connectedWithin` below is: the reporter it hands
 * the ceiling is the only thing that makes a store failure readable to an
 * operator, and a wiring nothing can call is a wiring no test can prove. A
 * request-level test would need a listening port to say the same thing (#1833).
 */
export function ceilingFor(
  config: EgressConfig | null,
  options: EgressServerOptions,
  nowSeconds: () => number,
): Ceiling | null {
  if (config === null) return null;
  const store = options.ceilingStore ?? storeFromEnv(options.env, dialStore);
  if (store === null) return null;
  return new UpstreamRequestCeiling(
    config.ceilingPerHour,
    store,
    ceilingStoreFailureLogger(options.logSink ?? writeToStderr),
    nowSeconds,
  );
}

/**
 * The process's own log stream, and the one the service ships with: `fly logs`
 * is where the operating document sends an operator, and a line written here is
 * on it. It is a sink like any other, so a test can own the stream instead.
 */
function writeToStderr(line: string): void {
  process.stderr.write(line);
}

/** The store the environment names, or null — and null means a ceiling that cannot be counted. */
function storeFromEnv(env: Record<string, string | undefined>, connect: StoreConnect): RedisTcpCeilingStore | null {
  const storeConfig = readCeilingStoreConfig(env);
  return storeConfig === null ? null : new RedisTcpCeilingStore({ ...storeConfig, connect });
}

/** The port a redis URL is dialed on when it names none. */
const DEFAULT_REDIS_PORT = 6379;

/**
 * The one TCP dial this process makes (#1824). It is `family: 6` because the
 * counter lives in the Redis `fly redis create` provisions, which Fly reaches
 * over the org's private IPv6 network — the address the upstream allowlisted
 * is IPv4, and this destination is deliberately not it.
 *
 * The address is the environment's, never a request's: whoever calls this
 * hands it a value `readCeilingStoreConfig` already accepted. The connection it
 * opens is held to the store's own timeout, so a black-holed address is refused
 * as a store this service cannot reach rather than held until the OS gives up
 * on its SYN.
 */
function dialStore(url: string): Promise<StoreSocket> {
  const address = new URL(url);
  const port = address.port === "" ? DEFAULT_REDIS_PORT : Number(address.port);
  const socket = createConnection({ host: address.hostname, port, family: 6 });
  return connectedWithin(socket).then(storeSocket);
}

/**
 * The socket's own side of a dial, as the deadline below needs it: close it, and
 * hear whichever way it ends. Narrower than `net.Socket` on purpose — the socket
 * this process dials and a test's double both fit it.
 */
export interface DialingSocket {
  once(event: "connect", listener: () => void): unknown;
  once(event: "error", listener: (cause: Error) => void): unknown;
  destroy(): unknown;
}

/**
 * The connection, or a refusal — whichever comes first, and never later than the
 * store's own timeout. A store that answers no SYN at all is one this service
 * cannot reach, and `upstream-ceiling` refuses `store-unavailable` only when the
 * store fails: an unreachable store has to fail inside the deadline it is held
 * to, or the request waits out the operating system's TCP timeout instead.
 *
 * The socket is a parameter, and this is exported, for one reason: a dial that
 * never connects is a thing only a socket the caller owns can produce, and the
 * alternative is the network this package's tests never touch.
 */
export function connectedWithin<T extends DialingSocket>(socket: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { socket.destroy(); reject(connectTimedOut()); }, STORE_TIMEOUT_MS);
    socket.once("connect", () => { clearTimeout(deadline); resolve(socket); });
    socket.once("error", (cause) => { clearTimeout(deadline); reject(cause); });
  });
}

/** The refusal a dial that never opened produces: the store is unreachable, not slow. */
function connectTimedOut(): Error {
  return new Error("the ceiling store's connection was not established within its timeout");
}

/** A `net.Socket`, reduced to the four things the store's injected seam uses. */
function storeSocket(socket: Socket): StoreSocket {
  return {
    write: (data) => socket.write(data),
    destroy: () => socket.destroy(),
    onData: (listener) => socket.on("data", listener),
    onError: (listener) => socket.on("error", listener),
    onClose: (listener) => socket.on("close", listener),
  };
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
