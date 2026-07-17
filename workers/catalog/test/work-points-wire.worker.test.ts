import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { describe, expect, it } from "vitest";
import type { CatalogDb, NeonSql } from "../src/db/client";
import { catalogRouter, type CatalogContext } from "../src/router";
import type { UpstreamUnavailableData } from "../src/lib/errors";

const handler = new OpenAPIHandler(catalogRouter);

async function call(body: unknown, context: CatalogContext): Promise<Response> {
  const request = new Request("https://catalog.test/catalog/points-by-work-id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const { matched, response } = await handler.handle(request, { context });
  expect(matched).toBe(true);
  if (!response) throw new Error("expected OpenAPI handler response");
  return response;
}

function context(responses: unknown[][], fetchImpl?: typeof fetch): CatalogContext {
  const execute = () => Promise.resolve({ rows: responses.shift() ?? [] });
  const db = { execute } as unknown as CatalogDb;
  const neonSql = (() => Promise.resolve([])) as unknown as NeonSql;
  return { db, neonSql, fetchImpl };
}

function unreachableContext(): CatalogContext {
  const execute = () => { throw new Error("db should not be reached"); };
  const db = { execute } as unknown as CatalogDb;
  const neonSql = (() => Promise.resolve([])) as unknown as NeonSql;
  return { db, neonSql };
}

describe("work-id contract on the OpenAPI wire", () => {
  it("rejects a nonnumeric work id before SQL or upstream access", async () => {
    const response = await call({ work_id: "not-a-number" }, unreachableContext());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ defined: false, status: 400 });
  });

  it("serializes UPSTREAM_UNAVAILABLE for a preview outage", async () => {
    const fetchImpl = (() => Promise.reject(new Error("anitabi down"))) as unknown as typeof fetch;
    const response = await call(
      { work_id: "3302" },
      context([[], [], [{ work_id: "3302" }], []], fetchImpl),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      defined: true, code: "UPSTREAM_UNAVAILABLE", status: 502,
      message: "Upstream catalog source unavailable",
      data: { upstream: "anitabi" } satisfies UpstreamUnavailableData,
    });
  });
});
