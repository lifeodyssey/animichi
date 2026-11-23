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
 * - The Anitabi image arm has no method gate at all, so every method is proxied
 *   as an upstream GET.
 * - The `/v1/users/` prefix answers OPTIONS itself with a 204, before identity.
 *   It forwards every other method, a HEAD as a GET; GET and HEAD are charged
 *   nothing, and every other method is charged to the durable limiter.
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
  ["OPTIONS", IMAGE, 200, "jpeg-bytes", ORIGIN_READ],
  ["POST", IMAGE, 200, "jpeg-bytes", ORIGIN_READ],
  ["PUT", IMAGE, 200, "jpeg-bytes", ORIGIN_READ],
  ["PATCH", IMAGE, 200, "jpeg-bytes", ORIGIN_READ],
  ["DELETE", IMAGE, 200, "jpeg-bytes", ORIGIN_READ],
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
