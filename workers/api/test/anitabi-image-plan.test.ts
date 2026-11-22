/**
 * Public Anitabi image display: documented size plans and a single User-Agent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ANITABI_USER_AGENT } from "@animichi/contract/anitabi-display";
import { withImageOrigin, withRecordingOrigin } from "./doubles/docs-asset-doubles.ts";
import { noHitCache, withCacheDouble } from "./doubles/cache-api-double.ts";
import { edgeAppRequest } from "./doubles/edge-app-request.ts";

void test("a public display request without a plan is refused", async (t) => {
  const requested: string[] = [];
  const response = await withCacheDouble(noHitCache(() => Promise.resolve()), () =>
    withRecordingOrigin(t, requested, () => edgeAppRequest("/img/image/1234/point-1.jpg", {})));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "image_plan_required", message: "Public image requests must include a documented size plan." },
  });
  assert.deepEqual(requested, []);
});

void test("a list surface plan is forwarded to the Anitabi origin", async (t) => {
  const requested: string[] = [];
  const response = await withCacheDouble(noHitCache(() => Promise.resolve()), () =>
    withRecordingOrigin(t, requested, () => edgeAppRequest("/img/image/1234/point-1.jpg?plan=h160", {})));
  assert.equal(response.status, 200);
  assert.deepEqual(requested, ["https://image.anitabi.cn/image/1234/point-1.jpg?plan=h160"]);
});

void test("the origin request uses the shared Anitabi user agent", async (t) => {
  const agents: string[] = [];
  const origin: typeof fetch = (_input, init) => {
    agents.push(new Headers(init?.headers).get("User-Agent") ?? "");
    return Promise.resolve(new Response("jpeg-bytes", { status: 200 }));
  };
  const response = await withCacheDouble(noHitCache(() => Promise.resolve()), () =>
    withImageOrigin(t, origin, () => edgeAppRequest("/img/p.jpg?plan=h360", {})));
  assert.equal(response.status, 200);
  assert.deepEqual(agents, [ANITABI_USER_AGENT]);
});
