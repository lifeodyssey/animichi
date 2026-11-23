/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins a HEAD against its GET in each state that changes the GET's answer:
 * the two public catalog reads with every limiter open, with every limiter
 * exhausted and in showcase mode; the readiness probe, the users read and the
 * agent tier's three reads with every limiter open, for a verified caller and,
 * on the two reads the tier admits a visitor to, for an admitted visitor.
 *
 * The HEAD answers with its GET's status and its GET's whole header set — every
 * header but the varying `X-Request-Id`, which it carries fresh — and no body.
 * It also asks exactly what its GET asked, in the same order: the same identity
 * check, the same limiters and the same forward, so a HEAD spends no limiter
 * its GET does not spend and writes nothing its GET does not write.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, entrySeam, HUMAN } from "./doubles/entry-seam.ts";
import { LIMITED, UNLIMITED, type LimiterPlan } from "./doubles/entry-seam-limiters.ts";

const STATES = {
  "every limiter open": { plan: UNLIMITED, vars: {} },
  "every limiter exhausted": { plan: LIMITED, vars: {} },
  "showcase mode on": { plan: UNLIMITED, vars: { EDGE_SHOWCASE_MODE: "true" } },
} satisfies Record<string, { plan: LimiterPlan; vars: Readonly<Record<string, unknown>> }>;

type HeaderSet = readonly (readonly [string, string])[];
type Mirrored = readonly [state: keyof typeof STATES, who: string, path: string, headers: Readonly<Record<string, string>>,
  status: number];

const POPULAR = "/catalog/public/popular";
const OVERVIEW = "/catalog/public/anime-overview/3302";
const USERS = "/v1/users/saved-routes";
const MESSAGES = "/v1/conversations/s-42/messages";
const STREAM = "/v1/conversations/s-42/stream";

const MIRRORED: readonly Mirrored[] = [
  ["every limiter open", "anyone", "/healthz", {}, 200],
  ["every limiter open", "anyone", POPULAR, {}, 200],
  ["every limiter exhausted", "anyone", POPULAR, {}, 429],
  ["showcase mode on", "anyone", POPULAR, {}, 403],
  ["every limiter open", "anyone", OVERVIEW, {}, 200],
  ["every limiter exhausted", "anyone", OVERVIEW, {}, 429],
  ["showcase mode on", "anyone", OVERVIEW, {}, 403],
  ["every limiter open", "a verified caller", USERS, HUMAN, 200],
  ["every limiter open", "a verified caller", "/v1/conversations", HUMAN, 200],
  ["every limiter open", "a verified caller", MESSAGES, HUMAN, 200],
  ["every limiter open", "an admitted visitor", MESSAGES, ADMITTED, 200],
  ["every limiter open", "a verified caller", STREAM, HUMAN, 200],
  ["every limiter open", "an admitted visitor", STREAM, ADMITTED, 200],
];

/** Every header an answer carries but the request ID, which is fresh on each answer. */
function headerSet(response: Response): HeaderSet {
  return [...response.headers].filter(([name]) => name !== "x-request-id");
}

for (const [state, who, path, headers, status] of MIRRORED) {
  void test(`with ${state}, HEAD ${path} answers ${who} as its GET does, with no body`, async (t) => {
    const seam = entrySeam(t, STATES[state].plan, STATES[state].vars);
    const get = await seam.send("GET", path, headers);
    const getRecords = seam.log.splice(0);
    const head = await seam.send("HEAD", path, headers);
    assert.equal(get.status, status);
    assert.equal(head.status, get.status);
    assert.deepEqual(headerSet(head), headerSet(get));
    assert.ok(head.headers.has("X-Request-Id"));
    assert.equal(await head.text(), "");
    assert.deepEqual(seam.log, getRecords);
  });
}
