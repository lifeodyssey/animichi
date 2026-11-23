/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins how the gateway reads its two cookies out of the `Cookie` header,
 * through the three readers that use them: a visitor's turn or read (which
 * mints a new identity when no `aid` verifies), the Turnstile pass check, and
 * adoption (which never mints).
 *
 * The reader splits on ";", trims each pair, and matches the pairs whose name is
 * exactly the cookie's, keeping each value as written: no unquoting, no
 * percent-decoding, no trimming around the "=". Of several pairs of one name,
 * the first whose value passes that cookie's own check wins, so a garbage or
 * forged first pair is passed over: for the `aid` the signature check, for the
 * pass its verification for this visitor at this moment. Only the first three
 * values of a name are tried, whatever their shape, so a valid value behind
 * three others is never read. The installed Hono's parser differs: it
 * unquotes, decodes and trims, and passes over a first duplicate only when its
 * value is not cookie syntax. Each difference is a row here.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN, SOLVED, VISITOR } from "./doubles/entry-seam.ts";

const ID = "0123456789abcdef0123456789abcdef";
const SIGNATURE = "80d26bb16b9d931cfd330fea2c8338f4941eebd9c3d3cafe0e52c04602744a23";
const AID_VALUE = `${ID}.${SIGNATURE}`;
/** Well-formed but forged: an id the key never signed, carrying the visitor's signature. */
const FORGED_VALUE = `${"a".repeat(32)}.${SIGNATURE}`;
/** Another visitor's signed id, minted by today's code under the same key. */
const OTHER_VALUE = "fedcba9876543210fedcba9876543210.b42bbc3660a16f173d494c53129f65ede295a6b9b7d53d4ce944189da0431742";
const PASS_VALUE = "1795435500000.8fb804c47fb711d17a18cdc21a5ac4f29f1f07e270e3d3aee2f0e2e10c92b4d2";
/** Forged values in front of a valid one: after two, the valid third is still tried; after three, it is not. */
const TWO_FORGED_AIDS = `aid=${FORGED_VALUE}; aid=${"b".repeat(32)}.${SIGNATURE}`;
const THREE_FORGED_AIDS = `${TWO_FORGED_AIDS}; aid=${"c".repeat(32)}.${SIGNATURE}`;
/** Well-formed forged passes: the visitor's pass with its last signature digit changed. */
const TWO_FORGED_PASSES = `turnstile_pass=${PASS_VALUE.slice(0, -1)}3; turnstile_pass=${PASS_VALUE.slice(0, -1)}4`;
const THREE_FORGED_PASSES = `${TWO_FORGED_PASSES}; turnstile_pass=${PASS_VALUE.slice(0, -1)}5`;
/** What a visitor is minted when the uuid source answers fedcba98-7654-3210-fedc-ba9876543210. */
const MINTED = "anon_fedcba9876543210fedcba9876543210";
const MINTED_SET_COOKIE =
  "aid=fedcba9876543210fedcba9876543210.b42bbc3660a16f173d494c53129f65ede295a6b9b7d53d4ce944189da0431742; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax";
const TRANSCRIPT = "/v1/conversations/s-42/messages";

type AidReading = readonly [cookie: string, identity: string, setCookie: readonly string[]];

const AID_READINGS: readonly AidReading[] = [
  [`aid=${AID_VALUE}`, VISITOR, []],
  [`theme=dark; aid=${AID_VALUE}; lang=ja`, VISITOR, []],
  [`theme=dark;aid=${AID_VALUE}`, VISITOR, []],
  [`aid=${AID_VALUE}; aid=garbage`, VISITOR, []],
  [`aid=garbage; aid=${AID_VALUE}`, VISITOR, []],
  [`aid=bad"value; aid=${AID_VALUE}`, VISITOR, []],
  [`aid=${FORGED_VALUE}; aid=${AID_VALUE}`, VISITOR, []],
  [`aid=garbage; aid=${AID_VALUE}; aid=${OTHER_VALUE}`, VISITOR, []],
  [`${TWO_FORGED_AIDS}; aid=${AID_VALUE}`, VISITOR, []],
  [`${THREE_FORGED_AIDS}; aid=${AID_VALUE}`, MINTED, [MINTED_SET_COOKIE]],
  [`aid=garbage; aid=bad"value; aid=${ID}; aid=${AID_VALUE}`, MINTED, [MINTED_SET_COOKIE]],
  [`aid="${AID_VALUE}"`, MINTED, [MINTED_SET_COOKIE]],
  [`aid=${ID}%2E${SIGNATURE}`, MINTED, [MINTED_SET_COOKIE]],
  [`aid =${AID_VALUE}`, MINTED, [MINTED_SET_COOKIE]],
  [`aid= ${AID_VALUE}`, MINTED, [MINTED_SET_COOKIE]],
  [`AID=${AID_VALUE}`, MINTED, [MINTED_SET_COOKIE]],
  ["aid=", MINTED, [MINTED_SET_COOKIE]],
  ["", MINTED, [MINTED_SET_COOKIE]],
];

for (const [cookie, identity, setCookie] of AID_READINGS) {
  void test(`Cookie: ${JSON.stringify(cookie)} reads as the visitor ${identity}`, async (t) => {
    t.mock.method(crypto, "randomUUID", () => "fedcba98-7654-3210-fedc-ba9876543210" as const);
    const seam = entrySeam(t);
    const response = await seam.send("GET", TRANSCRIPT, { Cookie: cookie, ...SOLVED });
    assert.equal(response.status, 200);
    assert.deepEqual(seam.log, ["auth absent", "turnstile solved-token", `tier transcript ${identity} anonymous s-42`]);
    assert.deepEqual(response.headers.getSetCookie(), setCookie);
  });
}

type PassReading = readonly [cookie: string, status: number, log: readonly string[]];

const ADMITTED_LOG = ["auth absent", `tier transcript ${VISITOR} anonymous s-42`];
const CHALLENGED_LOG = ["auth absent", "turnstile -"];

const PASS_READINGS: readonly PassReading[] = [
  [`aid=${AID_VALUE}; turnstile_pass=${PASS_VALUE}`, 200, ADMITTED_LOG],
  [`turnstile_pass=${PASS_VALUE}; aid=${AID_VALUE}`, 200, ADMITTED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass=${PASS_VALUE}; turnstile_pass=garbage`, 200, ADMITTED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass=garbage; turnstile_pass=${PASS_VALUE}`, 200, ADMITTED_LOG],
  [`aid=${AID_VALUE}; ${TWO_FORGED_PASSES}; turnstile_pass=${PASS_VALUE}`, 200, ADMITTED_LOG],
  [`aid=${AID_VALUE}; ${THREE_FORGED_PASSES}; turnstile_pass=${PASS_VALUE}`, 403, CHALLENGED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass=garbage; turnstile_pass="${PASS_VALUE}"; turnstile_pass=${PASS_VALUE}.ignored; turnstile_pass=${PASS_VALUE}`,
    403, CHALLENGED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass="${PASS_VALUE}"`, 403, CHALLENGED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass=1795435500000%2E8fb804c47fb711d17a18cdc21a5ac4f29f1f07e270e3d3aee2f0e2e10c92b4d2`, 403,
    CHALLENGED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass= ${PASS_VALUE}`, 403, CHALLENGED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass=1795435500000.8fb804c47fb711d17a18cdc21a5ac4f29f1f07e270e3d3aee2f0e2e10c92b4d3`, 403,
    CHALLENGED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass=1795435900000.8fb804c47fb711d17a18cdc21a5ac4f29f1f07e270e3d3aee2f0e2e10c92b4d2`, 403,
    CHALLENGED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass=${PASS_VALUE}.ignored`, 403, CHALLENGED_LOG],
  [`aid=${AID_VALUE}; turnstile_pass=1795435500000.ABC`, 403, CHALLENGED_LOG],
];

for (const [cookie, status, log] of PASS_READINGS) {
  void test(`Cookie: ${JSON.stringify(cookie)} with no token answers ${String(status)}`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send("GET", TRANSCRIPT, { Cookie: cookie });
    assert.equal(response.status, status);
    assert.deepEqual(seam.log, log);
  });
}

type AdoptionReading = readonly [cookie: string, body: string, log: readonly string[]];

const WRITE = ["auth u1", "coarse authed:u1", "rate:authed:u1 POST /rate-limit"];
const NOTHING_TO_ADOPT = '{"adopted":0,"noop_class":"no_anonymous_identity","revisions_bumped":0}';

const ADOPTION_READINGS: readonly AdoptionReading[] = [
  [`aid=${AID_VALUE}; aid=garbage`, '{"adopted":1,"noop_class":"adopted","revisions_bumped":1}', [...WRITE, `adopt ${VISITOR} u1`]],
  [`aid=garbage; aid=${AID_VALUE}`, '{"adopted":1,"noop_class":"adopted","revisions_bumped":1}', [...WRITE, `adopt ${VISITOR} u1`]],
  [`aid=${FORGED_VALUE}; aid=${AID_VALUE}`, '{"adopted":1,"noop_class":"adopted","revisions_bumped":1}',
    [...WRITE, `adopt ${VISITOR} u1`]],
  [`${TWO_FORGED_AIDS}; aid=${AID_VALUE}`, '{"adopted":1,"noop_class":"adopted","revisions_bumped":1}',
    [...WRITE, `adopt ${VISITOR} u1`]],
  [`${THREE_FORGED_AIDS}; aid=${AID_VALUE}`, NOTHING_TO_ADOPT, WRITE],
  [`aid="${AID_VALUE}"`, NOTHING_TO_ADOPT, WRITE],
  [`aid=${ID}%2E${SIGNATURE}`, NOTHING_TO_ADOPT, WRITE],
];

for (const [cookie, body, log] of ADOPTION_READINGS) {
  void test(`adoption reads Cookie: ${JSON.stringify(cookie)} without minting`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send("POST", "/v1/sessions/adopt", { ...HUMAN, Cookie: cookie });
    assert.equal(await response.text(), body);
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.deepEqual(seam.log, log);
  });
}
