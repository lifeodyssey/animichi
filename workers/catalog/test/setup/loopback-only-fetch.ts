/**
 * The global `fetch` of the two Node test pools (`vitest.node.config.ts`,
 * `vitest.integration.config.ts`) reaches this machine's loopback only. Root
 * `AGENTS.md` forbids a test to request a third-party upstream. The workerd
 * pool refuses such a request in `vitest.config.ts`; without this file a Node
 * test's `fetch` would go straight out or, in a run with `NODE_USE_ENV_PROXY=1`,
 * through the proxy the environment names.
 *
 * A request to any other host is refused before anything is sent, a name
 * lookup included: the refusal is logged and thrown, naming the method and the
 * URL, as an error no upstream produces (not a status, not `fetch failed`). A
 * request to loopback, such as a server a test started, goes to Node's fetch.
 *
 * The guard is defined on `globalThis` directly, never through `vi.stubGlobal`:
 * vitest records the value a stub replaces and `vi.unstubAllGlobals()` puts it
 * back, so a test's unstub restores this refusal rather than the network. It is
 * not a spy either, so `vi.restoreAllMocks()` leaves it in place.
 *
 * Only the global `fetch` is guarded. `pg` reaches the test container over its
 * own socket, testcontainers reaches Docker from `globalSetup` (which this file
 * never runs in), Miniflare drives its workerd through its own undici, and no
 * suite in these lanes sends a request through `node:http` or `node:https`
 * itself (`test/loopback-server.ts` only serves one).
 */
const nodeFetch = globalThis.fetch;

/** Loopback as the URL parser spells it: it lowercases names and canonicalises IP addresses. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The method and URL a `fetch` call asks for. */
interface RequestLine {
  readonly method: string;
  readonly url: URL;
}

/** A loopback request goes to Node's fetch; any other is refused unsent. */
const loopbackOnlyFetch: typeof fetch = async (input, init) => {
  const request = requestLine(input, init);
  if (!LOOPBACK_HOSTS.has(request.url.hostname)) throw refusal(request);
  return await nodeFetch(input, init);
};

function requestLine(input: RequestInfo | URL, init?: RequestInit): RequestLine {
  if (input instanceof Request) return { method: init?.method ?? input.method, url: new URL(input.url) };
  return { method: init?.method ?? "GET", url: new URL(input) };
}

/** Log the refused request and return the error that names it. */
function refusal({ method, url }: RequestLine): Error {
  const message = `node test pool refused an outbound request: ${method} ${url.href} (stub fetch in the test)`;
  console.error(message);
  return new Error(message);
}

Object.defineProperty(globalThis, "fetch", { value: loopbackOnlyFetch, writable: true, configurable: true, enumerable: true });
