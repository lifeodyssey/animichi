/**
 * SUT: the guard Durable Object (`EdgeGuard`, `src/protect/edge-guard.ts`),
 * entered through `fetch`. This file pins how the object reads the limiter
 * config a `/rate-limit` request carries in its JSON body, and when it falls
 * back to the config it was deployed with (`ANON_RATE_LIMIT` and
 * `ANON_RATE_LIMIT_WINDOW_SECONDS`, two per 30 s here). Its one reading of
 * that body feeds both the verdict and the reclaim alarm, so each row states
 * the verdicts of three checks and the alarm the first one armed.
 *
 * A body whose `limit` and `windowSeconds` are both finite numbers is applied as
 * sent, extra keys and all, as long as the window is no longer than 4e12 s, the
 * longest whose reclaim alarm still falls inside the range a `Date` can hold;
 * any other body falls back. A JSON number too large for a double arrives as
 * Infinity, which is not finite, so it falls back too. The deployed window is
 * held to the same bound: a longer one gives way to the default 60 s window, for
 * a body that falls back and for the alarm of one that does not. A body that is
 * not JSON makes `fetch` reject before anything is stored, and a `/budget`
 * request never reads its body.
 *
 * test-type: characterization
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EdgeGuard, parseConfig } from "../src/protect/edge-guard.ts";
import type { RateLimitConfig } from "../src/protect/rate-limiter.ts";
import { fakeStorage } from "./doubles/guard-doubles.ts";

/** 2026-11-23T12:00:00Z. */
const NOW = 1795435200000;
const DEPLOYED = { ANON_RATE_LIMIT: "2", ANON_RATE_LIMIT_WINDOW_SECONDS: "30" };

function guardOver(t: TestContext, deployed: Readonly<Record<string, string>> = DEPLOYED) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const storage = fakeStorage();
  const guard = new EdgeGuard({ storage: storage.state } as unknown as DurableObjectState, deployed);
  return { guard, data: storage.data, alarm: storage.alarm };
}

function rateLimit(body: string): Request {
  return new Request("https://edge-guard/rate-limit", { method: "POST", body });
}

/** The bodies of three consecutive checks that each carry `body`, in order. */
async function threeAnswers(guard: EdgeGuard, body: string): Promise<string[]> {
  const answers: string[] = [];
  for (let sent = 0; sent < 3; sent += 1) answers.push(await (await guard.fetch(rateLimit(body))).text());
  return answers;
}

/** What three checks carrying one body get, and when the first one armed the reclaim alarm: two windows
 * past the wider of the applied and the deployed window. */
interface Outcome {
  readonly says: string;
  readonly answers: readonly string[];
  readonly alarmAt: number;
}

const ONE_PER_TEN_MINUTES: Outcome = {
  says: "is applied: one check per ten minutes",
  answers: ['{"allowed":true,"retryAfterSeconds":600}', '{"allowed":false,"retryAfterSeconds":600}',
    '{"allowed":false,"retryAfterSeconds":600}'],
  alarmAt: NOW + 1_200_000,
};
const ONE_PER_TEN_SECONDS: Outcome = {
  says: "is applied: one check per ten seconds, with the alarm on the wider deployed window",
  answers: ['{"allowed":true,"retryAfterSeconds":10}', '{"allowed":false,"retryAfterSeconds":10}',
    '{"allowed":false,"retryAfterSeconds":10}'],
  alarmAt: NOW + 60_000,
};
const DEPLOYED_FALLBACK: Outcome = {
  says: "falls back to the deployed two checks per 30 s",
  answers: ['{"allowed":true,"retryAfterSeconds":30}', '{"allowed":true,"retryAfterSeconds":30}',
    '{"allowed":false,"retryAfterSeconds":30}'],
  alarmAt: NOW + 60_000,
};
const LONGEST_WINDOW: Outcome = {
  says: "is applied: the longest window, with a finite retry hint and its alarm inside the Date range",
  answers: ['{"allowed":true,"retryAfterSeconds":4000000000000}', '{"allowed":false,"retryAfterSeconds":4000000000000}',
    '{"allowed":false,"retryAfterSeconds":4000000000000}'],
  alarmAt: NOW + 8_000_000_000_000_000,
};
const DEFAULT_WINDOW_FALLBACK: Outcome = {
  says: "falls back to the deployed two checks, per the default 60 s window",
  answers: ['{"allowed":true,"retryAfterSeconds":60}', '{"allowed":true,"retryAfterSeconds":60}',
    '{"allowed":false,"retryAfterSeconds":60}'],
  alarmAt: NOW + 120_000,
};
const DENIES_EVERY_CHECK: Outcome = {
  says: "is applied: a limit of zero or less denies every check",
  answers: ['{"allowed":false,"retryAfterSeconds":600}', '{"allowed":false,"retryAfterSeconds":600}',
    '{"allowed":false,"retryAfterSeconds":600}'],
  alarmAt: NOW + 1_200_000,
};
const NO_LIMIT_HINT_ONE: Outcome = {
  says: "is applied: a window of zero or less is no limit, with a retry hint of 1 s",
  answers: ['{"allowed":true,"retryAfterSeconds":1}', '{"allowed":true,"retryAfterSeconds":1}',
    '{"allowed":true,"retryAfterSeconds":1}'],
  alarmAt: NOW + 60_000,
};
const LIMIT_AT_ITS_CEILING: Outcome = {
  says: "is applied: a fractional limit acts as its ceiling, two checks per ten minutes",
  answers: ['{"allowed":true,"retryAfterSeconds":600}', '{"allowed":true,"retryAfterSeconds":600}',
    '{"allowed":false,"retryAfterSeconds":600}'],
  alarmAt: NOW + 1_200_000,
};
const ONE_PER_HALF_SECOND: Outcome = {
  says: "is applied: one check per half-second window, with a retry hint of 1 s",
  answers: ['{"allowed":true,"retryAfterSeconds":1}', '{"allowed":false,"retryAfterSeconds":1}',
    '{"allowed":false,"retryAfterSeconds":1}'],
  alarmAt: NOW + 60_000,
};

const BODIES: readonly (readonly [body: string, outcome: Outcome])[] = [
  ['{"limit":1,"windowSeconds":600}', ONE_PER_TEN_MINUTES],
  ['{"limit":1,"windowSeconds":600,"source":"gateway"}', ONE_PER_TEN_MINUTES],
  ['{"limit":1e999,"windowSeconds":600}', DEPLOYED_FALLBACK],
  ['{"limit":-1e999,"windowSeconds":600}', DEPLOYED_FALLBACK],
  ['{"limit":1,"windowSeconds":1e999}', DEPLOYED_FALLBACK],
  ['{"limit":1,"windowSeconds":-1e999}', DEPLOYED_FALLBACK],
  ['{"limit":1,"windowSeconds":4000000000000}', LONGEST_WINDOW],
  ['{"limit":1,"windowSeconds":4000000000001}', DEPLOYED_FALLBACK],
  ['{"limit":1,"windowSeconds":1e306}', DEPLOYED_FALLBACK],
  ['{"limit":1,"windowSeconds":10}', ONE_PER_TEN_SECONDS],
  ['{"limit":0,"windowSeconds":600}', DENIES_EVERY_CHECK],
  ['{"limit":-1,"windowSeconds":600}', DENIES_EVERY_CHECK],
  ['{"limit":1,"windowSeconds":0}', NO_LIMIT_HINT_ONE],
  ['{"limit":1,"windowSeconds":-60}', NO_LIMIT_HINT_ONE],
  ['{"limit":1.5,"windowSeconds":600}', LIMIT_AT_ITS_CEILING],
  ['{"limit":1,"windowSeconds":0.5}', ONE_PER_HALF_SECOND],
  ['{"limit":"1","windowSeconds":600}', DEPLOYED_FALLBACK],
  ['{"limit":null,"windowSeconds":600}', DEPLOYED_FALLBACK],
  ['{"limit":1}', DEPLOYED_FALLBACK],
  ['{"windowSeconds":600}', DEPLOYED_FALLBACK],
  ["{}", DEPLOYED_FALLBACK],
  ["[1,600]", DEPLOYED_FALLBACK],
  ["null", DEPLOYED_FALLBACK],
  ['"1"', DEPLOYED_FALLBACK],
];

for (const [body, outcome] of BODIES) {
  void test(`a /rate-limit body of ${body} ${outcome.says}`, async (t) => {
    const { guard, alarm } = guardOver(t);
    assert.deepEqual(await threeAnswers(guard, body), outcome.answers);
    assert.equal(alarm.at, outcome.alarmAt);
  });
}

/** A deployment whose window is too long for the reclaim alarm: 10^306 seconds, written out in 307 digits. */
const OVERLONG_DEPLOYMENT = { ANON_RATE_LIMIT: "2", ANON_RATE_LIMIT_WINDOW_SECONDS: "1".padEnd(307, "0") };

const UNDER_OVERLONG_DEPLOYMENT: readonly (readonly [body: string, outcome: Outcome])[] = [
  ["{}", DEFAULT_WINDOW_FALLBACK],
  ['{"limit":1,"windowSeconds":600}', ONE_PER_TEN_MINUTES],
];

for (const [body, outcome] of UNDER_OVERLONG_DEPLOYMENT) {
  void test(`with a deployed window too long for the alarm, a /rate-limit body of ${body} ${outcome.says}`, async (t) => {
    const { guard, alarm } = guardOver(t, OVERLONG_DEPLOYMENT);
    assert.deepEqual(await threeAnswers(guard, body), outcome.answers);
    assert.equal(alarm.at, outcome.alarmAt);
  });
}

void test("a /rate-limit body that is not JSON makes fetch reject, storing nothing and arming no alarm", async (t) => {
  const { guard, data, alarm } = guardOver(t);
  await assert.rejects(guard.fetch(rateLimit("limit=1")), SyntaxError);
  assert.deepEqual([...data.keys()], []);
  assert.equal(alarm.at, null);
});

void test("a /budget request is answered without reading its body", async (t) => {
  const { guard } = guardOver(t);
  const request = new Request("https://edge-guard/budget?dayKey=2026-11-23", { method: "POST", body: "not json" });
  assert.equal(await (await guard.fetch(request)).text(), '{"latched":true}');
});

// JSON has no NaN (an overflow parses to Infinity, above), so no request body
// can carry one: the exported parser is the only seam that reaches it.
void test("the config parser falls back on a NaN limit and window", () => {
  assert.deepEqual(parseConfig({ limit: Number.NaN, windowSeconds: Number.NaN }, { limit: 2, windowSeconds: 30 }),
    { limit: 2, windowSeconds: 30 });
});

/** What the exported parser makes of one value against the deployed two per 30 s. */
const PARSED: readonly (readonly [says: string, value: unknown, applied: RateLimitConfig])[] = [
  ["falls back on a NaN limit alone", { limit: Number.NaN, windowSeconds: 600 }, { limit: 2, windowSeconds: 30 }],
  ["falls back on a NaN window alone", { limit: 1, windowSeconds: Number.NaN }, { limit: 2, windowSeconds: 30 }],
  ["applies a finite config and drops an extra key", { limit: 1, windowSeconds: 600, source: "gateway" }, { limit: 1, windowSeconds: 600 }],
];

for (const [says, value, applied] of PARSED) {
  void test(`the config parser ${says}`, () => {
    assert.deepEqual(parseConfig(value, { limit: 2, windowSeconds: 30 }), applied);
  });
}
