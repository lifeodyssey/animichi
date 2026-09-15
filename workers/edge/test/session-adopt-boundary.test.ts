import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerApp } from "../src/app.ts";
import { alwaysAllowGuard, stubCtx } from "../src/container/entry-env.ts";
import { handleSessionAdopt, rejectClientSessionId } from "../src/identity/session-adopt.ts";
import { signedAidCookie } from "./doubles/signed-anonymous-cookie.ts";
import { ADOPTION_ANON_ENV, adoptionStore } from "./doubles/session-adoption-doubles.ts";

const REJECTION_ANON_ID = "anon_" + "a".repeat(32);
const ADOPTION_URL = "https://animichi.test/v1/sessions/adopt";

/** The identity the gateway forwards to the adoption route. `verifiedAccount`
 * re-checks it as a conjunction, so this suite drives each conjunct with a
 * caller that only that conjunct can refuse. */
interface AdoptionCaller {
  readonly userId: string;
  readonly userType: "human" | "anonymous";
}

const HUMAN_CALLER: AdoptionCaller = { userId: "real-user-1", userType: "human" };
const ANONYMOUS_CALLER: AdoptionCaller = { userId: REJECTION_ANON_ID, userType: "anonymous" };
/** Deliberately not `anon_`-prefixed: without the user-type check this caller
 * looks exactly like a verified human account. */
const UNPREFIXED_ANONYMOUS_CALLER: AdoptionCaller = { userId: "visitor-session", userType: "anonymous" };
const ANON_PREFIXED_HUMAN_CALLER: AdoptionCaller = { userId: "anon_" + "b".repeat(32), userType: "human" };
/** Human type and no `anon_` prefix, so only the non-empty-id conjunct can
 * refuse this caller. */
const EMPTY_USER_ID_CALLER: AdoptionCaller = { userId: "", userType: "human" };

/** The refusal path needs the same anonymous env as the route but no CONTAINER
 * binding: nothing downstream may be reached before the write is refused. */
function adoptionEnv() {
  return {
    ...ADOPTION_ANON_ENV,
    EDGE_GUARD: alwaysAllowGuard,
  } as never;
}

async function signedRequest(request: Request): Promise<Request> {
  const headers = new Headers(request.headers);
  headers.set("Cookie", await signedAidCookie(REJECTION_ANON_ID));
  return new Request(request, { headers });
}

async function assertRejectedBeforeWrite(
  request: Request, status: number, caller: AdoptionCaller = HUMAN_CALLER,
): Promise<void> {
  const writes = { count: 0 };
  const signed = await signedRequest(request);
  const response = await handleSessionAdopt(adoptionEnv(), signed, caller, adoptionStore(writes));
  assert.equal(response.status, status);
  assert.equal(writes.count, 0);
}

void test("client session_id in the query is refused before adoption writes", async () => {
  await assertRejectedBeforeWrite(
    new Request("https://animichi.test/v1/sessions/adopt?session_id=client-supplied", { method: "POST" }),
    400,
  );
});

void test("client session_id in a header is refused before adoption writes", async () => {
  await assertRejectedBeforeWrite(
    new Request("https://animichi.test/v1/sessions/adopt", {
      method: "POST",
      headers: { "X-Session-Id": "client-supplied" },
    }),
    400,
  );
});

void test("client session_id in the bounded body probe is refused before adoption writes", async () => {
  await assertRejectedBeforeWrite(
    new Request("https://animichi.test/v1/sessions/adopt", {
      method: "POST",
      body: JSON.stringify({ session_id: "client-supplied" }),
      headers: { "Content-Type": "application/json" },
    }),
    400,
  );
});

void test("a body beyond the 1024-byte probe bound is refused before adoption writes", async () => {
  await assertRejectedBeforeWrite(
    new Request("https://animichi.test/v1/sessions/adopt", { method: "POST", body: "x".repeat(1025) }),
    413,
  );
});

void test("a body at the 1024-byte probe bound remains probeable", async () => {
  const rejection = await rejectClientSessionId(new Request("https://animichi.test/v1/sessions/adopt", {
    method: "POST",
    body: " ".repeat(1022) + "{}",
  }));
  assert.equal(rejection, null);
});

void test("a declared body beyond the 1024-byte probe bound is refused before reading or writing", async () => {
  await assertRejectedBeforeWrite(
    new Request("https://animichi.test/v1/sessions/adopt", {
      method: "POST",
      headers: { "Content-Length": "1025" },
    }),
    413,
  );
});

function unverifiedEnvironment(opened: { count: number }) {
  return {
    ...ADOPTION_ANON_ENV,
    EDGE_GUARD: alwaysAllowGuard,
    AGENT_SVC_DATABASE_URL: { get: () => { opened.count += 1; return Promise.resolve("unused"); } },
  } as never;
}

void test("the gateway rejects an unverified caller before opening the adoption database", async () => {
  const opened = { count: 0 };
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const) });
  const response = await app.request("/v1/sessions/adopt", { method: "POST" }, unverifiedEnvironment(opened), stubCtx);
  assert.equal(response.status, 401);
  assert.equal(opened.count, 0);
});

void test("a caller without a verified account is refused before adoption writes", async () => {
  await assertRejectedBeforeWrite(new Request(ADOPTION_URL, { method: "POST" }), 403, ANONYMOUS_CALLER);
});

// `verifiedAccount` is a three-conjunct check: `type === "human"`,
// `id.length > 0`, `!id.startsWith("anon_")`. A fully anonymous caller is
// refused by any two of them, so the canonical caller cannot tell them apart.
// Each test below is refusable only by its own conjunct: deleting that
// conjunct turns the named test red at the status assertion and at the
// store-write count.
void test("an anonymous user type is refused even without an anon_-prefixed id", async () => {
  await assertRejectedBeforeWrite(new Request(ADOPTION_URL, { method: "POST" }), 403, UNPREFIXED_ANONYMOUS_CALLER);
});

void test("a human identity carrying an anon_-prefixed id is refused", async () => {
  await assertRejectedBeforeWrite(new Request(ADOPTION_URL, { method: "POST" }), 403, ANON_PREFIXED_HUMAN_CALLER);
});

void test("a human identity with an empty user id is refused before adoption writes", async () => {
  await assertRejectedBeforeWrite(new Request(ADOPTION_URL, { method: "POST" }), 403, EMPTY_USER_ID_CALLER);
});
