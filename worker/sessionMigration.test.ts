import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "./app.ts";

const SECRET = "fixed-test-hmac-key-0000000000000000";
const ANON_ENV = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: SECRET };

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

const authOk = () => Promise.resolve({ ok: true, userId: "real-user-1", userType: "human" } as const);

/** An EDGE_GUARD stand-in that always allows (mirrors entry.test.ts): the
 * migration route is not in AUTH_RATE_LIMITED_EXACT, but it still passes
 * through `authenticatedForward`'s check, which reads `env.EDGE_GUARD`. */
const alwaysAllowGuard = {
  idFromName: (name: string) => name as unknown as DurableObjectId,
  get: () => ({
    fetch: () =>
      Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))),
  }),
};

function envWithContainer(captured: { req?: Request }, body: object = { migrated: true }) {
  return {
    ...ANON_ENV,
    EDGE_GUARD: alwaysAllowGuard,
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({
        fetch: (r: Request) => {
          captured.req = r;
          return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
        },
      }),
    },
  } as never;
}

async function anonCookieFor(userId: string): Promise<string> {
  // Mirrors auth.ts's HMAC scheme with the fixed test secret above.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = userId.replace(/^anon_/, "");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  const hex = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `aid=${raw}.${hex}`;
}

void test("a valid aid cookie reaches the container as X-Anon-Id, exactly", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ nextHandler: { fetch: () => Promise.resolve(new Response("next")) }, authenticate: authOk });
  const cookie = await anonCookieFor("anon_" + "a".repeat(32));
  await app.request("/v1/session/migrate", { method: "POST", headers: { Cookie: cookie } }, envWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-Anon-Id"), "anon_" + "a".repeat(32));
});

void test("no aid cookie -> no X-Anon-Id forwarded, and no Set-Cookie on the response", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ nextHandler: { fetch: () => Promise.resolve(new Response("next")) }, authenticate: authOk });
  const res = await app.request(
    "/v1/session/migrate", { method: "POST" }, envWithContainer(cap, { migrated: false }), stubCtx,
  );
  assert.equal(cap.req?.headers.get("X-Anon-Id"), null);
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("a tampered aid cookie -> no X-Anon-Id forwarded, and no Set-Cookie on the response", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ nextHandler: { fetch: () => Promise.resolve(new Response("next")) }, authenticate: authOk });
  const res = await app.request(
    "/v1/session/migrate",
    { method: "POST", headers: { Cookie: `aid=${"a".repeat(32)}.${"b".repeat(64)}` } },
    envWithContainer(cap, { migrated: false }),
    stubCtx,
  );
  assert.equal(cap.req?.headers.get("X-Anon-Id"), null);
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("a client-forged X-Anon-Id is overwritten by the edge's own resolution", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ nextHandler: { fetch: () => Promise.resolve(new Response("next")) }, authenticate: authOk });
  const cookie = await anonCookieFor("anon_" + "c".repeat(32));
  await app.request(
    "/v1/session/migrate",
    { method: "POST", headers: { Cookie: cookie, "X-Anon-Id": "anon_" + "f".repeat(32) } },
    envWithContainer(cap),
    stubCtx,
  );
  assert.equal(cap.req?.headers.get("X-Anon-Id"), "anon_" + "c".repeat(32));
  assert.notEqual(cap.req?.headers.get("X-Anon-Id"), "anon_" + "f".repeat(32));
});

void test("a successful migration rotates/clears the aid cookie", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ nextHandler: { fetch: () => Promise.resolve(new Response("next")) }, authenticate: authOk });
  const cookie = await anonCookieFor("anon_" + "d".repeat(32));
  const res = await app.request(
    "/v1/session/migrate", { method: "POST", headers: { Cookie: cookie } }, envWithContainer(cap, { migrated: true }), stubCtx,
  );
  const setCookie = String(res.headers.get("Set-Cookie"));
  assert.match(setCookie, /^aid=;/);
  assert.match(setCookie, /Max-Age=0/);
});

void test("a no-op migration (migrated: false) does not rotate the cookie", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ nextHandler: { fetch: () => Promise.resolve(new Response("next")) }, authenticate: authOk });
  const cookie = await anonCookieFor("anon_" + "e".repeat(32));
  const res = await app.request(
    "/v1/session/migrate", { method: "POST", headers: { Cookie: cookie } }, envWithContainer(cap, { migrated: false }), stubCtx,
  );
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("X-Anon-Id is stripped on every OTHER /v1 route, even with a valid cookie", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ nextHandler: { fetch: () => Promise.resolve(new Response("next")) }, authenticate: authOk });
  const cookie = await anonCookieFor("anon_" + "b".repeat(32));
  await app.request(
    "/v1/chat", { method: "POST", headers: { Cookie: cookie, "X-Anon-Id": "anon_" + "b".repeat(32) } }, envWithContainer(cap), stubCtx,
  );
  assert.equal(cap.req?.headers.get("X-Anon-Id"), null);
});
