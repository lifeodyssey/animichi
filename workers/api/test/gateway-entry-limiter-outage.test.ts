/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins how each rate class answers a limiter outage today, a limiter whose
 * call throws: the `durable` class fails closed when its durable shard is down
 * (503 `rate_limit_unavailable`, nothing served) but steps over a down coarse
 * damper; the `native` class fails open on its damper; the `none` class never
 * notices. The classes themselves are pinned in `gateway-entry-rate-class.test.ts`.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, entrySeam, HUMAN, VISITOR } from "./doubles/entry-seam.ts";
import type { LimiterPlan } from "./doubles/entry-seam-limiters.ts";
import { RATE_LIMIT_UNAVAILABLE } from "./doubles/entry-envelopes.ts";

const OUTAGES = {
  "the durable shard down": { coarse: Number.POSITIVE_INFINITY, durable: "down" },
  "the coarse damper down": { coarse: "down", durable: Number.POSITIVE_INFINITY },
  "both limiters down": { coarse: "down", durable: "down" },
} satisfies Record<string, LimiterPlan>;

const CALLERS = { "a verified caller": HUMAN, "an admitted visitor": ADMITTED, "a reader": {} };

type Outage = readonly [outage: keyof typeof OUTAGES, method: string, path: string, caller: keyof typeof CALLERS,
  status: number, body: string, log: readonly string[]];

const WRITE = ["auth u1", "coarse authed:u1", "rate:authed:u1 POST /rate-limit"];
const USERS = "/v1/users/saved-routes";
const POPULAR = "/catalog/public/popular";
const CATALOG_READ = ["coarse public-read", `catalog GET ${POPULAR}`];

const ROWS: readonly Outage[] = [
  ["the durable shard down", "POST", "/v1/chat", "a verified caller", 503, RATE_LIMIT_UNAVAILABLE, WRITE],
  ["the durable shard down", "POST", "/v1/byok/probe", "a verified caller", 503, RATE_LIMIT_UNAVAILABLE, WRITE],
  ["the durable shard down", "POST", USERS, "a verified caller", 503, RATE_LIMIT_UNAVAILABLE, WRITE],
  ["the durable shard down", "HEAD", USERS, "a verified caller", 503, "", WRITE],
  ["the durable shard down", "POST", "/v1/sessions/adopt", "a verified caller", 503, RATE_LIMIT_UNAVAILABLE, WRITE],
  ["the durable shard down", "POST", "/v1/chat", "an admitted visitor", 503, RATE_LIMIT_UNAVAILABLE,
    ["auth absent", `coarse ${VISITOR}`, `rate:${VISITOR} POST /rate-limit`]],
  ["the durable shard down", "GET", USERS, "a verified caller", 200, `users GET ${USERS}`, ["auth u1", `users GET ${USERS} as u1/human`]],
  ["the durable shard down", "GET", "/v1/conversations", "a verified caller", 200, '{"handler":"list","user":"u1","type":"human","session":"-"}',
    ["auth u1", "tier list u1 human -"]],
  ["the durable shard down", "GET", POPULAR, "a reader", 200, '{"service":"catalog"}', CATALOG_READ],
  ["the coarse damper down", "POST", "/v1/chat", "a verified caller", 200, '{"handler":"chat","user":"u1","type":"human","session":"-"}',
    [...WRITE, "tier chat u1 human -"]],
  ["the coarse damper down", "POST", USERS, "a verified caller", 200, `users POST ${USERS}`, [...WRITE, `users POST ${USERS} as u1/human`]],
  ["the coarse damper down", "GET", POPULAR, "a reader", 200, '{"service":"catalog"}', CATALOG_READ],
  ["both limiters down", "GET", POPULAR, "a reader", 200, '{"service":"catalog"}', CATALOG_READ],
  ["both limiters down", "POST", "/v1/chat", "a verified caller", 503, RATE_LIMIT_UNAVAILABLE, WRITE],
];

for (const [outage, method, path, caller, status, body, log] of ROWS) {
  void test(`with ${outage}, ${method} ${path} from ${caller} answers ${String(status)}`, async (t) => {
    const seam = entrySeam(t, OUTAGES[outage]);
    const response = await seam.send(method, path, CALLERS[caller]);
    assert.equal(response.status, status);
    assert.equal(await response.text(), body);
    assert.deepEqual(seam.log, log);
  });
}
