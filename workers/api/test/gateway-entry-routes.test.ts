/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered
 * (`createWorkerApp`, the app `src/entry.ts` exports). This file pins every
 * path and method the gateway serves today — each advertised Agent and Users
 * operation, the landing assets and the public catalog reads — as a literal
 * table: the request a case sends, the status, content type and exact body it
 * gets back, and every collaborator the request reached, in order.
 *
 * The table is written out by hand, never derived from a route table or a path
 * template, so deleting or reordering a route turns its row red. Method and path
 * neighbours live in `gateway-entry-methods.test.ts` and the two
 * `gateway-entry-paths-*.test.ts` files.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, AID, entrySeam, HUMAN, SOLVED, VISITOR } from "./doubles/entry-seam.ts";
import { NOT_FOUND } from "./doubles/entry-envelopes.ts";

interface ServedRoute {
  readonly who: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
  readonly type: string | null;
  readonly body: string;
  readonly log: readonly string[];
}

const JSON_TYPE = "application/json";
const USER_CHARGE = ["auth u1", "coarse authed:u1", "rate:authed:u1 POST /rate-limit"];
const VISITOR_CHARGE = [`coarse ${VISITOR}`, `rate:${VISITOR} POST /rate-limit`, "budget GET /budget"];

function tierBody(handler: string, user: string, type: string, session: string): string {
  return JSON.stringify({ handler, user, type, session });
}

const ROUTES: readonly ServedRoute[] = [
  { who: "anyone", method: "GET", path: "/healthz", headers: {}, status: 200, type: JSON_TYPE, body: '{"status":"ok"}', log: [] },
  { who: "anyone", method: "GET", path: "/tiles/styles/basemap.json", headers: {}, status: 200, type: JSON_TYPE,
    body: '{"version":8}', log: ["tiles tiles/styles/basemap.json"] },
  { who: "anyone", method: "GET", path: "/tiles/14/135/892.mvt", headers: {}, status: 200, type: "application/vnd.mapbox-vector-tile",
    body: "mvt-bytes", log: ["tiles tiles/14/135/892.mvt"] },
  { who: "anyone, for a vector tile the bucket lacks", method: "GET", path: "/tiles/14/135/893.mvt", headers: {}, status: 204,
    type: null, body: "", log: ["tiles tiles/14/135/893.mvt"] },
  { who: "anyone", method: "GET", path: "/img/docs/archive/a.png", headers: {}, status: 200, type: "image/png",
    body: "png-bytes", log: ["docs archive/a.png"] },
  { who: "anyone", method: "GET", path: "/img/a.jpg?plan=h160", headers: {}, status: 200, type: "image/jpeg",
    body: "jpeg-bytes", log: ["origin https://image.anitabi.cn/a.jpg?plan=h160"] },
  { who: "anyone", method: "GET", path: "/catalog/public/anime-overview/3302", headers: {}, status: 200, type: JSON_TYPE,
    body: '{"service":"catalog"}', log: ["coarse public-read", "catalog GET /catalog/public/anime-overview/3302"] },
  { who: "anyone", method: "GET", path: "/catalog/public/popular?limit=4", headers: {}, status: 200, type: JSON_TYPE,
    body: '{"service":"catalog"}', log: ["coarse public-read", "catalog GET /catalog/public/popular?limit=4"] },
  { who: "a verified caller", method: "GET", path: "/v1/users/saved-routes", headers: HUMAN, status: 200, type: "text/plain",
    body: "users GET /v1/users/saved-routes", log: ["auth u1", "users GET /v1/users/saved-routes as u1/human"] },
  { who: "a verified caller", method: "POST", path: "/v1/users/saved-routes", headers: HUMAN, status: 200, type: "text/plain",
    body: "users POST /v1/users/saved-routes", log: [...USER_CHARGE, "users POST /v1/users/saved-routes as u1/human"] },
  { who: "a verified caller", method: "DELETE", path: "/v1/users/saved-routes/r-1", headers: HUMAN, status: 200, type: "text/plain",
    body: "users DELETE /v1/users/saved-routes/r-1", log: [...USER_CHARGE, "users DELETE /v1/users/saved-routes/r-1 as u1/human"] },
  { who: "a verified caller with no anonymous history", method: "POST", path: "/v1/sessions/adopt", headers: HUMAN, status: 200,
    type: JSON_TYPE, body: '{"adopted":0,"noop_class":"no_anonymous_identity","revisions_bumped":0}', log: USER_CHARGE },
  { who: "a verified caller carrying an aid", method: "POST", path: "/v1/sessions/adopt", headers: { ...HUMAN, Cookie: AID },
    status: 200, type: JSON_TYPE, body: '{"adopted":1,"noop_class":"adopted","revisions_bumped":1}',
    log: [...USER_CHARGE, `adopt ${VISITOR} u1`] },
  { who: "a verified caller", method: "POST", path: "/v1/turnstile/verify", headers: HUMAN, status: 204, type: null, body: "",
    log: ["auth u1"] },
  { who: "a returning visitor with a solved token", method: "POST", path: "/v1/turnstile/verify", headers: { Cookie: AID, ...SOLVED },
    status: 204, type: null, body: "", log: ["auth absent", "turnstile solved-token"] },
  { who: "a verified caller", method: "POST", path: "/v1/chat", headers: HUMAN, status: 200, type: JSON_TYPE,
    body: tierBody("chat", "u1", "human", "-"), log: [...USER_CHARGE, "tier chat u1 human -"] },
  { who: "a verified caller", method: "POST", path: "/v1/byok/probe", headers: HUMAN, status: 200, type: JSON_TYPE,
    body: tierBody("probe", "u1", "human", "-"), log: [...USER_CHARGE, "tier probe u1 human -"] },
  { who: "a verified caller", method: "GET", path: "/v1/conversations", headers: HUMAN, status: 200, type: JSON_TYPE,
    body: tierBody("list", "u1", "human", "-"), log: ["auth u1", "tier list u1 human -"] },
  { who: "a verified caller", method: "GET", path: "/v1/conversations/s-42/messages", headers: HUMAN, status: 200, type: JSON_TYPE,
    body: tierBody("transcript", "u1", "human", "s-42"), log: ["auth u1", "tier transcript u1 human s-42"] },
  { who: "a verified caller", method: "GET", path: "/v1/conversations/s-42/stream", headers: HUMAN, status: 200, type: JSON_TYPE,
    body: tierBody("stream", "u1", "human", "s-42"), log: ["auth u1", "tier stream u1 human s-42"] },
  { who: "an admitted visitor", method: "POST", path: "/v1/chat", headers: ADMITTED, status: 200, type: JSON_TYPE,
    body: tierBody("chat", VISITOR, "anonymous", "-"), log: ["auth absent", ...VISITOR_CHARGE, `tier chat ${VISITOR} anonymous -`] },
  { who: "an admitted visitor", method: "GET", path: "/v1/conversations/s-42/messages", headers: ADMITTED, status: 200,
    type: JSON_TYPE, body: tierBody("transcript", VISITOR, "anonymous", "s-42"),
    log: ["auth absent", `tier transcript ${VISITOR} anonymous s-42`] },
  { who: "an admitted visitor", method: "GET", path: "/v1/conversations/s-42/stream", headers: ADMITTED, status: 200,
    type: JSON_TYPE, body: tierBody("stream", VISITOR, "anonymous", "s-42"),
    log: ["auth absent", `tier stream ${VISITOR} anonymous s-42`] },
  { who: "a verified caller, on the retired migration path", method: "POST", path: "/v1/session/migrate", headers: HUMAN,
    status: 404, type: JSON_TYPE, body: NOT_FOUND, log: [] },
  { who: "anyone, at the retired root", method: "GET", path: "/", headers: {}, status: 404, type: JSON_TYPE, body: NOT_FOUND, log: [] },
];

for (const route of ROUTES) {
  void test(`${route.method} ${route.path} answers ${route.who} with ${String(route.status)}`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send(route.method, route.path, route.headers);
    assert.equal(response.status, route.status);
    assert.equal(response.headers.get("Content-Type"), route.type);
    assert.equal(await response.text(), route.body);
    assert.deepEqual(seam.log, route.log);
  });
}
