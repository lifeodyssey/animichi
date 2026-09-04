/**
 * W1-7 (#1256): the routing contract of the fallback flag, at the composed
 * gateway seam. Both flag positions are pinned, because the flag's whole value
 * is that `container` is still reachable after `edge` ships.
 *
 * The agent tier itself is a double here on purpose — what this file is about
 * is WHICH tier a request reaches and WITH WHICH identity, never what the tier
 * then does with it (that is `turn-stream-handoff` / `conversation-retrieval` /
 * the agent-db lane).
 *
 * test-type: api (routing contract of the deployed request surface).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp, type WorkerDeps } from "../src/app.ts";
import type { AgentTurnTier, TurnIdentity } from "../src/gateway/agent-turn.ts";
import { ANON_V1_PATHS } from "../src/gateway/routing-policy.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const TRANSCRIPT = "/v1/conversations/s-42/messages";
const CHAT_BODY = JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] });

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

interface TierCall {
  readonly route: "chat" | "probe" | "transcript";
  readonly identity: TurnIdentity;
  readonly sessionId: string | null;
}

/** A tier that records what the gateway handed it and answers a marker. */
function makeRecordingTier(calls: TierCall[]): AgentTurnTier {
  return {
    chat: (_env, _request, identity) => {
      calls.push({ route: "chat", identity, sessionId: null });
      return Promise.resolve(new Response("tier-chat", { status: 200 }));
    },
    probe: (_request, identity) => {
      calls.push({ route: "probe", identity, sessionId: null });
      return Promise.resolve(new Response("tier-probe", { status: 200 }));
    },
    transcript: (_env, _request, identity, sessionId) => {
      calls.push({ route: "transcript", identity, sessionId });
      return Promise.resolve(new Response("tier-transcript", { status: 200 }));
    },
  };
}

/** The container, recording the request it was forwarded verbatim. */
function makeRecordingContainer(forwarded: Request[]) {
  return {
    idFromName: () => "id",
    get: () => ({
      fetch: (request: Request) => {
        forwarded.push(request);
        return Promise.resolve(new Response("container", { status: 200 }));
      },
    }),
  };
}

interface Harness {
  readonly request: (path: string, init: RequestInit) => Promise<Response>;
  readonly calls: TierCall[];
  readonly forwarded: Request[];
}

function makeHarness(flag: string | undefined, deps: WorkerDeps = {}): Harness {
  const calls: TierCall[] = [];
  const forwarded: Request[] = [];
  const app = createWorkerApp({ agentTurns: makeRecordingTier(calls), ...deps });
  const env = {
    AGENT_TURN_ROUTE: flag,
    EDGE_SHOWCASE_MODE: "false",
    ANON_ACCESS_ENABLED: "true",
    ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    EDGE_GUARD: fakeGuard(NOW).namespace,
    CONTAINER: makeRecordingContainer(forwarded),
  } as never;
  return { calls, forwarded, request: async (path, init) => await app.request(path, init, env, stubCtx) };
}

const AUTHED: WorkerDeps = {
  authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const),
};
const ANONYMOUS: WorkerDeps = {
  authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
  turnstileGate: { check: () => Promise.resolve({ ok: true, errorCodes: [] }) },
};

const POST_CHAT = {
  method: "POST",
  headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
  body: CHAT_BODY,
};

void test("an unset flag forwards POST /v1/chat to the container, untouched", async () => {
  const harness = makeHarness(undefined, AUTHED);
  const response = await harness.request("/v1/chat", POST_CHAT);
  assert.equal(await response.text(), "container");
  assert.deepEqual(harness.calls, []);
  assert.equal(harness.forwarded.length, 1);
});

void test("the forwarded request keeps its method, path and body verbatim", async () => {
  const harness = makeHarness("container", AUTHED);
  await harness.request("/v1/chat", POST_CHAT);
  const forwarded = harness.forwarded[0];
  assert.ok(forwarded);
  assert.equal(forwarded.method, "POST");
  assert.equal(new URL(forwarded.url).pathname, "/v1/chat");
  assert.equal(await forwarded.text(), CHAT_BODY);
});

void test('"edge" hands POST /v1/chat to the agent tier with the verified identity', async () => {
  const harness = makeHarness("edge", AUTHED);
  const response = await harness.request("/v1/chat", POST_CHAT);
  assert.equal(await response.text(), "tier-chat");
  assert.deepEqual(harness.calls, [{ route: "chat", identity: { userId: "u1", userType: "human" }, sessionId: null }]);
  assert.deepEqual(harness.forwarded, []);
});

void test('"edge" hands the transcript GET to the tier with the session id from the path', async () => {
  const harness = makeHarness("edge", AUTHED);
  const response = await harness.request(TRANSCRIPT, { headers: { Authorization: "Bearer jwt" } });
  assert.equal(await response.text(), "tier-transcript");
  assert.deepEqual(harness.calls, [
    { route: "transcript", identity: { userId: "u1", userType: "human" }, sessionId: "s-42" },
  ]);
});

void test("an anonymous visitor reaches the tier as the anonymous identity the edge minted", async () => {
  const harness = makeHarness("edge", ANONYMOUS);
  await harness.request("/v1/chat", { method: "POST", body: CHAT_BODY });
  const call = harness.calls[0];
  assert.ok(call);
  assert.equal(call.route, "chat");
  assert.equal(call.identity.userType, "anonymous");
  assert.match(call.identity.userId, /^anon_[0-9a-f]{32}$/);
});

void test("the transcript GET is 401 for an anonymous caller while the flag says container", async () => {
  const harness = makeHarness("container", ANONYMOUS);
  const response = await harness.request(TRANSCRIPT, {});
  assert.equal(response.status, 401);
  assert.deepEqual(harness.calls, []);
});

void test('"edge" opens that same GET to the anonymous visitor — W1 has no exit without it', async () => {
  const harness = makeHarness("edge", ANONYMOUS);
  const response = await harness.request(TRANSCRIPT, {});
  assert.equal(await response.text(), "tier-transcript");
  const call = harness.calls[0];
  assert.ok(call);
  assert.equal(call.sessionId, "s-42");
  assert.match(call.identity.userId, /^anon_[0-9a-f]{32}$/);
});

void test("the widening is this side of the switch only — the anonymous route table is untouched", () => {
  assert.deepEqual([...ANON_V1_PATHS], ["/v1/chat", "/v1/photo-search", "/v1/photo-search/confirm"]);
});

void test("an unrelated /v1 route still forwards to the container under both flag values", async () => {
  const container = makeHarness("container", AUTHED);
  const edge = makeHarness("edge", AUTHED);
  await container.request("/v1/photo-search", { method: "POST", headers: { Authorization: "Bearer jwt" } });
  await edge.request("/v1/photo-search", { method: "POST", headers: { Authorization: "Bearer jwt" } });
  assert.deepEqual([container.forwarded.length, edge.forwarded.length], [1, 1]);
  assert.deepEqual([...container.calls, ...edge.calls], []);
});

void test("the authenticated limiter still runs before the tier — a denied turn never reaches it", async () => {
  const calls: TierCall[] = [];
  const app = createWorkerApp({ ...AUTHED, agentTurns: makeRecordingTier(calls) });
  const env = {
    AGENT_TURN_ROUTE: "edge",
    EDGE_SHOWCASE_MODE: "false",
    AUTH_RATE_LIMIT: "1",
    EDGE_GUARD: fakeGuard(NOW).namespace,
    CONTAINER: makeRecordingContainer([]),
  } as never;
  assert.equal((await app.request("/v1/chat", POST_CHAT, env, stubCtx)).status, 200);
  assert.equal((await app.request("/v1/chat", POST_CHAT, env, stubCtx)).status, 429);
  assert.equal(calls.length, 1);
});

void test("showcase mode denies the agent tier the same way it denies the forward", async () => {
  const calls: TierCall[] = [];
  const app = createWorkerApp({ ...AUTHED, agentTurns: makeRecordingTier(calls) });
  const env = { AGENT_TURN_ROUTE: "edge", EDGE_SHOWCASE_MODE: "true" } as never;
  assert.equal((await app.request("/v1/chat", POST_CHAT, env, stubCtx)).status, 403);
  assert.deepEqual(calls, []);
});
