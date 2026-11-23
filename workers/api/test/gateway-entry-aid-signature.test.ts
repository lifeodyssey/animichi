/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins how today's gateway compares the signature in a visitor's `aid`
 * cookie with the one it computes for the cookie's id. Only the id is
 * format-checked, so every signature below reaches that comparison: the right
 * one cut short by a character, emptied, lengthened by a character,
 * upper-cased, or of the right length with one non-ASCII character. None
 * verifies, and nothing throws: a visitor's read is served under a newly
 * minted identity, and adoption, which never mints, finds nothing to adopt.
 *
 * The Turnstile pass is format-checked before its comparison, so these shapes
 * never reach it; its rows are in `turnstile-pass.test.ts`.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN, SOLVED } from "./doubles/entry-seam.ts";

const ID = "0123456789abcdef0123456789abcdef";
const SIGNATURE = "80d26bb16b9d931cfd330fea2c8338f4941eebd9c3d3cafe0e52c04602744a23";
/** What a visitor is minted when the uuid source answers fedcba98-7654-3210-fedc-ba9876543210. */
const MINTED = "anon_fedcba9876543210fedcba9876543210";
const MINTED_SET_COOKIE =
  "aid=fedcba9876543210fedcba9876543210.b42bbc3660a16f173d494c53129f65ede295a6b9b7d53d4ce944189da0431742; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax";
const TRANSCRIPT = "/v1/conversations/s-42/messages";
const WRITE = ["auth u1", "coarse authed:u1", "rate:authed:u1 POST /rate-limit"];
const NOTHING_TO_ADOPT = '{"adopted":0,"noop_class":"no_anonymous_identity","revisions_bumped":0}';

const SIGNATURES: readonly (readonly [shape: string, signature: string])[] = [
  ["cut short by one character", SIGNATURE.slice(0, -1)],
  ["emptied", ""],
  ["lengthened by one character", `${SIGNATURE}0`],
  ["upper-cased", SIGNATURE.toUpperCase()],
  ["of the right length with one non-ASCII character", `${SIGNATURE.slice(0, -1)}é`],
];

for (const [shape, signature] of SIGNATURES) {
  void test(`a visitor whose aid signature is ${shape} is read under a newly minted identity`, async (t) => {
    t.mock.method(crypto, "randomUUID", () => "fedcba98-7654-3210-fedc-ba9876543210" as const);
    const seam = entrySeam(t);
    const response = await seam.send("GET", TRANSCRIPT, { Cookie: `aid=${ID}.${signature}`, ...SOLVED });
    assert.equal(response.status, 200);
    assert.deepEqual(seam.log, ["auth absent", "turnstile solved-token", `tier transcript ${MINTED} anonymous s-42`]);
    assert.deepEqual(response.headers.getSetCookie(), [MINTED_SET_COOKIE]);
  });
}

for (const [shape, signature] of SIGNATURES) {
  void test(`adoption with an aid signature ${shape} finds nothing to adopt`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send("POST", "/v1/sessions/adopt", { ...HUMAN, Cookie: `aid=${ID}.${signature}` });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), NOTHING_TO_ADOPT);
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.deepEqual(seam.log, WRITE);
  });
}
