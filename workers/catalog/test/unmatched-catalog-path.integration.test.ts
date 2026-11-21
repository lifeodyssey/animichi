import { expect, it, vi } from "vitest";
import { catalogRequest } from "./catalog-request";
import { databaseDescribe, planeDatabaseUrl } from "./integration-db";

// The Node integration pool has no workerd runtime; stub the runtime module so
// `src/index.ts` (which exports the `IngestEntrypoint` named entrypoint) loads
// in plain Node.
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

/**
 * The catalog Worker entry (`src/index.ts`) on a `/catalog/*` path that no
 * procedure serves.
 *
 * `search` and `spots` were retired (#2075), so a POST to either old path must be
 * answered exactly as a path that never existed: the oRPC handler reports no
 * match and Hono's default 404 answers. The body is `{}`, so a procedure that
 * came back would answer 400 from its input validation, with no upstream call.
 *
 * It needs the suite database: without `DATABASE_URL` the `/catalog/*`
 * middleware answers 503 for every path before routing, matched or not.
 */

const NEVER_A_PROCEDURE = "/catalog/never-a-procedure";

interface Answer {
  status: number;
  body: string;
}

async function postEmptyBody(path: string): Promise<Answer> {
  const response = await catalogRequest(
    path,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    { ENVIRONMENT: "test", DATABASE_URL: planeDatabaseUrl() },
  );
  return { status: response.status, body: await response.text() };
}

databaseDescribe("catalog Worker entry: a /catalog path that no procedure serves", () => {
  it.each(["/catalog/search", "/catalog/spots"])(
    "answers the retired %s with Hono's default 404, as it does a path that never existed",
    async (path) => {
      const unmatched = await postEmptyBody(NEVER_A_PROCEDURE);
      expect(unmatched).toEqual({ status: 404, body: "404 Not Found" });
      expect(await postEmptyBody(path)).toEqual(unmatched);
    },
  );
});
