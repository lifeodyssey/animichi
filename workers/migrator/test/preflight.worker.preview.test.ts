import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COMPATIBLE_PREVIEW, metadata, preflightRequest, recordingExecutor, signedApp } from "./preflight-fixtures";
import { FIXED_NOW } from "./migrate.worker.helpers";

// What `/preflight` answers once one authority owns the migration graph (#1634): the native
// preview for the identity the bundle carries, and nothing about a second owner's ledger. The
// read's own isolation belongs to Prisma's control API, and is proved against a real database
// in `test/integration/prisma.integration.ts`.

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("returns the native preview for the identity the bundle carries", async () => {
  const executor = recordingExecutor();
  const { app, token, env } = await signedApp({}, { selected: executor.selected });
  const response = await app.request(preflightRequest(metadata, token), {}, env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(COMPATIBLE_PREVIEW);
  expect(executor.calls).toHaveLength(1);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("refuses an incompatible preview with 422 and a stable code", async () => {
  const executor = recordingExecutor({ compatible: false, error: "prisma_marker_unavailable" });
  const { app, token, env } = await signedApp({}, { selected: executor.selected });
  const response = await app.request(preflightRequest(metadata, token), {}, env);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "prisma_marker_unavailable" });
});
