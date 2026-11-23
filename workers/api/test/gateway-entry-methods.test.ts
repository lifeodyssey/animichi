/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins today's answer to every OTHER method on every route the gateway
 * serves — HEAD and OPTIONS included — sent by a verified caller with the
 * limiter open, so a status here is the routing's answer and not an identity
 * or a limiter refusal. The served method itself is pinned in
 * `gateway-entry-routes.test.ts`.
 *
 * Three behaviours here are easy to lose in a framework swap:
 *
 * - A HEAD of the readiness probe, of a public catalog read or of an agent-tier
 *   read answers as its GET does, through the same gates and charges, with no
 *   body; a catalog HEAD reaches the catalog as a GET.
 * - The Anitabi image arm proxies GET and HEAD as an upstream GET, answers
 *   OPTIONS with the 204 preflight the private asset arms answer, and refuses
 *   every other method 405 with `Allow: GET, HEAD, OPTIONS`, in the shared JSON
 *   envelope, before the origin is asked.
 * - The `/v1/users/` prefix answers OPTIONS itself with a 204, before identity.
 *   It forwards every other method, a HEAD as a GET; GET and HEAD are charged
 *   nothing, and every other method is charged to the durable limiter.
 *
 * A variant of the private `/img/docs` name (`/img/Docs/…`) is no route, so
 * every method answers the shared 404, a HEAD with no body, and none reaches the
 * image arm's method gate.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN } from "./doubles/entry-seam.ts";
import {
  IMAGE_METHOD_NOT_ALLOWED, METHOD_NOT_ALLOWED, NOT_FOUND, TILE_METHOD_NOT_ALLOWED,
} from "./doubles/entry-envelopes.ts";

type Neighbour = readonly [method: string, path: string, status: number, body: string, log: readonly string[]];

const STYLE = "/tiles/styles/basemap.json";
const DOCS = "/img/docs/archive/a.png";
const IMAGE = "/img/a.jpg?plan=h160";
const DOCS_VARIANT = "/img/Docs/archive/a.png";
const POPULAR = "/catalog/public/popular";
const OVERVIEW = "/catalog/public/anime-overview/3302";
const USERS = "/v1/users/saved-routes";
const ORIGIN_READ = ["origin https://image.anitabi.cn/a.jpg?plan=h160"];
const USER_CHARGE = ["auth u1", "coarse authed:u1", "rate:authed:u1 POST /rate-limit"];

const NEIGHBOURS: readonly Neighbour[] = [
  ["HEAD", "/healthz", 200, "", []],
  ["POST", "/healthz", 404, NOT_FOUND, []],
  ["PUT", "/healthz", 404, NOT_FOUND, []],
  ["PATCH", "/healthz", 404, NOT_FOUND, []],
  ["DELETE", "/healthz", 404, NOT_FOUND, []],
  ["OPTIONS", "/healthz", 404, NOT_FOUND, []],
  ["HEAD", STYLE, 200, "", ["tiles tiles/styles/basemap.json"]],
  ["OPTIONS", STYLE, 204, "", []],
  ["POST", STYLE, 405, TILE_METHOD_NOT_ALLOWED, []],
  ["PUT", STYLE, 405, TILE_METHOD_NOT_ALLOWED, []],
  ["PATCH", STYLE, 405, TILE_METHOD_NOT_ALLOWED, []],
  ["DELETE", STYLE, 405, TILE_METHOD_NOT_ALLOWED, []],
  ["HEAD", DOCS, 200, "", ["docs archive/a.png"]],
  ["OPTIONS", DOCS, 204, "", []],
  ["POST", DOCS, 405, IMAGE_METHOD_NOT_ALLOWED, []],
  ["PUT", DOCS, 405, IMAGE_METHOD_NOT_ALLOWED, []],
  ["PATCH", DOCS, 405, IMAGE_METHOD_NOT_ALLOWED, []],
  ["DELETE", DOCS, 405, IMAGE_METHOD_NOT_ALLOWED, []],
  ["HEAD", IMAGE, 200, "", ORIGIN_READ],
  ["OPTIONS", IMAGE, 204, "", []],
  ["POST", IMAGE, 405, METHOD_NOT_ALLOWED, []],
  ["PUT", IMAGE, 405, METHOD_NOT_ALLOWED, []],
  ["PATCH", IMAGE, 405, METHOD_NOT_ALLOWED, []],
  ["DELETE", IMAGE, 405, METHOD_NOT_ALLOWED, []],
  ["HEAD", `${DOCS_VARIANT}?plan=h160`, 404, "", []],
  ["OPTIONS", DOCS_VARIANT, 404, NOT_FOUND, []],
  ["POST", `${DOCS_VARIANT}?plan=h160`, 404, NOT_FOUND, []],
  ["HEAD", POPULAR, 200, "", ["coarse public-read", `catalog GET ${POPULAR}`]],
  ["POST", POPULAR, 404, NOT_FOUND, []],
  ["PUT", POPULAR, 404, NOT_FOUND, []],
  ["PATCH", POPULAR, 404, NOT_FOUND, []],
  ["DELETE", POPULAR, 404, NOT_FOUND, []],
  ["OPTIONS", POPULAR, 404, NOT_FOUND, []],
  ["HEAD", OVERVIEW, 200, "", ["coarse public-read", `catalog GET ${OVERVIEW}`]],
  ["POST", OVERVIEW, 404, NOT_FOUND, []],
  ["PUT", OVERVIEW, 404, NOT_FOUND, []],
  ["PATCH", OVERVIEW, 404, NOT_FOUND, []],
  ["DELETE", OVERVIEW, 404, NOT_FOUND, []],
  ["OPTIONS", OVERVIEW, 404, NOT_FOUND, []],
  ["HEAD", USERS, 200, "", ["auth u1", `users GET ${USERS} as u1/human`]],
  ["PUT", USERS, 200, `users PUT ${USERS}`, [...USER_CHARGE, `users PUT ${USERS} as u1/human`]],
  ["PATCH", USERS, 200, `users PATCH ${USERS}`, [...USER_CHARGE, `users PATCH ${USERS} as u1/human`]],
  ["DELETE", USERS, 200, `users DELETE ${USERS}`, [...USER_CHARGE, `users DELETE ${USERS} as u1/human`]],
  ["OPTIONS", USERS, 204, "", []],
  ["GET", "/v1/sessions/adopt", 405, METHOD_NOT_ALLOWED, []],
  ["HEAD", "/v1/sessions/adopt", 405, "", []],
  ["PUT", "/v1/sessions/adopt", 405, METHOD_NOT_ALLOWED, []],
  ["PATCH", "/v1/sessions/adopt", 405, METHOD_NOT_ALLOWED, []],
  ["DELETE", "/v1/sessions/adopt", 405, METHOD_NOT_ALLOWED, []],
  ["OPTIONS", "/v1/sessions/adopt", 405, METHOD_NOT_ALLOWED, []],
  ["GET", "/v1/turnstile/verify", 405, METHOD_NOT_ALLOWED, []],
  ["HEAD", "/v1/turnstile/verify", 405, "", []],
  ["PUT", "/v1/turnstile/verify", 405, METHOD_NOT_ALLOWED, []],
  ["PATCH", "/v1/turnstile/verify", 405, METHOD_NOT_ALLOWED, []],
  ["DELETE", "/v1/turnstile/verify", 405, METHOD_NOT_ALLOWED, []],
  ["OPTIONS", "/v1/turnstile/verify", 405, METHOD_NOT_ALLOWED, []],
  ["GET", "/v1/chat", 404, NOT_FOUND, []],
  ["HEAD", "/v1/chat", 404, "", []],
  ["PUT", "/v1/chat", 404, NOT_FOUND, []],
  ["PATCH", "/v1/chat", 404, NOT_FOUND, []],
  ["DELETE", "/v1/chat", 404, NOT_FOUND, []],
  ["OPTIONS", "/v1/chat", 404, NOT_FOUND, []],
  ["GET", "/v1/byok/probe", 404, NOT_FOUND, []],
  ["HEAD", "/v1/byok/probe", 404, "", []],
  ["PUT", "/v1/byok/probe", 404, NOT_FOUND, []],
  ["PATCH", "/v1/byok/probe", 404, NOT_FOUND, []],
  ["DELETE", "/v1/byok/probe", 404, NOT_FOUND, []],
  ["OPTIONS", "/v1/byok/probe", 404, NOT_FOUND, []],
  ["HEAD", "/v1/conversations", 200, "", ["auth u1", "tier list u1 human -"]],
  ["POST", "/v1/conversations", 404, NOT_FOUND, []],
  ["PUT", "/v1/conversations", 404, NOT_FOUND, []],
  ["PATCH", "/v1/conversations", 404, NOT_FOUND, []],
  ["DELETE", "/v1/conversations", 404, NOT_FOUND, []],
  ["OPTIONS", "/v1/conversations", 404, NOT_FOUND, []],
  ["HEAD", "/v1/conversations/s-42/messages", 200, "", ["auth u1", "tier transcript u1 human s-42"]],
  ["POST", "/v1/conversations/s-42/messages", 404, NOT_FOUND, []],
  ["PUT", "/v1/conversations/s-42/messages", 404, NOT_FOUND, []],
  ["PATCH", "/v1/conversations/s-42/messages", 404, NOT_FOUND, []],
  ["DELETE", "/v1/conversations/s-42/messages", 404, NOT_FOUND, []],
  ["OPTIONS", "/v1/conversations/s-42/messages", 404, NOT_FOUND, []],
  ["HEAD", "/v1/conversations/s-42/stream", 200, "", ["auth u1", "tier stream u1 human s-42"]],
  ["POST", "/v1/conversations/s-42/stream", 404, NOT_FOUND, []],
  ["PUT", "/v1/conversations/s-42/stream", 404, NOT_FOUND, []],
  ["PATCH", "/v1/conversations/s-42/stream", 404, NOT_FOUND, []],
  ["DELETE", "/v1/conversations/s-42/stream", 404, NOT_FOUND, []],
  ["OPTIONS", "/v1/conversations/s-42/stream", 404, NOT_FOUND, []],
  ["PROPFIND", USERS, 200, `users PROPFIND ${USERS}`, [...USER_CHARGE, `users PROPFIND ${USERS} as u1/human`]],
  ["PROPFIND", "/v1/chat", 404, NOT_FOUND, []],
  ["PROPFIND", IMAGE, 405, METHOD_NOT_ALLOWED, []],
];

for (const [method, path, status, body, log] of NEIGHBOURS) {
  void test(`${method} ${path} answers a verified caller with ${String(status)}`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send(method, path, HUMAN);
    assert.equal(response.status, status);
    assert.equal(await response.text(), body);
    assert.deepEqual(seam.log, log);
  });
}

/** The methods the Anitabi image arm refuses. */
const IMAGE_REFUSALS = ["POST", "PUT", "PATCH", "DELETE", "PROPFIND"] as const;

for (const method of IMAGE_REFUSALS) {
  void test(`${method} ${IMAGE} is refused with Allow: GET, HEAD, OPTIONS in the JSON envelope`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send(method, IMAGE, HUMAN);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD, OPTIONS");
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(await response.text(), METHOD_NOT_ALLOWED);
  });
}
