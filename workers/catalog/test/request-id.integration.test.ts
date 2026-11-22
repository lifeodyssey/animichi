import { afterEach, expect, it, vi } from "vitest";
import { catalogRequest } from "./catalog-request";
import { databaseDescribe, planeDatabaseUrl } from "./integration-db";

/**
 * SUT: catalog's `/catalog/*` boundary (`src/index.ts`), driven through the whole app against the
 * suite database. The boundary reads the gateway's `X-Request-Id` into the request's context, so
 * the line the request writes carries it, and drops a value that is not the gateway's format. The
 * line formats themselves are `request-id-lines.worker.test.ts`.
 */

// The Node integration pool has no workerd runtime; stub the runtime module so
// `src/index.ts` (which exports the `IngestEntrypoint` named entrypoint) loads.
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class WorkerEntrypoint {
    readonly ctx: unknown;
    readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

/** A request ID as the gateway mints it: a lowercase UUID. */
const GATEWAY_ID = "6f1a4c2e-8f3b-4d5a-9c7e-2b1d0a4e5f60";

/** What one nearby request through the whole app writes to `console.info`. */
async function nearbyLine(requestId: string): Promise<string> {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const response = await catalogRequest("/catalog/nearby", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Request-Id": requestId },
    body: JSON.stringify({ lat: 36.1, lng: 139.6, radius_m: 5000 }),
  }, { ENVIRONMENT: "test", DATABASE_URL: planeDatabaseUrl() });
  expect(response.status).toBe(200);
  return info.mock.calls.map((call) => String(call[0])).join("\n");
}

afterEach(() => { vi.restoreAllMocks(); });

databaseDescribe("catalog takes the gateway's request ID at its boundary", () => {
  it("writes the ID the gateway sent on the request's line", async () => {
    expect(await nearbyLine(GATEWAY_ID)).toContain(`request_id=${GATEWAY_ID}`);
  });

  it("drops a value the gateway never mints", async () => {
    const line = await nearbyLine(`${GATEWAY_ID} injected=1`);
    expect(line).toContain("request_id=-");
    expect(line).not.toContain("injected");
  });
});
