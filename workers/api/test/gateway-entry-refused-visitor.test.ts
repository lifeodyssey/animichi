/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins what a new visitor keeps when the gateway refuses their first
 * request, at each place that can refuse it: the Turnstile challenge, on a turn
 * and on verification; the per-visitor limiter, denying or out of service; and
 * the day's budget, whether the edge latch or the agent tier's own verdict says
 * so. The refusal keeps its status and body, and it carries the identity the
 * request issued, in the very `Set-Cookie` line a served first read writes,
 * byte for byte.
 *
 * Each refusal has a second row for the visitor's next request, which sends the
 * returned cookie back and reads the transcript as the same visitor, with
 * nothing new issued, although the identity source would now answer another id.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { WorkerDeps } from "../src/app.ts";
import type { Env } from "../src/env.ts";
import { entrySeam, SOLVED } from "./doubles/entry-seam.ts";
import { LIMITED, UNLIMITED, type LimiterPlan } from "./doubles/entry-seam-limiters.ts";
import { BUDGET_EXHAUSTED, RATE_LIMIT_UNAVAILABLE, RATE_LIMITED_60, TURNSTILE_REQUIRED } from "./doubles/entry-envelopes.ts";

/** The line written for a visitor minted when the uuid source answers 01234567-89ab-cdef-0123-456789abcdef. */
const ISSUED_SET_COOKIE =
  "aid=0123456789abcdef0123456789abcdef.80d26bb16b9d931cfd330fea2c8338f4941eebd9c3d3cafe0e52c04602744a23; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax";
const READ_BACK = '{"handler":"transcript","user":"anon_0123456789abcdef0123456789abcdef","type":"anonymous","session":"s-42"}';
const TRANSCRIPT = "/v1/conversations/s-42/messages";
const SHARD_DOWN: LimiterPlan = { coarse: Number.POSITIVE_INFINITY, durable: "down" };

/** Durable shards that allow the visitor's rate check and read the day as latched. */
function latchedDay(): Env["EDGE_GUARD"] {
  const bodies = new Map([["/rate-limit", '{"allowed":true,"retryAfterSeconds":0}'], ["/budget", '{"latched":true}']]);
  return {
    idFromName: (name) => name as unknown as DurableObjectId,
    get: () => ({
      fetch: (request) =>
        Promise.resolve(new Response(bodies.get(new URL(request.url).pathname), { headers: { "Content-Type": "application/json" } })),
    }),
  };
}

/** An agent tier whose turn answers the budget verdict and whose transcript read names its reader. */
function budgetVerdictTier(): NonNullable<WorkerDeps["agentTurns"]> {
  const spent = () => Promise.resolve(Response.json({ error: { code: "anon_budget_exhausted" } }, { status: 403 }));
  return {
    chat: spent, probe: spent, list: spent, stream: spent,
    transcript: (_env, _request, identity, session) =>
      Promise.resolve(Response.json({ handler: "transcript", user: identity.userId, type: identity.userType, session })),
  };
}

interface Refusal {
  readonly by: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
  readonly body: string;
  readonly plan: LimiterPlan;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly seams: WorkerDeps;
}

function refusal(by: string, path: string, headers: Refusal["headers"], status: number, body: string, more: Partial<Refusal> = {}): Refusal {
  return { by, path, headers, status, body, plan: UNLIMITED, vars: {}, seams: {}, ...more };
}

const REFUSALS: readonly Refusal[] = [
  refusal("the Turnstile challenge on a turn", "/v1/chat", {}, 403, TURNSTILE_REQUIRED),
  refusal("the Turnstile challenge on verification", "/v1/turnstile/verify", {}, 403, TURNSTILE_REQUIRED),
  // A brand-new identity cannot reach this 429 in production: both of its limiter buckets are keyed by the
  // identity and start empty. The double denies every key to reach the branch; the outage below is the
  // limiter refusal a first request really meets.
  refusal("the limiter", "/v1/chat", SOLVED, 429, RATE_LIMITED_60, { plan: LIMITED }),
  refusal("a limiter outage", "/v1/chat", SOLVED, 503, RATE_LIMIT_UNAVAILABLE, { plan: SHARD_DOWN }),
  refusal("the day's budget latch", "/v1/chat", SOLVED, 403, BUDGET_EXHAUSTED, { vars: { EDGE_GUARD: latchedDay() } }),
  refusal("the agent tier's budget verdict", "/v1/chat", SOLVED, 403, BUDGET_EXHAUSTED, { seams: { agentTurns: budgetVerdictTier() } }),
];

/** What a browser sends back after an answer: the `name=value` of each `Set-Cookie` line. */
function returnedCookies(answer: Response): string {
  return answer.headers.getSetCookie().map((line) => line.split(";", 1).join("")).join("; ");
}

for (const expected of REFUSALS) {
  void test(`a new visitor refused by ${expected.by} gets the identity it was issued, as a served read writes it`, async (t) => {
    t.mock.method(crypto, "randomUUID", () => "01234567-89ab-cdef-0123-456789abcdef" as const);
    const seam = entrySeam(t, expected.plan, expected.vars, expected.seams);
    const served = await seam.send("GET", TRANSCRIPT, SOLVED);
    const refused = await seam.send("POST", expected.path, expected.headers);
    assert.equal(refused.status, expected.status);
    assert.equal(await refused.text(), expected.body);
    assert.deepEqual(served.headers.getSetCookie(), [ISSUED_SET_COOKIE]);
    assert.deepEqual(refused.headers.getSetCookie(), served.headers.getSetCookie());
  });
}

for (const expected of REFUSALS) {
  void test(`a new visitor refused by ${expected.by} is read back as the same visitor next time`, async (t) => {
    const uuid = t.mock.method(crypto, "randomUUID", () => "01234567-89ab-cdef-0123-456789abcdef" as const);
    const seam = entrySeam(t, expected.plan, expected.vars, expected.seams);
    const refused = await seam.send("POST", expected.path, expected.headers);
    uuid.mock.mockImplementation(() => "fedcba98-7654-3210-fedc-ba9876543210" as const);
    const next = await seam.send("GET", TRANSCRIPT, { Cookie: returnedCookies(refused), ...SOLVED });
    assert.equal(await next.text(), READ_BACK);
    assert.deepEqual(next.headers.getSetCookie(), []);
  });
}
