import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_CRON } from "../src/cron-config";
import { IngestEntrypoint, type Env } from "../src/index";
import { createScheduledHandler } from "../src/scheduled/ingest-schedule";
import { catalogRequest } from "./catalog-request";
import { loggedErrors } from "./logged-errors";

// SUT: the catalog Worker when the shared contract its Prisma access validates is broken. The
// contract is validated as `src/db/prisma.ts` evaluates, and that module loads on the first request
// that needs it rather than at startup, so a broken contract no longer stops the Worker from
// starting. It fails that request instead, and every door that loads Prisma answers it as it
// answers a failed acquire today: Hono's 500 for an HTTP route, with the failure logged, and the
// failure itself for the ingest RPC and for a cron pass.

vi.mock("@animichi/pi-session-neon/contract", () => ({ default: { schemaVersion: "broken" } }));

const ADMIN_TOKEN = "admin-token-for-the-load-failure-suite";
const DATABASE: Env = { DATABASE_URL: "postgresql://fixture@db.test/catalog" };
const FAILED = { status: 500, body: "Internal Server Error" };
/** How Prisma refuses the mocked contract when `src/db/prisma.ts` validates it. */
const BROKEN_CONTRACT = /Contract structural validation failed: /;
const CTX = {} as unknown as ExecutionContext;

/** An HTTP door's answer: its status, its body and the errors Hono logged answering it, as text. */
async function answerOf(request: () => Promise<Response>): Promise<{ status: number; body: string; logged: string[] }> {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const response = await request();
  return { status: response.status, body: await response.text(), logged: loggedErrors(logged).map(String) };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("the catalog Worker with a broken contract", () => {
  it("starts and answers /healthz", async () => {
    expect((await catalogRequest("/healthz")).status).toBe(200);
  });

  it("answers a /catalog/* request with Hono's 500, and logs the failure", async () => {
    const answer = await answerOf(() => catalogRequest("/catalog/nearby", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat: 36.1, lng: 139.6, radius_m: 5000 }),
    }, DATABASE));
    expect(answer).toMatchObject(FAILED);
    expect(answer.logged).toHaveLength(1);
    expect(answer.logged[0]).toMatch(BROKEN_CONTRACT);
  });

  it("answers an image request with Hono's 500, and logs the failure", async () => {
    const env: Env = { ...DATABASE, MEDIA_BUCKET: {} as R2Bucket };
    const answer = await answerOf(() => catalogRequest("/catalog/img/point-1?plan=h160", {}, env));
    expect(answer).toMatchObject(FAILED);
    expect(answer.logged).toHaveLength(1);
    expect(answer.logged[0]).toMatch(BROKEN_CONTRACT);
  });

  it("answers an admin command with Hono's 500, and logs the failure", async () => {
    const answer = await answerOf(() => catalogRequest("/catalog/admin/canary", {
      method: "POST", headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    }, { ...DATABASE, CATALOG_ADMIN_TOKEN: ADMIN_TOKEN }));
    expect(answer).toMatchObject(FAILED);
    expect(answer.logged).toHaveLength(1);
    expect(answer.logged[0]).toMatch(BROKEN_CONTRACT);
  });

  it("rejects the ingest RPC with the failure", async () => {
    const entrypoint = new IngestEntrypoint(CTX, DATABASE);
    await expect(entrypoint.ingestBangumi("10380")).rejects.toThrow(BROKEN_CONTRACT);
  });

  it("rejects a cron pass with the failure", async () => {
    const pass = createScheduledHandler()({ cron: SEED_CRON }, { ...DATABASE, ENVIRONMENT: "production" });
    await expect(pass).rejects.toThrow(BROKEN_CONTRACT);
  });
});
