import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { alwaysAllowGuard, stubCtx } from "./doubles/entry-env.ts";
import { ADOPTION_ANON_ENV } from "./doubles/session-adoption-doubles.ts";
import { signedAidCookie } from "./doubles/signed-anonymous-cookie.ts";

// SUT: the five callers of `nativeClient` (the conversation list, transcript and stream routes, session
// adoption, and a session start) when Prisma's runtime fails to load. It loads on the first use instead
// of at startup, so a failure that used to stop the Worker starting now belongs to the request that
// needed the database. Each caller answers it as it answers an unconfigured database, the throw just
// before its client: the routes with the gateway's 500 envelope, and the session start by rejecting,
// here with the load's own failure. Each test is bounded, so a caller that never answers fails.

const loadFailure = new Error("Prisma's runtime failed to load");
mock.module("@prisma/orm-postgres/runtime", { exports: { get default() { throw loadFailure; } } });
const { createWorkerApp } = await import("../src/app.ts");
const { bootstrapNativeSession } = await import("../src/agent/host/native-bootstrap.ts");

/** A loopback port nothing listens on, though no use here gets as far as a connection. */
const DSN = "postgres://unit:unit@127.0.0.1:1/unit";
const SESSION = "11111111-1111-4111-8111-111111111111";
const HANG_BOUND_MS = 30_000;
const OWNER = { ok: true, userId: "owner", userType: "human" } as const;
const app = createWorkerApp({ authenticate: () => Promise.resolve(OWNER) });

/** The gateway's answer, less the request ID in its headers. */
async function answer(path: string, init: RequestInit, env: Record<string, unknown>) {
  const response = await app.request(path, init, env, stubCtx);
  return { status: response.status, body: await response.json<unknown>() };
}

const READER_ENV = { EDGE_SHOWCASE_MODE: "false" };
const ROUTES = [
  { name: "the conversation list", path: "/v1/conversations", init: {}, env: READER_ENV },
  { name: "a transcript read", path: `/v1/conversations/${SESSION}/messages`, init: {}, env: READER_ENV },
  { name: "a stream lookup", path: `/v1/conversations/${SESSION}/stream`, init: {}, env: READER_ENV },
  { name: "session adoption", path: "/v1/sessions/adopt", env: { ...ADOPTION_ANON_ENV, EDGE_GUARD: alwaysAllowGuard },
    init: { method: "POST", headers: { Cookie: await signedAidCookie(`anon_${"a".repeat(32)}`) } } },
];

for (const route of ROUTES) {
  void test(`${route.name} answers a failed load as it answers an unconfigured database`, { timeout: HANG_BOUND_MS }, async () => {
    const unconfigured = await answer(route.path, route.init, route.env);
    assert.equal(unconfigured.status, 500);
    assert.deepEqual(await answer(route.path, route.init, { ...route.env, AGENT_SVC_DATABASE_URL: DSN }), unconfigured);
  });
}

void test("a session start rejects with the load's failure, as it rejects for an unconfigured database", { timeout: HANG_BOUND_MS }, async () => {
  await assert.rejects(bootstrapNativeSession({} as never, SESSION, BACKGROUND_CONTEXT), /The native agent database is not configured/);
  await assert.rejects(bootstrapNativeSession({ AGENT_SVC_DATABASE_URL: DSN } as never, SESSION, BACKGROUND_CONTEXT), (error) => error === loadFailure);
});
