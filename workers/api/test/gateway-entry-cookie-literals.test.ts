/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins today's two cookies as literal strings: the signed anonymous id
 * (`aid`) and the Turnstile pass, both minted by today's code under the fixed
 * test key (`entry-seam.ts`). A cookie minted today must still verify after the
 * swap, and the `Set-Cookie` lines the gateway writes must stay byte-identical —
 * value, attribute order and all — on exactly the answers that carry them today.
 *
 * A visitor's identity is minted when it is first needed, but written only on an
 * answer that serves them or verifies them: a refused request drops it. The
 * Anitabi image arm strips its origin's cookie; the users forward hands its
 * service's cookie through.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, AID, entrySeam, HUMAN, NOW, PASS, SOLVED, VISITOR } from "./doubles/entry-seam.ts";
import { LIMITED, UNLIMITED, type LimiterPlan } from "./doubles/entry-seam-limiters.ts";

const AID_SET_COOKIE =
  "aid=0123456789abcdef0123456789abcdef.80d26bb16b9d931cfd330fea2c8338f4941eebd9c3d3cafe0e52c04602744a23; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax";
const PASS_SET_COOKIE =
  "turnstile_pass=1795435500000.8fb804c47fb711d17a18cdc21a5ac4f29f1f07e270e3d3aee2f0e2e10c92b4d2; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Lax";
/** Another visitor's signed id, minted by today's code under the same key. */
const OTHER_AID = "aid=fedcba9876543210fedcba9876543210.b42bbc3660a16f173d494c53129f65ede295a6b9b7d53d4ce944189da0431742";
const TRANSCRIPT = "/v1/conversations/s-42/messages";

void test("the literal aid still identifies its visitor", async (t) => {
  const seam = entrySeam(t);
  const response = await seam.send("GET", TRANSCRIPT, { Cookie: AID, ...SOLVED });
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.getSetCookie(), []);
  assert.deepEqual(seam.log, ["auth absent", "turnstile solved-token", `tier transcript ${VISITOR} anonymous s-42`]);
});

void test("the literal pass still admits that visitor without a challenge", async (t) => {
  const seam = entrySeam(t);
  const response = await seam.send("GET", TRANSCRIPT, ADMITTED);
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.getSetCookie(), []);
  assert.deepEqual(seam.log, ["auth absent", `tier transcript ${VISITOR} anonymous s-42`]);
});

void test("the literal pass admits no other visitor", async (t) => {
  const seam = entrySeam(t);
  const response = await seam.send("GET", TRANSCRIPT, { Cookie: `${OTHER_AID}; ${PASS}` });
  assert.equal(response.status, 403);
  assert.deepEqual(seam.log, ["auth absent", "turnstile -"]);
});

void test("the literal pass expires five minutes after it was minted", async (t) => {
  const seam = entrySeam(t);
  t.mock.timers.setTime(NOW + 300_000);
  const response = await seam.send("GET", TRANSCRIPT, ADMITTED);
  assert.equal(response.status, 403);
  assert.deepEqual(seam.log, ["auth absent", "turnstile -"]);
});

type Written = readonly [answer: string, method: string, path: string, headers: Readonly<Record<string, string>>,
  plan: LimiterPlan, status: number, setCookie: readonly string[]];

const WRITTEN: readonly Written[] = [
  ["a new visitor's verification", "POST", "/v1/turnstile/verify", SOLVED, UNLIMITED, 204, [AID_SET_COOKIE, PASS_SET_COOKIE]],
  ["a returning visitor's verification", "POST", "/v1/turnstile/verify", { Cookie: AID, ...SOLVED }, UNLIMITED, 204, [PASS_SET_COOKIE]],
  ["a new visitor's first turn", "POST", "/v1/chat", SOLVED, UNLIMITED, 200, [AID_SET_COOKIE]],
  ["a new visitor's first transcript read", "GET", TRANSCRIPT, SOLVED, UNLIMITED, 200, [AID_SET_COOKIE]],
  ["an admitted visitor's turn", "POST", "/v1/chat", ADMITTED, UNLIMITED, 200, []],
  ["a verified caller's turn", "POST", "/v1/chat", HUMAN, UNLIMITED, 200, []],
  ["a verified caller's verification", "POST", "/v1/turnstile/verify", HUMAN, UNLIMITED, 204, []],
  ["a new visitor refused by Turnstile", "POST", "/v1/chat", {}, UNLIMITED, 403, []],
  ["a new visitor refused by the limiter", "POST", "/v1/chat", SOLVED, LIMITED, 429, []],
  ["an image whose origin set a cookie", "GET", "/img/a.jpg?plan=h160", {}, UNLIMITED, 200, []],
  ["the readiness probe", "GET", "/healthz", {}, UNLIMITED, 200, []],
];

for (const [answer, method, path, headers, plan, status, setCookie] of WRITTEN) {
  void test(`${answer} writes exactly ${String(setCookie.length)} Set-Cookie line(s), byte for byte`, async (t) => {
    t.mock.method(crypto, "randomUUID", () => "01234567-89ab-cdef-0123-456789abcdef" as const);
    const seam = entrySeam(t, plan);
    const response = await seam.send(method, path, headers);
    assert.equal(response.status, status);
    assert.deepEqual(response.headers.getSetCookie(), setCookie);
  });
}

void test("the users forward hands its service's Set-Cookie through unchanged", async (t) => {
  const answer = new Response("ok", { headers: { "Set-Cookie": "pref=compact; Path=/; SameSite=Lax" } });
  const seam = entrySeam(t, UNLIMITED, { USERS: { fetch: () => Promise.resolve(answer) } });
  const response = await seam.send("GET", "/v1/users/saved-routes", HUMAN);
  assert.deepEqual(response.headers.getSetCookie(), ["pref=compact; Path=/; SameSite=Lax"]);
});
