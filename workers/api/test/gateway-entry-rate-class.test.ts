/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins each route's rate class today as the limiter calls it makes with
 * every limiter open: `durable` asks the coarse damper and then the caller's
 * durable shard (and, for a visitor's turn, the budget latch); `native` asks the
 * coarse damper alone; `none` asks neither. How each class answers a limiter
 * outage is pinned in `gateway-entry-limiter-outage.test.ts`.
 *
 * Routing and rate classification read one table: each entry of the route
 * table (`src/gateway/route-table.ts`) carries its rate class, so a request is
 * metered by the class of the entry the router matched, and the two cannot
 * disagree. The second half of the table pins the requests refused before any
 * limiter is asked, each with a 404 or, for adoption's GET, a 405: the
 * spellings and methods a separate limiter-side path matcher used to meter
 * before the route table replaced it (a trailing slash, an encoded or
 * undecodable letter, any other path under `/v1/byok/`, the public catalog and
 * adoption for other methods), the siblings of that `/v1/byok/` prefix, and
 * retired and unknown `/v1` paths. `/v1/turnstile/verify` is routed with the
 * unmanaged class, so it is served unmetered.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, entrySeam, HUMAN, SOLVED, VISITOR } from "./doubles/entry-seam.ts";

type RateClass = "durable" | "native" | "none";
type Caller = keyof typeof CALLERS;
type Classified = readonly [method: string, path: string, caller: Caller, rateClass: RateClass, status: number, log: readonly string[]];

const CALLERS = {
  anyone: {},
  "a reader at 203.0.113.7": { "CF-Connecting-IP": "203.0.113.7" },
  "a verified caller": HUMAN,
  "an admitted visitor": ADMITTED,
  "a visitor with a solved token": SOLVED,
};

const WRITE = ["auth u1", "coarse authed:u1", "rate:authed:u1 POST /rate-limit"];
const USERS = "/v1/users/saved-routes";

const CLASSIFIED: readonly Classified[] = [
  ["GET", "/healthz", "anyone", "none", 200, []],
  ["GET", "/tiles/styles/basemap.json", "anyone", "none", 200, ["tiles tiles/styles/basemap.json"]],
  ["GET", "/img/docs/archive/a.png", "anyone", "none", 200, ["docs archive/a.png"]],
  ["GET", "/img/a.jpg?plan=h160", "anyone", "none", 200, ["origin https://image.anitabi.cn/a.jpg?plan=h160"]],
  ["GET", "/catalog/public/anime-overview/3302", "anyone", "native", 200,
    ["coarse public-read", "catalog GET /catalog/public/anime-overview/3302"]],
  ["GET", "/catalog/public/popular", "a reader at 203.0.113.7", "native", 200,
    ["coarse ip:203.0.113.7", "catalog GET /catalog/public/popular"]],
  ["GET", USERS, "a verified caller", "none", 200, ["auth u1", `users GET ${USERS} as u1/human`]],
  ["HEAD", USERS, "a verified caller", "durable", 200, [...WRITE, `users HEAD ${USERS} as u1/human`]],
  ["OPTIONS", USERS, "a verified caller", "durable", 200, [...WRITE, `users OPTIONS ${USERS} as u1/human`]],
  ["POST", USERS, "a verified caller", "durable", 200, [...WRITE, `users POST ${USERS} as u1/human`]],
  ["PUT", `${USERS}/r-1`, "a verified caller", "durable", 200, [...WRITE, `users PUT ${USERS}/r-1 as u1/human`]],
  ["PATCH", `${USERS}/r-1`, "a verified caller", "durable", 200, [...WRITE, `users PATCH ${USERS}/r-1 as u1/human`]],
  ["DELETE", `${USERS}/r-1`, "a verified caller", "durable", 200, [...WRITE, `users DELETE ${USERS}/r-1 as u1/human`]],
  ["POST", "/v1/sessions/adopt", "a verified caller", "durable", 200, WRITE],
  ["POST", "/v1/turnstile/verify", "a verified caller", "none", 204, ["auth u1"]],
  ["POST", "/v1/turnstile/verify", "a visitor with a solved token", "none", 204, ["auth absent", "turnstile solved-token"]],
  ["POST", "/v1/chat", "a verified caller", "durable", 200, [...WRITE, "tier chat u1 human -"]],
  ["POST", "/v1/byok/probe", "a verified caller", "durable", 200, [...WRITE, "tier probe u1 human -"]],
  ["GET", "/v1/conversations", "a verified caller", "none", 200, ["auth u1", "tier list u1 human -"]],
  ["GET", "/v1/conversations/s-42/messages", "a verified caller", "none", 200, ["auth u1", "tier transcript u1 human s-42"]],
  ["GET", "/v1/conversations/s-42/stream", "a verified caller", "none", 200, ["auth u1", "tier stream u1 human s-42"]],
  ["POST", "/v1/chat", "an admitted visitor", "durable", 200,
    ["auth absent", `coarse ${VISITOR}`, `rate:${VISITOR} POST /rate-limit`, "budget GET /budget", `tier chat ${VISITOR} anonymous -`]],
  ["GET", "/v1/conversations/s-42/messages", "an admitted visitor", "none", 200, ["auth absent", `tier transcript ${VISITOR} anonymous s-42`]],
  ["GET", "/v1/conversations/s-42/stream", "an admitted visitor", "none", 200, ["auth absent", `tier stream ${VISITOR} anonymous s-42`]],
  ["POST", "/v1/unknown", "a verified caller", "none", 404, []],
  ["POST", "/v1/byok/anything-future", "a verified caller", "none", 404, []],
  ["POST", "/v1/byoke/probe", "a verified caller", "none", 404, []],
  ["POST", "/v1/byok", "a verified caller", "none", 404, []],
  ["POST", "/v1/%62yok/probe", "a verified caller", "none", 404, []],
  ["POST", "/v1/%zzyok/probe", "a verified caller", "none", 404, []],
  ["POST", "/v1/chat/", "a verified caller", "none", 404, []],
  ["POST", "/v1/%63hat", "a verified caller", "none", 404, []],
  ["POST", "/v1/%zzhat", "a verified caller", "none", 404, []],
  ["POST", "/v1/sessions/adopt/", "a verified caller", "none", 404, []],
  ["GET", "/v1/sessions/adopt", "a verified caller", "none", 405, []],
  ["POST", "/catalog/public/popular", "anyone", "none", 404, []],
  ["GET", "/catalog/public/popular/", "anyone", "none", 404, []],
  ["GET", "/catalog/public/%70opular", "anyone", "none", 404, []],
  ["GET", "/v1/session/migrate", "a verified caller", "none", 404, []],
  ["POST", "/v1/runtime", "a verified caller", "none", 404, []],
  ["POST", "/v1/runtime/stream", "a verified caller", "none", 404, []],
  ["POST", "/v1/feedback", "a verified caller", "none", 404, []],
  ["GET", "/v1/search/preview", "a verified caller", "none", 404, []],
  ["GET", "/v1/bangumi/485/guide", "a verified caller", "none", 404, []],
  ["GET", "/v1/bangumi/nearby", "a verified caller", "none", 404, []],
  ["PATCH", "/v1/conversations/x", "a verified caller", "none", 404, []],
  ["GET", "/v1/conversations/abc/routes", "a verified caller", "none", 404, []],
  ["POST", "/v1/photo-search", "a verified caller", "none", 404, []],
  ["POST", "/v1/photo-search/confirm", "a verified caller", "none", 404, []],
  ["POST", "/v1/staging/sessions/s-1/prefix", "a verified caller", "none", 404, []],
];

for (const [method, path, caller, rateClass, status, log] of CLASSIFIED) {
  void test(`${method} ${path} from ${caller} is rate class ${rateClass} and answers ${String(status)}`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send(method, path, CALLERS[caller]);
    assert.equal(response.status, status);
    assert.deepEqual(seam.log, log);
  });
}
