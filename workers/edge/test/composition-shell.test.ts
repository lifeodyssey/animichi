import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// EDGE-1 #963: the Worker entry delegates once. app.ts is the Hono shell —
// every policy branch (identity, protection, route selection, forwarding)
// lives in the composed gateway seam; re-exports of policy from app.ts are
// deleted. This file reads the shell's source so a regression that puts
// policy back into app.ts (or re-exports it from there) fails loudly.

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), "utf8");
}

const appSource = sourceOf("app.ts");
const entrySource = sourceOf("entry.ts");

void test("app.ts delegates every request to HandleGatewayRequest exactly once", () => {
  assert.equal(
    appSource.split("HandleGatewayRequest(").length - 1,
    1,
    "app.ts must hold one delegation to the composed seam and no policy of its own",
  );
});

void test("app.ts contains no route policy vocabulary", () => {
  const policy = /handleAnonymousV1|forwardUsers|forwardV1|handleSessionAdopt|SESSION_MIGRATE_PATH|isAuthRateLimited|isPublicV1|catalogOutbound|\/v1\/users|\/v1\/sessions/;
  assert.doesNotMatch(appSource, policy);
});

void test("entry.ts imports nothing but createWorkerApp from app.ts", () => {
  const fromApp = entrySource.match(/import[^;]*from "\.\/app\.ts"[^;]*;/g) ?? [];
  assert.deepEqual(fromApp, ['import { createWorkerApp } from "./app.ts";']);
});
