/**
 * The collaborators outside the gateway that a characterization pin's request
 * can reach, each a recording double that writes one line per call into the
 * case's ordered log (the same log `entry-seam.ts` hands the injected seams):
 * the USERS and CATALOG service bindings, the MAP_TILES and DOCS_ASSETS
 * buckets, the edge cache and the global `fetch` the Anitabi image arm calls.
 * The two limiter bindings are `entry-seam-limiters.ts`.
 *
 * Each answers from a literal table here, so a pin states both what the gateway
 * asked and what it was told. `fetch` answers the image origin only: any other
 * URL is refused, so a request no stub answers fails its case instead of
 * reaching the network.
 */
import type { TestContext } from "node:test";
import type { Env } from "../../src/env.ts";
import { guardNamespace, nativeLimiter, type LimiterPlan } from "./entry-seam-limiters.ts";

const IMAGE_ORIGIN = "https://image.anitabi.cn/";

/** The Anitabi origin's answer, with two headers the gateway must not hand on as they are. */
function imageAnswer(): Response {
  return new Response("jpeg-bytes", {
    headers: {
      "Content-Type": "image/jpeg",
      "Set-Cookie": "origin=tracking",
      "X-Request-Id": "1e1e1e1e-0000-4000-8000-000000000000",
    },
  });
}

function recordingOrigin(log: string[]): typeof fetch {
  return (input) => {
    const url = input instanceof Request ? input.url : String(input);
    log.push(`origin ${url}`);
    return url.startsWith(IMAGE_ORIGIN)
      ? Promise.resolve(imageAnswer())
      : Promise.reject(new TypeError(`no stub answers ${url}`));
  };
}

const NO_HIT_CACHE = {
  match: (): Promise<Response | undefined> => Promise.resolve(undefined),
  put: (): Promise<void> => Promise.resolve(),
};

/** `caches.default` is a workerd global that `node --test` lacks; the image arm reads it unguarded. */
function installEdgeCache(t: TestContext): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches") ?? { configurable: true, value: undefined };
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: NO_HIT_CACHE } });
  t.after(() => { Object.defineProperty(globalThis, "caches", previous); });
}

/** Replace every outbound path before the case's first request can reach one. */
export function stubOutbound(t: TestContext, log: string[]): void {
  t.mock.method(globalThis, "fetch", recordingOrigin(log));
  installEdgeCache(t);
}

function pathOf(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

/** The platform's own `fetch`, taken before any case replaces the global. It is
 * only ever handed a `data:` URL, which never leaves the process. */
const platformFetch = fetch.bind(globalThis);

/** A service binding's answer as workerd hands it over: with immutable headers,
 * so a gateway that writes onto a forwarded answer in place fails here as it
 * would in production. A `data:` URL fetch is how Node mints such an answer. */
function bindingAnswer(type: string, body: string): Promise<Response> {
  return platformFetch(`data:${type},${encodeURIComponent(body)}`);
}

function usersBinding(log: string[]): Env["USERS"] {
  return {
    fetch: (request) => {
      const identity = `${request.headers.get("X-User-Id") ?? "-"}/${request.headers.get("X-User-Type") ?? "-"}`;
      log.push(`users ${request.method} ${pathOf(request)} as ${identity}`);
      return bindingAnswer("text/plain", `users ${request.method} ${pathOf(request)}`);
    },
  };
}

function catalogBinding(log: string[]): Env["CATALOG"] {
  return {
    fetch: (request) => {
      log.push(`catalog ${request.method} ${pathOf(request)}`);
      return bindingAnswer("application/json", '{"service":"catalog"}');
    },
  };
}

type Bucket = NonNullable<Env["MAP_TILES"]>;
type StoredObject = Readonly<{ body: string; etag: string }>;

const TILE_OBJECTS: Readonly<Record<string, StoredObject>> = {
  "tiles/styles/basemap.json": { body: '{"version":8}', etag: "etag-style" },
  "tiles/14/135/892.mvt": { body: "mvt-bytes", etag: "etag-mvt" },
};
const DOCS_OBJECTS: Readonly<Record<string, StoredObject>> = {
  "archive/a.png": { body: "png-bytes", etag: "etag-png" },
};

function bucket(log: string[], name: string, objects: Readonly<Record<string, StoredObject>>): Bucket {
  return {
    get: (key) => {
      log.push(`${name} ${key}`);
      const stored = objects[key];
      const object = stored === undefined ? null : { body: new Response(stored.body).body, etag: stored.etag, size: stored.body.length };
      return Promise.resolve(object);
    },
  };
}

/** Anonymous access on, showcase off, the fixed test keys; a case's `vars` override any of them. */
const VARS = {
  EDGE_SHOWCASE_MODE: "false",
  ANON_ACCESS_ENABLED: "true",
  ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000",
  TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
};

export function entryEnv(log: string[], plan: LimiterPlan, vars: Readonly<Record<string, unknown>>): Partial<Env> {
  return {
    ...VARS,
    USERS: usersBinding(log),
    CATALOG: catalogBinding(log),
    MAP_TILES: bucket(log, "tiles", TILE_OBJECTS),
    DOCS_ASSETS: bucket(log, "docs", DOCS_OBJECTS),
    RATE_LIMITER: nativeLimiter(log, plan.coarse),
    EDGE_GUARD: guardNamespace(log, plan.durable),
    ...vars,
  };
}
