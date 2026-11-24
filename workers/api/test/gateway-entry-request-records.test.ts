/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins the class each route's request records carry today: the entry
 * record (`edge_gateway_request_start`, written before the route serves
 * anything), the completion record (`edge_gateway_request`, after it) and, when
 * serving throws, the error record (`edge_gateway_error`). The records name a
 * request by its class and never by its path, so the class is what production
 * logs call a request: a route that changes class changes every count of it.
 *
 * Every class is here: the landing assets (a HEAD of the readiness probe among
 * them), both public catalog reads, the users prefix (a read and a write),
 * adoption, the retired migration path, the `/v1` surface (each agent-tier
 * route, Turnstile verification and an unknown `/v1` path), and a request no
 * route serves (an unmatched path, the bare `/tiles` name and a variant of the
 * private `/img/docs` name).
 *
 * test-type: characterization
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN } from "./doubles/entry-seam.ts";
import { UNLIMITED } from "./doubles/entry-seam-limiters.ts";

type Recorded = readonly [event: string, requestClass: string];

interface RecordedRequest {
  readonly who: string;
  readonly method: string;
  readonly path: string;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly requestClass: string;
  readonly records: readonly Recorded[];
}

/** The two fields of a gateway record this file reads. */
interface GatewayRecord {
  readonly event: string;
  readonly class: string;
}

const START = "edge_gateway_request_start";
const COMPLETION = "edge_gateway_request";
const ERROR = "edge_gateway_error";

function served(who: string, method: string, path: string, requestClass: string): RecordedRequest {
  return { who, method, path, vars: {}, requestClass, records: [[START, requestClass], [COMPLETION, requestClass]] };
}

const UNREACHABLE_USERS = { USERS: { fetch: () => Promise.reject(new TypeError("binding unreachable")) } };

const REQUESTS: readonly RecordedRequest[] = [
  served("the readiness probe", "GET", "/healthz", "landing"),
  served("a HEAD of the readiness probe", "HEAD", "/healthz", "landing"),
  served("a tile", "GET", "/tiles/styles/basemap.json", "landing"),
  served("an Anitabi image", "GET", "/img/a.jpg?plan=h160", "landing"),
  served("an anime overview read", "GET", "/catalog/public/anime-overview/3302", "public-catalog"),
  served("a popular read", "GET", "/catalog/public/popular", "public-catalog"),
  served("a users read", "GET", "/v1/users/saved-routes", "users"),
  served("a users write", "POST", "/v1/users/saved-routes", "users"),
  served("an adoption", "POST", "/v1/sessions/adopt", "adopt"),
  served("the retired migration path", "POST", "/v1/session/migrate", "retired"),
  served("a turn", "POST", "/v1/chat", "v1"),
  served("a probe", "POST", "/v1/byok/probe", "v1"),
  served("the conversation index", "GET", "/v1/conversations", "v1"),
  served("a transcript", "GET", "/v1/conversations/s-42/messages", "v1"),
  served("a stream", "GET", "/v1/conversations/s-42/stream", "v1"),
  served("a Turnstile verification", "POST", "/v1/turnstile/verify", "v1"),
  served("an unknown /v1 path", "POST", "/v1/unknown", "v1"),
  served("an unmatched path", "GET", "/unknown", "not-found"),
  served("the bare /tiles name", "GET", "/tiles", "not-found"),
  served("a variant of the private docs name", "GET", "/img/Docs/archive/a.png?plan=h160", "not-found"),
  { who: "a users read whose binding is unreachable", method: "GET", path: "/v1/users/saved-routes", vars: UNREACHABLE_USERS,
    requestClass: "users", records: [[START, "users"], [COMPLETION, "users"], [ERROR, "users"]] },
];

/** Every line the gateway logs through `console.warn` from here on. */
function warnings(t: TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, "warn", (line: unknown) => { lines.push(String(line)); });
  return lines;
}

/** The gateway's own request records among the logged lines, as event and class. */
function gatewayRecords(lines: readonly string[]): Recorded[] {
  return lines
    .map((line) => JSON.parse(line) as GatewayRecord)
    .filter((record) => record.event.startsWith("edge_gateway_"))
    .map((record): Recorded => [record.event, record.class]);
}

for (const request of REQUESTS) {
  void test(`${request.who} (${request.method} ${request.path}) is recorded as ${request.requestClass}`, async (t) => {
    const lines = warnings(t);
    const seam = entrySeam(t, UNLIMITED, request.vars);
    await seam.send(request.method, request.path, HUMAN);
    assert.deepEqual(gatewayRecords(lines), request.records);
  });
}
