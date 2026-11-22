/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins how today's gateway reads its two cookies out of the `Cookie`
 * header, through the three readers that use them: a visitor's turn or read
 * (which mints a new identity when the `aid` does not verify), the Turnstile
 * pass check, and adoption (which never mints).
 *
 * Today's reader splits on ";", trims each pair, and takes the FIRST pair whose
 * name is exactly the cookie's, keeping its value as written: no unquoting, no
 * percent-decoding, no trimming around the "=", and a first duplicate wins even
 * when its value is garbage. Each of those differs from the cookie parser of
 * the installed Hono, which unquotes, decodes, trims and skips an invalid first
 * duplicate, so each is a row here.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN, SOLVED, VISITOR } from "./doubles/entry-seam.ts";

const ID = "0123456789abcdef0123456789abcdef";
const SIGNATURE = "80d26bb16b9d931cfd330fea2c8338f4941eebd9c3d3cafe0e52c04602744a23";
const AID_VALUE = `${ID}.${SIGNATURE}`;
const PASS_VALUE = "1795435500000.8fb804c47fb711d17a18cdc21a5ac4f29f1f07e270e3d3aee2f0e2e10c92b4d2";
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
  [`aid=garbage; aid=${AID_VALUE}`, MINTED, [MINTED_SET_COOKIE]],
  [`aid=bad"value; aid=${AID_VALUE}`, MINTED, [MINTED_SET_COOKIE]],
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
  [`aid=${AID_VALUE}; turnstile_pass=garbage; turnstile_pass=${PASS_VALUE}`, 403, CHALLENGED_LOG],
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
  [`aid=garbage; aid=${AID_VALUE}`, NOTHING_TO_ADOPT, WRITE],
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
