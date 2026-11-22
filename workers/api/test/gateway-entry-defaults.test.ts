/**
 * SUT: the API Worker's request gateway exactly as `src/entry.ts` builds it —
 * `createWorkerApp({})`, nothing injected — so the identity verdict, the
 * Turnstile check and the agent tier are production's own defaults. This file
 * pins today's answer for every request that needs neither a verified identity
 * nor an agent-tier answer: the landing assets, the public catalog, the
 * refusals an absent or rejected credential gets, unknown paths and the
 * showcase gate, with every collaborator each request reached.
 *
 * With no `NEON_AUTH_JWKS_URL` bound, production's verifier calls any bearer
 * invalid without a fetch; production's Turnstile check asks siteverify through
 * the global `fetch`, which the seam refuses, so that row is siteverify's outage.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bareSeam, INVALID } from "./doubles/entry-seam.ts";
import { UNLIMITED } from "./doubles/entry-seam-limiters.ts";
import { NOT_FOUND, SHOWCASE_DENIED, TURNSTILE_REQUIRED, UNAUTHORIZED } from "./doubles/entry-envelopes.ts";

interface DefaultAnswer {
  readonly who: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly status: number;
  readonly body: string;
  readonly log: readonly string[];
}

const ANONYMOUS_OFF = { ANON_ACCESS_ENABLED: "false" };
const SITEVERIFY = "origin https://challenges.cloudflare.com/turnstile/v0/siteverify";

const ANSWERS: readonly DefaultAnswer[] = [
  { who: "anyone", method: "GET", path: "/healthz", headers: {}, vars: {}, status: 200, body: '{"status":"ok"}', log: [] },
  { who: "anyone", method: "GET", path: "/tiles/styles/basemap.json", headers: {}, vars: {}, status: 200, body: '{"version":8}',
    log: ["tiles tiles/styles/basemap.json"] },
  { who: "anyone", method: "GET", path: "/img/docs/archive/a.png", headers: {}, vars: {}, status: 200, body: "png-bytes",
    log: ["docs archive/a.png"] },
  { who: "anyone", method: "GET", path: "/img/a.jpg?plan=h360", headers: {}, vars: {}, status: 200, body: "jpeg-bytes",
    log: ["origin https://image.anitabi.cn/a.jpg?plan=h360"] },
  { who: "anyone", method: "GET", path: "/catalog/public/popular", headers: {}, vars: {}, status: 200, body: '{"service":"catalog"}',
    log: ["coarse public-read", "catalog GET /catalog/public/popular"] },
  { who: "a caller with no credential", method: "GET", path: "/v1/users/saved-routes", headers: {}, vars: {}, status: 401,
    body: UNAUTHORIZED, log: [] },
  { who: "a caller with a rejected bearer", method: "POST", path: "/v1/users/saved-routes", headers: INVALID, vars: {}, status: 401,
    body: UNAUTHORIZED, log: [] },
  { who: "a caller with no credential", method: "POST", path: "/v1/sessions/adopt", headers: {}, vars: {}, status: 401,
    body: UNAUTHORIZED, log: [] },
  { who: "a caller with no credential", method: "GET", path: "/v1/conversations", headers: {}, vars: {}, status: 401,
    body: UNAUTHORIZED, log: [] },
  { who: "a caller with no credential", method: "POST", path: "/v1/byok/probe", headers: {}, vars: {}, status: 401,
    body: UNAUTHORIZED, log: [] },
  { who: "a caller with no credential, anonymous access off", method: "POST", path: "/v1/chat", headers: {}, vars: ANONYMOUS_OFF,
    status: 401, body: UNAUTHORIZED, log: [] },
  { who: "a caller with no credential, anonymous access off", method: "POST", path: "/v1/turnstile/verify", headers: {},
    vars: ANONYMOUS_OFF, status: 401, body: UNAUTHORIZED, log: [] },
  { who: "a new visitor with no token", method: "POST", path: "/v1/chat", headers: {}, vars: {}, status: 403,
    body: TURNSTILE_REQUIRED, log: [] },
  { who: "a new visitor whose token siteverify cannot check", method: "POST", path: "/v1/chat",
    headers: { "cf-turnstile-response": "any-token" }, vars: {}, status: 403, body: TURNSTILE_REQUIRED, log: [SITEVERIFY] },
  { who: "a browser preflight", method: "OPTIONS", path: "/v1/chat", headers: {}, vars: {}, status: 404, body: NOT_FOUND, log: [] },
  { who: "anyone", method: "GET", path: "/unknown", headers: {}, vars: {}, status: 404, body: NOT_FOUND, log: [] },
  { who: "anyone, in showcase mode", method: "POST", path: "/v1/chat", headers: {}, vars: { EDGE_SHOWCASE_MODE: "true" },
    status: 403, body: SHOWCASE_DENIED, log: [] },
  { who: "anyone, with the showcase switch unset", method: "POST", path: "/v1/chat", headers: {},
    vars: { EDGE_SHOWCASE_MODE: undefined }, status: 403, body: SHOWCASE_DENIED, log: [] },
];

for (const answer of ANSWERS) {
  void test(`with nothing injected, ${answer.method} ${answer.path} answers ${answer.who} with ${String(answer.status)}`, async (t) => {
    const seam = bareSeam(t, UNLIMITED, answer.vars);
    const response = await seam.send(answer.method, answer.path, answer.headers);
    assert.equal(response.status, answer.status);
    assert.equal(await response.text(), answer.body);
    assert.deepEqual(seam.log, answer.log);
  });
}
