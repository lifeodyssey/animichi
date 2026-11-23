/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins how today's gateway gets the key it signs and verifies the visitor
 * cookies with (`ANON_ID_SECRET`, a plain string or a Secrets Store binding)
 * before any cookie is read: a store-bound key verifies the literal cookies
 * minted under it; a rotated key verifies neither, so the refused visitor is
 * issued a new identity under it and the refusal carries it; an empty key turns
 * anonymous access off; with anonymous access off the key is never read; and a
 * store that cannot answer fails the request without issuing an identity.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, entrySeam, SOLVED, VISITOR } from "./doubles/entry-seam.ts";
import { UNLIMITED } from "./doubles/entry-seam-limiters.ts";
import { INTERNAL_ERROR, TURNSTILE_REQUIRED, UNAUTHORIZED } from "./doubles/entry-envelopes.ts";

function store(value: string): { get: () => Promise<string> } {
  return { get: () => Promise.resolve(value) };
}

const UNANSWERING = { get: () => Promise.reject(new Error("secrets store unavailable")) };

type Keyed = readonly [key: string, vars: Readonly<Record<string, unknown>>, method: string, path: string,
  headers: Readonly<Record<string, string>>, status: number, body: string, log: readonly string[]];

const KEYED: readonly Keyed[] = [
  ["a store-bound key", { ANON_ID_SECRET: store("fixed-test-hmac-key-0000000000000000") }, "GET",
    "/v1/conversations/s-42/messages", ADMITTED, 200,
    JSON.stringify({ handler: "transcript", user: VISITOR, type: "anonymous", session: "s-42" }),
    ["auth absent", `tier transcript ${VISITOR} anonymous s-42`]],
  ["an empty key", { ANON_ID_SECRET: "" }, "POST", "/v1/chat", SOLVED, 401, UNAUTHORIZED, ["auth absent"]],
  ["an empty store value", { ANON_ID_SECRET: store("") }, "POST", "/v1/chat", SOLVED, 401, UNAUTHORIZED, ["auth absent"]],
  ["an unanswering store, anonymous access off", { ANON_ACCESS_ENABLED: "false", ANON_ID_SECRET: UNANSWERING }, "POST",
    "/v1/chat", SOLVED, 401, UNAUTHORIZED, ["auth absent"]],
  ["an unanswering store", { ANON_ID_SECRET: UNANSWERING }, "POST", "/v1/chat", SOLVED, 500, INTERNAL_ERROR, ["auth absent"]],
  ["an unanswering store, on verification", { ANON_ID_SECRET: UNANSWERING }, "POST", "/v1/turnstile/verify", SOLVED, 500,
    INTERNAL_ERROR, ["auth absent"]],
];

for (const [key, vars, method, path, headers, status, body, log] of KEYED) {
  void test(`with ${key}, ${method} ${path} answers ${String(status)} and issues no new identity`, async (t) => {
    const seam = entrySeam(t, UNLIMITED, vars);
    const response = await seam.send(method, path, headers);
    assert.equal(response.status, status);
    assert.equal(await response.text(), body);
    assert.deepEqual(seam.log, log);
    assert.deepEqual(response.headers.getSetCookie(), []);
  });
}

/** What the rotated key signs for a visitor minted when the uuid source answers fedcba98-7654-3210-fedc-ba9876543210. */
const ROTATED_SET_COOKIE =
  "aid=fedcba9876543210fedcba9876543210.c073630894342116e005fe2846e7eceef9952460631402f5532d1311abe5047c; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax";

void test("with a rotated key, GET /v1/conversations/s-42/messages answers 403 carrying the identity issued under it", async (t) => {
  t.mock.method(crypto, "randomUUID", () => "fedcba98-7654-3210-fedc-ba9876543210" as const);
  const seam = entrySeam(t, UNLIMITED, { ANON_ID_SECRET: "rotated-test-hmac-key-000000000000" });
  const response = await seam.send("GET", "/v1/conversations/s-42/messages", ADMITTED);
  assert.equal(response.status, 403);
  assert.equal(await response.text(), TURNSTILE_REQUIRED);
  assert.deepEqual(seam.log, ["auth absent", "turnstile -"]);
  assert.deepEqual(response.headers.getSetCookie(), [ROTATED_SET_COOKIE]);
});
