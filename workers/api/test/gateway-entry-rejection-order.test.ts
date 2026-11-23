/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins which refusal wins today when a request would be refused on more
 * than one ground, with every limiter exhausted (the coarse damper and the
 * durable shard both deny), and whether the request reached a limiter at all —
 * each line in a row's log is a call the gateway made, and a limiter call is
 * one that spends the caller's budget.
 *
 * Today's order: route selection first (an unknown route, a method mismatch on a
 * tier route and a preflight to one are a 404, and an OPTIONS to the users
 * prefix a 204, before anything is consulted), then identity (a credential that
 * is absent, rejected or uncheckable is refused before any limiter), then for a
 * visitor the Turnstile challenge, and only then the limiter. The public catalog
 * refuses an undeclared query parameter before its damper. Unmanaged reads are
 * served with every limiter exhausted. Showcase precedence is pinned in
 * `gateway-entry-showcase.test.ts`, and the follow-up requests that show a spent
 * budget in `gateway-entry-limiter-charge.test.ts`.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, entrySeam, HUMAN, INVALID, SOLVED, UNVERIFIABLE, VISITOR } from "./doubles/entry-seam.ts";
import { LIMITED } from "./doubles/entry-seam-limiters.ts";
import {
  METHOD_NOT_ALLOWED, NOT_FOUND, RATE_LIMITED_60, TURNSTILE_REQUIRED, UNAUTHORIZED, UNEXPECTED_QUERY, VERIFICATION_UNAVAILABLE,
} from "./doubles/entry-envelopes.ts";

interface Contest {
  readonly who: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly status: number;
  readonly body: string;
  readonly log: readonly string[];
}

const PREFLIGHT = { Origin: "https://animichi.test", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" };
const ANONYMOUS_OFF = { ANON_ACCESS_ENABLED: "false" };

const CONTESTS: readonly Contest[] = [
  { who: "an unknown /v1 route", method: "POST", path: "/v1/unknown", headers: HUMAN, vars: {}, status: 404, body: NOT_FOUND, log: [] },
  { who: "an unknown route under the BYOK prefix", method: "POST", path: "/v1/byok/other", headers: HUMAN, vars: {}, status: 404,
    body: NOT_FOUND, log: [] },
  { who: "an unknown route outside /v1", method: "GET", path: "/unknown", headers: HUMAN, vars: {}, status: 404, body: NOT_FOUND, log: [] },
  { who: "a method mismatch on a tier route", method: "GET", path: "/v1/chat", headers: HUMAN, vars: {}, status: 404,
    body: NOT_FOUND, log: [] },
  { who: "a users write with no credential", method: "POST", path: "/v1/users/saved-routes", headers: {}, vars: {}, status: 401,
    body: UNAUTHORIZED, log: ["auth absent"] },
  { who: "a users write with a rejected bearer", method: "POST", path: "/v1/users/saved-routes", headers: INVALID, vars: {},
    status: 401, body: UNAUTHORIZED, log: ["auth invalid"] },
  { who: "a users write with an uncheckable bearer", method: "POST", path: "/v1/users/saved-routes", headers: UNVERIFIABLE, vars: {},
    status: 503, body: VERIFICATION_UNAVAILABLE, log: ["auth unverifiable"] },
  { who: "an adoption with no credential", method: "POST", path: "/v1/sessions/adopt", headers: {}, vars: {}, status: 401,
    body: UNAUTHORIZED, log: ["auth absent"] },
  { who: "the conversation index with no credential", method: "GET", path: "/v1/conversations", headers: {}, vars: {}, status: 401,
    body: UNAUTHORIZED, log: ["auth absent"] },
  { who: "a probe with no credential", method: "POST", path: "/v1/byok/probe", headers: {}, vars: {}, status: 401,
    body: UNAUTHORIZED, log: ["auth absent"] },
  { who: "a turn with no credential and anonymous access off", method: "POST", path: "/v1/chat", headers: {}, vars: ANONYMOUS_OFF,
    status: 401, body: UNAUTHORIZED, log: ["auth absent"] },
  { who: "a turn with a rejected bearer, never demoted to a visitor", method: "POST", path: "/v1/chat", headers: INVALID, vars: {},
    status: 401, body: UNAUTHORIZED, log: ["auth invalid"] },
  { who: "a visitor's turn with no token", method: "POST", path: "/v1/chat", headers: {}, vars: {}, status: 403,
    body: TURNSTILE_REQUIRED, log: ["auth absent", "turnstile -"] },
  { who: "an admitted visitor's turn", method: "POST", path: "/v1/chat", headers: ADMITTED, vars: {}, status: 429,
    body: RATE_LIMITED_60, log: ["auth absent", `coarse ${VISITOR}`] },
  { who: "verification, which no limiter meters", method: "POST", path: "/v1/turnstile/verify", headers: SOLVED, vars: {},
    status: 204, body: "", log: ["auth absent", "turnstile solved-token"] },
  { who: "a preflight to the turn", method: "OPTIONS", path: "/v1/chat", headers: PREFLIGHT, vars: {}, status: 404,
    body: NOT_FOUND, log: [] },
  { who: "a preflight to the index", method: "OPTIONS", path: "/v1/conversations", headers: PREFLIGHT, vars: {}, status: 404,
    body: NOT_FOUND, log: [] },
  { who: "a preflight to users, which carries no credential", method: "OPTIONS", path: "/v1/users/saved-routes", headers: PREFLIGHT,
    vars: {}, status: 204, body: "", log: [] },
  { who: "a preflight to users that carries a bearer", method: "OPTIONS", path: "/v1/users/saved-routes",
    headers: { ...PREFLIGHT, ...HUMAN }, vars: {}, status: 204, body: "", log: [] },
  { who: "an OPTIONS to users that carries a bearer", method: "OPTIONS", path: "/v1/users/saved-routes", headers: HUMAN, vars: {},
    status: 204, body: "", log: [] },
  { who: "a preflight to adoption", method: "OPTIONS", path: "/v1/sessions/adopt", headers: PREFLIGHT, vars: {}, status: 405,
    body: METHOD_NOT_ALLOWED, log: [] },
  { who: "a preflight to verification", method: "OPTIONS", path: "/v1/turnstile/verify", headers: PREFLIGHT, vars: {}, status: 405,
    body: METHOD_NOT_ALLOWED, log: [] },
  { who: "a preflight to the public catalog", method: "OPTIONS", path: "/catalog/public/popular", headers: PREFLIGHT, vars: {},
    status: 404, body: NOT_FOUND, log: [] },
  { who: "a preflight to a tile", method: "OPTIONS", path: "/tiles/styles/basemap.json", headers: PREFLIGHT, vars: {}, status: 204,
    body: "", log: [] },
  { who: "a catalog read with an undeclared parameter", method: "GET", path: "/catalog/public/popular?spoof=1", headers: {}, vars: {},
    status: 400, body: UNEXPECTED_QUERY, log: [] },
  { who: "a catalog read", method: "GET", path: "/catalog/public/popular", headers: {}, vars: {}, status: 429, body: RATE_LIMITED_60,
    log: ["coarse public-read"] },
  { who: "a catalog read from a known address", method: "GET", path: "/catalog/public/popular",
    headers: { "CF-Connecting-IP": "203.0.113.7" }, vars: {}, status: 429, body: RATE_LIMITED_60, log: ["coarse ip:203.0.113.7"] },
  { who: "a verified turn", method: "POST", path: "/v1/chat", headers: HUMAN, vars: {}, status: 429, body: RATE_LIMITED_60,
    log: ["auth u1", "coarse authed:u1"] },
  { who: "a verified index read, which no limiter meters", method: "GET", path: "/v1/conversations", headers: HUMAN, vars: {},
    status: 200, body: '{"handler":"list","user":"u1","type":"human","session":"-"}', log: ["auth u1", "tier list u1 human -"] },
  { who: "a verified users read, which no limiter meters", method: "GET", path: "/v1/users/saved-routes", headers: HUMAN, vars: {},
    status: 200, body: "users GET /v1/users/saved-routes", log: ["auth u1", "users GET /v1/users/saved-routes as u1/human"] },
];

for (const contest of CONTESTS) {
  void test(`with every limiter exhausted, ${contest.who} answers ${String(contest.status)}`, async (t) => {
    const seam = entrySeam(t, LIMITED, contest.vars);
    const response = await seam.send(contest.method, contest.path, contest.headers);
    assert.equal(response.status, contest.status);
    assert.equal(await response.text(), contest.body);
    assert.deepEqual(seam.log, contest.log);
  });
}
