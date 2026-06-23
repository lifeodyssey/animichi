import test from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "./auth.ts";

const ENV = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as unknown as typeof fetch;
}

function bearer(token: string): Request {
  return new Request("https://app/v1/chat", { headers: { Authorization: `Bearer ${token}` } });
}

test("no Authorization header -> {ok:false}", async () => {
  const r = await authenticate(new Request("https://app/v1/chat"), ENV, stubFetch(() => new Response("", { status: 200 })));
  assert.deepEqual(r, { ok: false });
});

test("valid JWT -> human + userId from /auth/v1/user", async () => {
  const r = await authenticate(bearer("jwt-token"), ENV, stubFetch((url) => {
    assert.ok(url.endsWith("/auth/v1/user"));
    return new Response(JSON.stringify({ id: "user-123" }), { status: 200 });
  }));
  assert.deepEqual(r, { ok: true, userId: "user-123", userType: "human" });
});

test("invalid JWT (upstream !ok) -> {ok:false}", async () => {
  const r = await authenticate(bearer("bad"), ENV, stubFetch(() => new Response("", { status: 401 })));
  assert.deepEqual(r, { ok: false });
});

test("valid sk_ key -> agent + userId from api_keys", async () => {
  const r = await authenticate(bearer("sk_live_abc"), ENV, stubFetch((url) => {
    if (url.includes("/rest/v1/api_keys") && url.includes("select=user_id"))
      return new Response(JSON.stringify([{ user_id: "agent-9" }]), { status: 200 });
    return new Response("", { status: 200 }); // PATCH last_used_at best-effort
  }));
  assert.deepEqual(r, { ok: true, userId: "agent-9", userType: "agent" });
});

test("unknown sk_ key (no rows) -> {ok:false}", async () => {
  const r = await authenticate(bearer("sk_nope"), ENV, stubFetch((url) =>
    url.includes("/rest/v1/api_keys") ? new Response("[]", { status: 200 }) : new Response("", { status: 200 })));
  assert.deepEqual(r, { ok: false });
});
